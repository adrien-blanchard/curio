begin;

create function private.attribution_email_valid(p_email text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select
    char_length(p_email) between 3 and 320
    and char_length(split_part(p_email, '@', 1)) between 1 and 64
    and split_part(p_email, '@', 1) ~ '^[-a-z0-9_+''\.]*[-a-z0-9_+]$'
    and split_part(p_email, '@', 1) !~ '(^[.]|[.]$|[.][.])'
    and split_part(p_email, '@', 2) ~ (
      '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
      || '(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*'
      || '\.[a-z]{2,63}$'
    );
$$;

alter table public.entry_attributions
  drop constraint entry_attributions_email_normalized,
  add constraint entry_attributions_email_normalized check (
    author_email = lower(btrim(author_email))
    and private.attribution_email_valid(author_email)
  ) not valid;

alter table public.entry_attributions
  validate constraint entry_attributions_email_normalized;

create or replace function public.upsert_entry_attribution(
  p_actor_user_id uuid,
  p_entry_id uuid,
  p_author_email text,
  p_display_name text,
  p_avatar_url text
)
returns setof public.entry_attributions
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(p_author_email));
  normalized_display_name text := nullif(
    pg_catalog.regexp_replace(
      btrim(coalesce(p_display_name, '')),
      '[[:space:]]+',
      ' ',
      'g'
    ),
    ''
  );
  normalized_avatar_url text := nullif(btrim(coalesce(p_avatar_url, '')), '');
  actor_role public.app_role;
  affected_row_count bigint;
begin
  select profile.role
  into actor_role
  from public.profiles as profile
  where profile.id = p_actor_user_id
    and profile.is_active;

  if actor_role is distinct from 'administrator'::public.app_role then
    raise exception 'ADMINISTRATOR_REQUIRED' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.entries as entry where entry.id = p_entry_id
  ) then
    raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0002';
  end if;

  if normalized_email is null
     or not private.attribution_email_valid(normalized_email) then
    raise exception 'INVALID_ATTRIBUTION_EMAIL' using errcode = '22023';
  end if;

  if normalized_display_name is not null
     and (
       char_length(normalized_display_name) > 120
       or normalized_display_name ~ '[[:cntrl:]]'
     ) then
    raise exception 'INVALID_ATTRIBUTION_DISPLAY_NAME' using errcode = '22023';
  end if;

  if normalized_avatar_url is not null
     and (
       char_length(normalized_avatar_url) > 2048
       or normalized_avatar_url !~ '^https://lh3[.]googleusercontent[.]com/[^[:space:]]+$'
     ) then
    raise exception 'INVALID_ATTRIBUTION_AVATAR_URL' using errcode = '22023';
  end if;

  insert into public.entry_attributions (
    entry_id,
    author_email,
    display_name,
    avatar_url
  )
  values (
    p_entry_id,
    normalized_email,
    normalized_display_name,
    normalized_avatar_url
  )
  on conflict (entry_id) do update
  set
    author_email = excluded.author_email,
    display_name = excluded.display_name,
    avatar_url = excluded.avatar_url
  where entry_attributions.author_email is distinct from excluded.author_email
    or entry_attributions.display_name is distinct from excluded.display_name
    or entry_attributions.avatar_url is distinct from excluded.avatar_url;

  get diagnostics affected_row_count = row_count;

  if affected_row_count > 0 then
    insert into public.audit_events (
      actor_user_id,
      event_type,
      target_table,
      target_id,
      payload
    )
    values (
      p_actor_user_id,
      'entry.attribution_updated',
      'entry_attributions',
      p_entry_id,
      jsonb_build_object('author_email', normalized_email)
    );
  end if;

  return query
  select attribution.*
  from public.entry_attributions as attribution
  where attribution.entry_id = p_entry_id;
end;
$$;

create or replace function public.list_entries_page(
  p_query text,
  p_source_type public.entry_source_type,
  p_tag_slugs text[],
  p_sort_ascending boolean,
  p_offset integer,
  p_limit integer,
  p_author_email text
)
returns table (
  id uuid,
  url text,
  title text,
  tldr text,
  thumbnail_path text,
  status public.entry_status,
  source_type public.entry_source_type,
  created_at timestamptz,
  created_by uuid,
  author_email text,
  author_display_name text,
  author_avatar_url text,
  error_message text,
  total_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  normalized_query text := nullif(btrim(coalesce(p_query, '')), '');
  normalized_tag_slugs text[] := coalesce(p_tag_slugs, '{}'::text[]);
  normalized_author_email text := nullif(lower(btrim(coalesce(p_author_email, ''))), '');
begin
  if public.current_app_role() is null then
    raise exception 'ENTRY_FORBIDDEN' using errcode = '42501';
  end if;

  if p_sort_ascending is null
     or p_offset is null
     or p_offset not between 0 and 1000000
     or p_limit is null
     or p_limit not between 1 and 100 then
    raise exception 'INVALID_PAGINATION' using errcode = '22023';
  end if;

  if normalized_query is not null and char_length(normalized_query) > 200 then
    raise exception 'INVALID_QUERY' using errcode = '22023';
  end if;

  if normalized_author_email is not null
     and (
       char_length(normalized_author_email) not between 3 and 320
       or char_length(split_part(normalized_author_email, '@', 1)) not between 1 and 64
       or split_part(normalized_author_email, '@', 1)
          !~ '^[-a-z0-9_+''\.]*[-a-z0-9_+]$'
       or split_part(normalized_author_email, '@', 1) ~ '(^[.]|[.]$|[.][.])'
       or split_part(normalized_author_email, '@', 2) !~ (
         '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
         || '(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*'
         || '\.[a-z]{2,63}$'
       )
     ) then
    raise exception 'INVALID_AUTHOR_EMAIL' using errcode = '22023';
  end if;

  if cardinality(normalized_tag_slugs) > 10
     or (
       select count(distinct requested.slug)
       from unnest(normalized_tag_slugs) as requested(slug)
     ) <> cardinality(normalized_tag_slugs)
     or exists (
       select 1
       from unnest(normalized_tag_slugs) as requested(slug)
       where requested.slug is null
         or requested.slug <> lower(btrim(requested.slug))
         or char_length(requested.slug) > 80
         or requested.slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     ) then
    raise exception 'INVALID_TAGS' using errcode = '22023';
  end if;

  return query
  with filtered_entries as (
    select
      entry.id,
      entry.url,
      entry.title,
      entry.tldr,
      entry.thumbnail_path,
      entry.status,
      entry.source_type,
      entry.created_at,
      entry.created_by,
      attribution.author_email,
      attribution.display_name as author_display_name,
      attribution.avatar_url as author_avatar_url,
      entry.error_message
    from public.entries as entry
    left join public.entry_attributions as attribution
      on attribution.entry_id = entry.id
    where (p_source_type is null or entry.source_type = p_source_type)
      and (
        normalized_author_email is null
        or attribution.author_email = normalized_author_email
      )
      and (
        normalized_query is null
        or entry.search_document @@ websearch_to_tsquery('simple', normalized_query)
      )
      and not exists (
        select 1
        from unnest(normalized_tag_slugs) as requested(slug)
        where not exists (
          select 1
          from public.entry_tags as entry_tag
          join public.tags as tag on tag.id = entry_tag.tag_id
          where entry_tag.entry_id = entry.id
            and tag.slug = requested.slug
        )
      )
  ), counted_entries as (
    select filtered_entry.*, count(*) over () as total_count
    from filtered_entries as filtered_entry
  )
  select
    counted_entry.id,
    counted_entry.url,
    counted_entry.title,
    counted_entry.tldr,
    counted_entry.thumbnail_path,
    counted_entry.status,
    counted_entry.source_type,
    counted_entry.created_at,
    counted_entry.created_by,
    counted_entry.author_email,
    counted_entry.author_display_name,
    counted_entry.author_avatar_url,
    counted_entry.error_message,
    counted_entry.total_count
  from counted_entries as counted_entry
  order by
    case when p_sort_ascending then counted_entry.created_at end asc,
    case when p_sort_ascending then counted_entry.id end asc,
    case when not p_sort_ascending then counted_entry.created_at end desc,
    case when not p_sort_ascending then counted_entry.id end desc
  offset p_offset
  limit p_limit;
end;
$$;

revoke all on function private.attribution_email_valid(text) from public;
revoke execute on function public.upsert_entry_attribution(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.upsert_entry_attribution(uuid, uuid, text, text, text)
  to service_role;
revoke execute on function public.list_entries_page(
  text,
  public.entry_source_type,
  text[],
  boolean,
  integer,
  integer,
  text
) from public, anon;
grant execute on function public.list_entries_page(
  text,
  public.entry_source_type,
  text[],
  boolean,
  integer,
  integer,
  text
) to authenticated;

commit;
