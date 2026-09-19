begin;

alter table public.profiles
  add column display_name text,
  add column avatar_url text,
  add constraint profiles_display_name_safe check (
    display_name is null
    or (
      display_name = btrim(display_name)
      and char_length(display_name) between 1 and 120
      and display_name !~ '[[:cntrl:]]'
    )
  ),
  add constraint profiles_avatar_url_google_https check (
    avatar_url is null
    or (
      char_length(avatar_url) between 1 and 2048
      and avatar_url ~ '^https://lh3[.]googleusercontent[.]com/[^[:space:]]+$'
    )
  );

-- Populate the identity for users who already have an active session. Only
-- values matching the same constraints as the OAuth callback are retained.
with oauth_identity as (
  select
    auth_user.id,
    nullif(
      pg_catalog.regexp_replace(
        btrim(
          coalesce(
            auth_user.raw_user_meta_data ->> 'full_name',
            auth_user.raw_user_meta_data ->> 'name',
            ''
          )
        ),
        '[[:space:]]+',
        ' ',
        'g'
      ),
      ''
    ) as display_name,
    coalesce(
      case
        when btrim(coalesce(auth_user.raw_user_meta_data ->> 'avatar_url', ''))
          ~ '^https://lh3[.]googleusercontent[.]com/[^[:space:]]+$'
        then btrim(auth_user.raw_user_meta_data ->> 'avatar_url')
      end,
      case
        when btrim(coalesce(auth_user.raw_user_meta_data ->> 'picture', ''))
          ~ '^https://lh3[.]googleusercontent[.]com/[^[:space:]]+$'
        then btrim(auth_user.raw_user_meta_data ->> 'picture')
      end
    ) as avatar_url
  from auth.users as auth_user
)
update public.profiles as profile
set
  display_name = case
    when char_length(oauth_identity.display_name) between 1 and 120
      and oauth_identity.display_name !~ '[[:cntrl:]]'
    then oauth_identity.display_name
    else profile.display_name
  end,
  avatar_url = case
    when char_length(oauth_identity.avatar_url) between 1 and 2048
    then oauth_identity.avatar_url
    else profile.avatar_url
  end
from oauth_identity
where oauth_identity.id = profile.id;

comment on column public.profiles.display_name is
  'Display name synchronized from trusted Google OAuth metadata.';
comment on column public.profiles.avatar_url is
  'HTTPS Google avatar URL synchronized from trusted OAuth metadata.';

create table public.entry_attributions (
  entry_id uuid primary key references public.entries(id) on delete cascade,
  author_email text not null,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entry_attributions_email_normalized check (
    author_email = lower(btrim(author_email))
    and char_length(author_email) between 3 and 320
    and author_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
  ),
  constraint entry_attributions_display_name_safe check (
    display_name is null
    or (
      display_name = btrim(display_name)
      and char_length(display_name) between 1 and 120
      and display_name !~ '[[:cntrl:]]'
    )
  ),
  constraint entry_attributions_avatar_url_google_https check (
    avatar_url is null
    or (
      char_length(avatar_url) between 1 and 2048
      and avatar_url ~ '^https://lh3[.]googleusercontent[.]com/[^[:space:]]+$'
    )
  )
);

create index entry_attributions_author_email_entry_idx
  on public.entry_attributions (author_email, entry_id);

comment on table public.entry_attributions is
  'Display attribution snapshots. entries.created_by remains the authorization owner.';
comment on column public.entry_attributions.author_email is
  'Normalized historical author identity used by the catalog filter.';

create trigger entry_attributions_set_updated_at
before update on public.entry_attributions
for each row execute function private.set_updated_at();

create function private.snapshot_entry_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is null then
    return new;
  end if;

  insert into public.entry_attributions (
    entry_id,
    author_email,
    display_name,
    avatar_url
  )
  select
    new.id,
    profile.email,
    profile.display_name,
    profile.avatar_url
  from public.profiles as profile
  where profile.id = new.created_by
  on conflict (entry_id) do nothing;

  return new;
end;
$$;

create trigger entries_snapshot_attribution
after insert on public.entries
for each row execute function private.snapshot_entry_attribution();

insert into public.entry_attributions (
  entry_id,
  author_email,
  display_name,
  avatar_url,
  created_at,
  updated_at
)
select
  entry.id,
  profile.email,
  profile.display_name,
  profile.avatar_url,
  entry.created_at,
  entry.created_at
from public.entries as entry
join public.profiles as profile on profile.id = entry.created_by
on conflict (entry_id) do nothing;

create function public.sync_profile_identity(
  p_user_id uuid,
  p_display_name text,
  p_avatar_url text
)
returns setof public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
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
  profile_email text;
  effective_display_name text;
  effective_avatar_url text;
begin
  if normalized_display_name is not null
     and (
       char_length(normalized_display_name) > 120
       or normalized_display_name ~ '[[:cntrl:]]'
     ) then
    raise exception 'INVALID_PROFILE_DISPLAY_NAME' using errcode = '22023';
  end if;

  if normalized_avatar_url is not null
     and (
       char_length(normalized_avatar_url) > 2048
       or normalized_avatar_url !~ '^https://lh3[.]googleusercontent[.]com/[^[:space:]]+$'
     ) then
    raise exception 'INVALID_PROFILE_AVATAR_URL' using errcode = '22023';
  end if;

  select profile.email
  into profile_email
  from public.profiles as profile
  join auth.users as auth_user on auth_user.id = profile.id
  where profile.id = p_user_id;

  if profile_email is null then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.profiles as profile
  set
    display_name = coalesce(normalized_display_name, profile.display_name),
    avatar_url = coalesce(normalized_avatar_url, profile.avatar_url)
  where profile.id = p_user_id
    and (
      (
        normalized_display_name is not null
        and profile.display_name is distinct from normalized_display_name
      )
      or (
        normalized_avatar_url is not null
        and profile.avatar_url is distinct from normalized_avatar_url
      )
    )
  returning profile.display_name, profile.avatar_url
  into effective_display_name, effective_avatar_url;

  if not found then
    select profile.display_name, profile.avatar_url
    into effective_display_name, effective_avatar_url
    from public.profiles as profile
    where profile.id = p_user_id;
  end if;

  -- Keep attributions for this exact profile identity current. Historical
  -- attributions imported under another email remain immutable snapshots.
  update public.entry_attributions as attribution
  set
    display_name = effective_display_name,
    avatar_url = effective_avatar_url
  from public.entries as entry
  where entry.id = attribution.entry_id
    and entry.created_by = p_user_id
    and attribution.author_email = profile_email
    and (
      attribution.display_name is distinct from effective_display_name
      or attribution.avatar_url is distinct from effective_avatar_url
    );

  return query
  select profile.*
  from public.profiles as profile
  where profile.id = p_user_id;
end;
$$;

create function public.upsert_entry_attribution(
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
     or char_length(normalized_email) not between 3 and 320
     or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' then
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

drop function public.list_entries_page(
  text,
  public.entry_source_type,
  text[],
  boolean,
  integer,
  integer
);

create function public.list_entries_page(
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
       or normalized_author_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
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

create function public.list_entries_page(
  p_query text,
  p_source_type public.entry_source_type,
  p_tag_slugs text[],
  p_sort_ascending boolean,
  p_offset integer,
  p_limit integer
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
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from public.list_entries_page(
    p_query,
    p_source_type,
    p_tag_slugs,
    p_sort_ascending,
    p_offset,
    p_limit,
    null
  );
$$;

create function public.list_entry_authors()
returns table (
  author_email text,
  display_name text,
  avatar_url text,
  entry_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if public.current_app_role() is null then
    raise exception 'ENTRY_FORBIDDEN' using errcode = '42501';
  end if;

  return query
  with ranked_authors as (
    select
      attribution.author_email,
      attribution.display_name,
      attribution.avatar_url,
      count(*) over (partition by attribution.author_email) as entry_count,
      row_number() over (
        partition by attribution.author_email
        order by
          (attribution.display_name is not null) desc,
          (attribution.avatar_url is not null) desc,
          entry.created_at desc,
          attribution.entry_id desc
      ) as identity_rank
    from public.entry_attributions as attribution
    join public.entries as entry on entry.id = attribution.entry_id
  )
  select
    ranked_author.author_email,
    ranked_author.display_name,
    ranked_author.avatar_url,
    ranked_author.entry_count
  from ranked_authors as ranked_author
  where ranked_author.identity_rank = 1
  order by
    lower(coalesce(ranked_author.display_name, ranked_author.author_email)),
    ranked_author.author_email;
end;
$$;

alter table public.entry_attributions enable row level security;
alter table public.entry_attributions force row level security;

create policy entry_attributions_select_active_profile
on public.entry_attributions
for select
to authenticated
using ((select public.current_app_role()) is not null);

revoke all on public.entry_attributions from public, anon, authenticated;
grant select on public.entry_attributions to authenticated;
grant all on public.entry_attributions to service_role;

revoke all on function private.snapshot_entry_attribution() from public;
revoke execute on function public.sync_profile_identity(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.sync_profile_identity(uuid, text, text)
  to service_role;
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
revoke execute on function public.list_entries_page(
  text,
  public.entry_source_type,
  text[],
  boolean,
  integer,
  integer
) from public, anon;
grant execute on function public.list_entries_page(
  text,
  public.entry_source_type,
  text[],
  boolean,
  integer,
  integer
) to authenticated;
revoke execute on function public.list_entry_authors()
  from public, anon;
grant execute on function public.list_entry_authors()
  to authenticated;

commit;
