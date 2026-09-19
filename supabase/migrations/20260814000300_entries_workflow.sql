begin;

create function private.assert_valid_tag_ids(p_tag_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_count integer := cardinality(coalesce(p_tag_ids, '{}'::uuid[]));
  distinct_count integer;
  existing_count integer;
begin
  if requested_count > 10 then
    raise exception 'INVALID_TAGS' using errcode = '22023';
  end if;

  select count(distinct requested.tag_id)::integer
  into distinct_count
  from unnest(coalesce(p_tag_ids, '{}'::uuid[])) as requested(tag_id);

  if distinct_count <> requested_count then
    raise exception 'INVALID_TAGS' using errcode = '22023';
  end if;

  select count(*)::integer
  into existing_count
  from public.tags as tag
  where tag.id = any(coalesce(p_tag_ids, '{}'::uuid[]));

  if existing_count <> requested_count then
    raise exception 'INVALID_TAGS' using errcode = '23503';
  end if;
end;
$$;

create function private.claim_entry_dispatch(p_entry_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  claimed boolean := false;
begin
  update public.entries as entry
  set dispatch_lease_until = statement_timestamp() + interval '1 minute'
  where entry.id = p_entry_id
    and entry.status = 'queued'::public.entry_status
    and (
      entry.dispatch_lease_until is null
      or entry.dispatch_lease_until <= statement_timestamp()
    )
    and not exists (
      select 1
      from public.processing_attempts as processing_attempt
      where processing_attempt.entry_id = entry.id
        and processing_attempt.status in (
          'queued'::public.processing_attempt_status,
          'running'::public.processing_attempt_status
        )
    )
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

create function private.submit_entry_for_user(
  p_actor_user_id uuid,
  p_actor_role public.app_role,
  p_actor_token_id uuid,
  p_url text,
  p_canonical_url text,
  p_source_type public.entry_source_type,
  p_tag_ids uuid[]
)
returns table (
  id uuid,
  status public.entry_status,
  created boolean,
  dispatch_required boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_entry public.entries;
  should_dispatch boolean;
begin
  if p_actor_role not in (
    'contributor'::public.app_role,
    'administrator'::public.app_role
  ) or not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_actor_user_id
      and profile.role = p_actor_role
      and profile.is_active
  ) then
    raise exception 'ENTRY_FORBIDDEN' using errcode = '42501';
  end if;

  p_url := btrim(p_url);
  p_canonical_url := btrim(p_canonical_url);
  p_tag_ids := coalesce(p_tag_ids, '{}'::uuid[]);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'curio:canonical-url:' || p_canonical_url,
      0
    )
  );

  select entry.*
  into created_entry
  from public.entries as entry
  where entry.canonical_url = p_canonical_url;

  if created_entry.id is not null then
    should_dispatch := private.claim_entry_dispatch(created_entry.id);
    return query
    select
      created_entry.id,
      created_entry.status,
      false,
      should_dispatch;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'curio:entry-submission:' || p_actor_user_id::text,
      0
    )
  );

  if (
    select count(*)
    from public.audit_events as audit_event
    where audit_event.actor_user_id = p_actor_user_id
      and audit_event.event_type = 'entry.submitted'
      and audit_event.created_at > statement_timestamp() - interval '1 minute'
  ) >= 5 then
    raise exception 'RATE_LIMIT_EXCEEDED' using errcode = 'P0001';
  end if;

  perform private.assert_valid_tag_ids(p_tag_ids);

  begin
    insert into public.entries (
      url,
      canonical_url,
      source_type,
      status,
      created_by,
      dispatch_lease_until
    )
    values (
      p_url,
      p_canonical_url,
      p_source_type,
      'queued'::public.entry_status,
      p_actor_user_id,
      statement_timestamp() + interval '1 minute'
    )
    returning * into created_entry;
  exception
    when unique_violation then
      select entry.*
      into created_entry
      from public.entries as entry
      where entry.canonical_url = p_canonical_url;
      if created_entry.id is null then raise; end if;
      should_dispatch := private.claim_entry_dispatch(created_entry.id);
      return query
      select
        created_entry.id,
        created_entry.status,
        false,
        should_dispatch;
      return;
  end;

  insert into public.entry_tags (entry_id, tag_id)
  select created_entry.id, requested.tag_id
  from unnest(p_tag_ids) as requested(tag_id);

  insert into public.audit_events (
    actor_user_id,
    actor_token_id,
    event_type,
    target_table,
    target_id,
    payload
  )
  values (
    p_actor_user_id,
    p_actor_token_id,
    'entry.submitted',
    'entries',
    created_entry.id,
    jsonb_build_object(
      'source_type', p_source_type::text,
      'tag_count', cardinality(p_tag_ids)
    )
  );

  return query select created_entry.id, created_entry.status, true, true;
end;
$$;

create function public.submit_entry(
  p_actor_user_id uuid,
  p_url text,
  p_canonical_url text,
  p_source_type public.entry_source_type,
  p_tag_ids uuid[] default '{}'::uuid[]
)
returns table (
  id uuid,
  status public.entry_status,
  created boolean,
  dispatch_required boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := p_actor_user_id;
  actor_role public.app_role;
begin
  if auth.uid() is distinct from actor_id then
    raise exception 'ENTRY_FORBIDDEN' using errcode = '42501';
  end if;

  actor_role := public.current_app_role();

  return query
  select
    submitted.id,
    submitted.status,
    submitted.created,
    submitted.dispatch_required
  from private.submit_entry_for_user(
    actor_id,
    actor_role,
    null,
    p_url,
    p_canonical_url,
    p_source_type,
    p_tag_ids
  ) as submitted;
end;
$$;

create function public.submit_entry_with_token(
  p_token_hash text,
  p_url text,
  p_canonical_url text,
  p_source_type public.entry_source_type,
  p_tag_ids uuid[] default '{}'::uuid[]
)
returns table (
  id uuid,
  status public.entry_status,
  created boolean,
  dispatch_required boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  token_id uuid;
  actor_id uuid;
  actor_role public.app_role;
begin
  select identity.token_id, identity.user_id, identity.role
  into token_id, actor_id, actor_role
  from private.resolve_api_token(
    p_token_hash,
    array['entries:write']::text[]
  ) as identity;

  if token_id is null then
    raise exception 'INVALID_API_TOKEN' using errcode = '42501';
  end if;

  return query
  select
    submitted.id,
    submitted.status,
    submitted.created,
    submitted.dispatch_required
  from private.submit_entry_for_user(
    actor_id,
    actor_role,
    token_id,
    p_url,
    p_canonical_url,
    p_source_type,
    p_tag_ids
  ) as submitted;
end;
$$;

create function private.retry_entry_for_user(
  p_actor_user_id uuid,
  p_actor_role public.app_role,
  p_actor_token_id uuid,
  p_entry_id uuid
)
returns table (
  id uuid,
  status public.entry_status,
  dispatch_required boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_entry public.entries;
  should_dispatch boolean := false;
begin
  select entry.*
  into target_entry
  from public.entries as entry
  where entry.id = p_entry_id
  for update;

  if target_entry.id is null then
    raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_actor_role not in (
    'contributor'::public.app_role,
    'administrator'::public.app_role
  ) or not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_actor_user_id
      and profile.role = p_actor_role
      and profile.is_active
  ) or (
    p_actor_role <> 'administrator'::public.app_role
    and target_entry.created_by is distinct from p_actor_user_id
  ) then
    raise exception 'ENTRY_FORBIDDEN' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'curio:entry-retry:' || p_actor_user_id::text,
      0
    )
  );

  if target_entry.status = 'queued'::public.entry_status then
    should_dispatch := private.claim_entry_dispatch(p_entry_id);

    if should_dispatch then
      if (
        select count(*)
        from public.audit_events as audit_event
        where audit_event.actor_user_id = p_actor_user_id
          and audit_event.event_type in (
            'entry.retry_requested',
            'entry.retry_redispatched'
          )
          and audit_event.created_at > statement_timestamp() - interval '1 minute'
      ) >= 5 then
        raise exception 'RATE_LIMIT_EXCEEDED' using errcode = 'P0001';
      end if;

      insert into public.audit_events (
        actor_user_id,
        actor_token_id,
        event_type,
        target_table,
        target_id
      )
      values (
        p_actor_user_id,
        p_actor_token_id,
        'entry.retry_redispatched',
        'entries',
        p_entry_id
      );
    end if;

    return query select target_entry.id, target_entry.status, should_dispatch;
    return;
  end if;

  if target_entry.status <> 'failed'::public.entry_status then
    raise exception 'INVALID_ENTRY_STATE' using errcode = 'P0001';
  end if;

  if (
    select count(*)
    from public.audit_events as audit_event
    where audit_event.actor_user_id = p_actor_user_id
      and audit_event.event_type in (
        'entry.retry_requested',
        'entry.retry_redispatched'
      )
      and audit_event.created_at > statement_timestamp() - interval '1 minute'
  ) >= 5 then
    raise exception 'RATE_LIMIT_EXCEEDED' using errcode = 'P0001';
  end if;

  update public.entries as entry
  set status = 'queued'::public.entry_status,
      error_code = null,
      error_message = null,
      published_at = null,
      dispatch_lease_until = statement_timestamp() + interval '1 minute'
  where entry.id = p_entry_id
  returning * into target_entry;

  insert into public.audit_events (
    actor_user_id,
    actor_token_id,
    event_type,
    target_table,
    target_id
  )
  values (
    p_actor_user_id,
    p_actor_token_id,
    'entry.retry_requested',
    'entries',
    p_entry_id
  );

  return query select target_entry.id, target_entry.status, true;
end;
$$;

create function public.retry_entry(
  p_actor_user_id uuid,
  p_entry_id uuid
)
returns table (
  id uuid,
  status public.entry_status,
  dispatch_required boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := p_actor_user_id;
  actor_role public.app_role;
begin
  if auth.uid() is distinct from actor_id then
    raise exception 'ENTRY_FORBIDDEN' using errcode = '42501';
  end if;

  actor_role := public.current_app_role();

  return query
  select retried.id, retried.status, retried.dispatch_required
  from private.retry_entry_for_user(
    actor_id,
    actor_role,
    null,
    p_entry_id
  ) as retried;
end;
$$;

create function public.retry_entry_with_token(
  p_token_hash text,
  p_entry_id uuid
)
returns table (
  id uuid,
  status public.entry_status,
  dispatch_required boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  token_id uuid;
  actor_id uuid;
  actor_role public.app_role;
begin
  select identity.token_id, identity.user_id, identity.role
  into token_id, actor_id, actor_role
  from private.resolve_api_token(
    p_token_hash,
    array['entries:write']::text[]
  ) as identity;

  if token_id is null then
    raise exception 'INVALID_API_TOKEN' using errcode = '42501';
  end if;

  return query
  select retried.id, retried.status, retried.dispatch_required
  from private.retry_entry_for_user(
    actor_id,
    actor_role,
    token_id,
    p_entry_id
  ) as retried;
end;
$$;

create function public.update_entry(
  p_actor_user_id uuid,
  p_entry_id uuid,
  p_title text,
  p_tldr text,
  p_source_type public.entry_source_type,
  p_tag_ids uuid[]
)
returns setof public.entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := p_actor_user_id;
  actor_role public.app_role;
  target_entry public.entries;
begin
  if auth.uid() is distinct from actor_id then
    raise exception 'ENTRY_FORBIDDEN' using errcode = '42501';
  end if;

  actor_role := public.current_app_role();

  select entry.*
  into target_entry
  from public.entries as entry
  where entry.id = p_entry_id
  for update;

  if target_entry.id is null then
    raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0002';
  end if;

  if actor_role not in (
    'contributor'::public.app_role,
    'administrator'::public.app_role
  ) or (
    actor_role <> 'administrator'::public.app_role
    and target_entry.created_by is distinct from actor_id
  ) then
    raise exception 'ENTRY_FORBIDDEN' using errcode = '42501';
  end if;

  if target_entry.status not in (
    'ready'::public.entry_status,
    'failed'::public.entry_status
  ) then
    raise exception 'INVALID_ENTRY_STATE' using errcode = 'P0001';
  end if;

  if p_tag_ids is not null then
    perform private.assert_valid_tag_ids(p_tag_ids);
  end if;

  if coalesce(nullif(btrim(p_title), ''), target_entry.title) is null
     or coalesce(nullif(btrim(p_tldr), ''), target_entry.tldr) is null then
    raise exception 'INVALID_ENTRY_STATE' using errcode = 'P0001';
  end if;

  update public.entries as entry
  set title = coalesce(nullif(btrim(p_title), ''), entry.title),
      tldr = coalesce(nullif(btrim(p_tldr), ''), entry.tldr),
      source_type = coalesce(p_source_type, entry.source_type)
  where entry.id = p_entry_id
  returning * into target_entry;

  if p_tag_ids is not null then
    delete from public.entry_tags as entry_tag
    where entry_tag.entry_id = p_entry_id;

    insert into public.entry_tags (entry_id, tag_id)
    select p_entry_id, requested.tag_id
    from unnest(p_tag_ids) as requested(tag_id);
  end if;

  insert into public.audit_events (
    actor_user_id,
    event_type,
    target_table,
    target_id,
    payload
  )
  values (
    actor_id,
    'entry.updated',
    'entries',
    p_entry_id,
    jsonb_build_object('tags_replaced', p_tag_ids is not null)
  );

  return query
  select entry.*
  from public.entries as entry
  where entry.id = p_entry_id;
end;
$$;

create function public.delete_entry(
  p_actor_user_id uuid,
  p_entry_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := p_actor_user_id;
  actor_role public.app_role;
  target_entry public.entries;
  old_thumbnail_path text;
begin
  if auth.uid() is distinct from actor_id then
    raise exception 'ENTRY_FORBIDDEN' using errcode = '42501';
  end if;

  actor_role := public.current_app_role();

  select entry.*
  into target_entry
  from public.entries as entry
  where entry.id = p_entry_id
  for update;

  if target_entry.id is null then
    raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0002';
  end if;

  if actor_role not in (
    'contributor'::public.app_role,
    'administrator'::public.app_role
  ) or (
    actor_role <> 'administrator'::public.app_role
    and target_entry.created_by is distinct from actor_id
  ) then
    raise exception 'ENTRY_FORBIDDEN' using errcode = '42501';
  end if;

  old_thumbnail_path := target_entry.thumbnail_path;

  delete from public.entries as entry
  where entry.id = p_entry_id;

  insert into public.audit_events (
    actor_user_id,
    event_type,
    target_table,
    target_id,
    payload
  )
  values (
    actor_id,
    'entry.deleted',
    'entries',
    p_entry_id,
    jsonb_build_object('thumbnail_path', old_thumbnail_path)
  );

  return old_thumbnail_path;
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
      entry.error_message
    from public.entries as entry
    where (p_source_type is null or entry.source_type = p_source_type)
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

create function public.reserve_thumbnail_upload(
  p_actor_user_id uuid,
  p_entry_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.app_role;
  target_entry public.entries;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'curio:thumbnail-upload:' || p_actor_user_id::text,
      0
    )
  );

  select profile.role
  into actor_role
  from public.profiles as profile
  where profile.id = p_actor_user_id
    and profile.is_active;

  select entry.*
  into target_entry
  from public.entries as entry
  where entry.id = p_entry_id
  for update;

  if target_entry.id is null then
    raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0002';
  end if;

  if actor_role not in (
    'contributor'::public.app_role,
    'administrator'::public.app_role
  ) or (
    actor_role <> 'administrator'::public.app_role
    and target_entry.created_by is distinct from p_actor_user_id
  ) then
    raise exception 'ENTRY_FORBIDDEN' using errcode = '42501';
  end if;

  if target_entry.status not in (
    'ready'::public.entry_status,
    'failed'::public.entry_status
  ) then
    raise exception 'INVALID_ENTRY_STATE' using errcode = 'P0001';
  end if;

  if (
    select count(*)
    from public.audit_events as audit_event
    where audit_event.actor_user_id = p_actor_user_id
      and audit_event.event_type = 'thumbnail.upload_prepared'
      and audit_event.created_at > statement_timestamp() - interval '10 minutes'
  ) >= 5 then
    raise exception 'RATE_LIMIT_EXCEEDED' using errcode = 'P0001';
  end if;

  insert into public.audit_events (
    actor_user_id,
    event_type,
    target_table,
    target_id,
    payload
  )
  values (
    p_actor_user_id,
    'thumbnail.upload_prepared',
    'entries',
    p_entry_id,
    jsonb_build_object('limit', 5, 'window_seconds', 600)
  );
end;
$$;

create function public.replace_entry_thumbnail(
  p_actor_user_id uuid,
  p_entry_id uuid,
  p_thumbnail_path text
)
returns table (
  id uuid,
  thumbnail_path text,
  previous_thumbnail_path text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := p_actor_user_id;
  actor_role public.app_role;
  target_entry public.entries;
  old_thumbnail_path text;
begin
  select profile.role
  into actor_role
  from public.profiles as profile
  where profile.id = actor_id
    and profile.is_active;

  select entry.*
  into target_entry
  from public.entries as entry
  where entry.id = p_entry_id
  for update;

  if target_entry.id is null then
    raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0002';
  end if;

  if actor_role not in (
    'contributor'::public.app_role,
    'administrator'::public.app_role
  ) or (
    actor_role <> 'administrator'::public.app_role
    and target_entry.created_by is distinct from actor_id
  ) then
    raise exception 'ENTRY_FORBIDDEN' using errcode = '42501';
  end if;

  if target_entry.status not in (
    'ready'::public.entry_status,
    'failed'::public.entry_status
  ) then
    raise exception 'INVALID_ENTRY_STATE' using errcode = 'P0001';
  end if;

  p_thumbnail_path := btrim(p_thumbnail_path);
  if p_thumbnail_path is null
     or p_thumbnail_path !~ (
       '^' || p_entry_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webp$'
     ) then
    raise exception 'INVALID_THUMBNAIL_PATH' using errcode = '22023';
  end if;

  old_thumbnail_path := nullif(target_entry.thumbnail_path, p_thumbnail_path);
  update public.entries as entry
  set thumbnail_path = p_thumbnail_path
  where entry.id = p_entry_id;

  insert into public.audit_events (
    actor_user_id,
    event_type,
    target_table,
    target_id,
    payload
  )
  values (
    actor_id,
    'entry.thumbnail_replaced',
    'entries',
    p_entry_id,
    jsonb_build_object(
      'thumbnail_path', p_thumbnail_path,
      'previous_thumbnail_path', old_thumbnail_path
    )
  );

  return query
  select p_entry_id, p_thumbnail_path, old_thumbnail_path;
end;
$$;

create function public.begin_processing_attempt(
  p_entry_id uuid,
  p_workflow_run_id text
)
returns table (
  id uuid,
  attempt integer,
  status public.processing_attempt_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_entry public.entries;
  existing_attempt public.processing_attempts;
  created_attempt public.processing_attempts;
  next_attempt integer;
begin
  select processing_attempt.*
  into existing_attempt
  from public.processing_attempts as processing_attempt
  where processing_attempt.workflow_run_id = p_workflow_run_id;

  if existing_attempt.id is not null then
    if existing_attempt.entry_id <> p_entry_id then
      raise exception 'WORKFLOW_RUN_CONFLICT' using errcode = '23505';
    end if;
    return query
    select existing_attempt.id, existing_attempt.attempt, existing_attempt.status;
    return;
  end if;

  select entry.*
  into target_entry
  from public.entries as entry
  where entry.id = p_entry_id
  for update;

  if target_entry.id is null then
    raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if target_entry.status <> 'queued'::public.entry_status then
    raise exception 'INVALID_ENTRY_STATE' using errcode = 'P0001';
  end if;
  if exists (
    select 1
    from public.processing_attempts as processing_attempt
    where processing_attempt.entry_id = p_entry_id
      and processing_attempt.status in (
        'queued'::public.processing_attempt_status,
        'running'::public.processing_attempt_status
      )
  ) then
    raise exception 'PROCESSING_ATTEMPT_ACTIVE' using errcode = 'P0001';
  end if;

  select coalesce(max(processing_attempt.attempt), 0) + 1
  into next_attempt
  from public.processing_attempts as processing_attempt
  where processing_attempt.entry_id = p_entry_id;

  insert into public.processing_attempts (
    entry_id,
    workflow_run_id,
    attempt,
    status
  )
  values (
    p_entry_id,
    p_workflow_run_id,
    next_attempt,
    'queued'::public.processing_attempt_status
  )
  returning * into created_attempt;

  update public.entries as entry
  set dispatch_lease_until = null
  where entry.id = p_entry_id;

  return query
  select created_attempt.id, created_attempt.attempt, created_attempt.status;
end;
$$;

create function public.fail_entry_dispatch(
  p_entry_id uuid,
  p_error_code text,
  p_error_message text
)
returns setof public.entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_entry public.entries;
begin
  select entry.*
  into target_entry
  from public.entries as entry
  where entry.id = p_entry_id
  for update;

  if target_entry.id is null then
    raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0002';
  end if;

  p_error_code := left(
    coalesce(nullif(btrim(p_error_code), ''), 'WORKFLOW_START_FAILED'),
    100
  );
  p_error_message := left(
    coalesce(nullif(btrim(p_error_message), ''), 'Entry dispatch failed'),
    1000
  );

  if target_entry.status = 'failed'::public.entry_status
     and target_entry.error_code = p_error_code
     and not exists (
       select 1
       from public.processing_attempts as processing_attempt
       where processing_attempt.entry_id = p_entry_id
         and processing_attempt.status in (
           'queued'::public.processing_attempt_status,
           'running'::public.processing_attempt_status
         )
     ) then
    return query
    select entry.* from public.entries as entry where entry.id = p_entry_id;
    return;
  end if;

  if target_entry.status <> 'queued'::public.entry_status
     or exists (
       select 1
       from public.processing_attempts as processing_attempt
       where processing_attempt.entry_id = p_entry_id
         and processing_attempt.status in (
           'queued'::public.processing_attempt_status,
           'running'::public.processing_attempt_status
         )
     ) then
    raise exception 'INVALID_ENTRY_STATE' using errcode = 'P0001';
  end if;

  update public.entries as entry
  set status = 'failed'::public.entry_status,
      error_code = p_error_code,
      error_message = p_error_message,
      published_at = null,
      dispatch_lease_until = null
  where entry.id = p_entry_id;

  insert into public.audit_events (
    actor_user_id,
    event_type,
    target_table,
    target_id,
    payload
  )
  values (
    target_entry.created_by,
    'entry.dispatch_failed',
    'entries',
    p_entry_id,
    jsonb_build_object('error_code', p_error_code)
  );

  return query
  select entry.* from public.entries as entry where entry.id = p_entry_id;
end;
$$;

create function public.mark_entry_analyzing(
  p_entry_id uuid,
  p_attempt_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_entry public.entries;
  target_attempt public.processing_attempts;
begin
  select entry.* into target_entry
  from public.entries as entry
  where entry.id = p_entry_id
  for update;

  select processing_attempt.* into target_attempt
  from public.processing_attempts as processing_attempt
  where processing_attempt.id = p_attempt_id
    and processing_attempt.entry_id = p_entry_id
  for update;

  if target_entry.id is null then
    raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if target_attempt.id is null then
    raise exception 'PROCESSING_ATTEMPT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if target_entry.status = 'analyzing'::public.entry_status
     and target_attempt.status = 'running'::public.processing_attempt_status then
    return;
  end if;

  if target_entry.status <> 'queued'::public.entry_status
     or target_attempt.status <> 'queued'::public.processing_attempt_status then
    raise exception 'INVALID_ENTRY_STATE' using errcode = 'P0001';
  end if;

  update public.processing_attempts as processing_attempt
  set status = 'running'::public.processing_attempt_status,
      started_at = coalesce(processing_attempt.started_at, statement_timestamp())
  where processing_attempt.id = p_attempt_id;

  update public.entries as entry
  set status = 'analyzing'::public.entry_status,
      error_code = null,
      error_message = null,
      dispatch_lease_until = null
  where entry.id = p_entry_id;
end;
$$;

create function public.mark_entry_finalizing(
  p_entry_id uuid,
  p_attempt_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_entry public.entries;
  target_attempt public.processing_attempts;
begin
  select entry.* into target_entry
  from public.entries as entry
  where entry.id = p_entry_id
  for update;

  select processing_attempt.* into target_attempt
  from public.processing_attempts as processing_attempt
  where processing_attempt.id = p_attempt_id
    and processing_attempt.entry_id = p_entry_id
  for update;

  if target_entry.id is null then
    raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if target_attempt.id is null then
    raise exception 'PROCESSING_ATTEMPT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if target_entry.status = 'finalizing'::public.entry_status
     and target_attempt.status = 'running'::public.processing_attempt_status then
    return;
  end if;

  if target_entry.status <> 'analyzing'::public.entry_status
     or target_attempt.status <> 'running'::public.processing_attempt_status then
    raise exception 'INVALID_ENTRY_STATE' using errcode = 'P0001';
  end if;

  update public.entries as entry
  set status = 'finalizing'::public.entry_status
  where entry.id = p_entry_id;
end;
$$;

create function public.finalize_entry_processing(
  p_entry_id uuid,
  p_attempt_id uuid,
  p_title text,
  p_tldr text,
  p_thumbnail_path text,
  p_tag_ids uuid[] default '{}'::uuid[]
)
returns table (
  id uuid,
  status public.entry_status,
  previous_thumbnail_path text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_entry public.entries;
  target_attempt public.processing_attempts;
  old_thumbnail_path text;
begin
  select entry.* into target_entry
  from public.entries as entry
  where entry.id = p_entry_id
  for update;

  select processing_attempt.* into target_attempt
  from public.processing_attempts as processing_attempt
  where processing_attempt.id = p_attempt_id
    and processing_attempt.entry_id = p_entry_id
  for update;

  if target_entry.id is null then
    raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if target_attempt.id is null then
    raise exception 'PROCESSING_ATTEMPT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if target_entry.status = 'ready'::public.entry_status
     and target_attempt.status = 'succeeded'::public.processing_attempt_status then
    return query
    select
      target_entry.id,
      target_entry.status,
      target_attempt.metadata ->> 'previous_thumbnail_path';
    return;
  end if;

  if target_entry.status <> 'finalizing'::public.entry_status
     or target_attempt.status <> 'running'::public.processing_attempt_status then
    raise exception 'INVALID_ENTRY_STATE' using errcode = 'P0001';
  end if;

  p_title := btrim(p_title);
  p_tldr := btrim(p_tldr);
  p_thumbnail_path := btrim(p_thumbnail_path);
  p_tag_ids := coalesce(p_tag_ids, '{}'::uuid[]);
  perform private.assert_valid_tag_ids(p_tag_ids);
  old_thumbnail_path := nullif(target_entry.thumbnail_path, p_thumbnail_path);

  delete from public.entry_tags as entry_tag
  where entry_tag.entry_id = p_entry_id;

  insert into public.entry_tags (entry_id, tag_id)
  select p_entry_id, requested.tag_id
  from unnest(p_tag_ids) as requested(tag_id);

  update public.entries as entry
  set title = p_title,
      tldr = p_tldr,
      thumbnail_path = p_thumbnail_path,
      status = 'ready'::public.entry_status,
      error_code = null,
      error_message = null,
      dispatch_lease_until = null,
      published_at = statement_timestamp()
  where entry.id = p_entry_id
  returning * into target_entry;

  update public.processing_attempts as processing_attempt
  set status = 'succeeded'::public.processing_attempt_status,
      retryable = false,
      error_code = null,
      error_message = null,
      metadata = processing_attempt.metadata || jsonb_build_object(
        'previous_thumbnail_path', old_thumbnail_path
      ),
      finished_at = statement_timestamp()
  where processing_attempt.id = p_attempt_id;

  insert into public.audit_events (
    actor_user_id,
    event_type,
    target_table,
    target_id,
    payload
  )
  values (
    target_entry.created_by,
    'entry.processing_succeeded',
    'entries',
    p_entry_id,
    jsonb_build_object('attempt_id', p_attempt_id, 'tag_count', cardinality(p_tag_ids))
  );

  return query select target_entry.id, target_entry.status, old_thumbnail_path;
end;
$$;

create function public.fail_entry_processing(
  p_entry_id uuid,
  p_attempt_id uuid,
  p_error_code text,
  p_error_message text,
  p_retryable boolean default false
)
returns table (
  id uuid,
  status public.entry_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_entry public.entries;
  target_attempt public.processing_attempts;
begin
  select entry.* into target_entry
  from public.entries as entry
  where entry.id = p_entry_id
  for update;

  select processing_attempt.* into target_attempt
  from public.processing_attempts as processing_attempt
  where processing_attempt.id = p_attempt_id
    and processing_attempt.entry_id = p_entry_id
  for update;

  if target_entry.id is null then
    raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if target_attempt.id is null then
    raise exception 'PROCESSING_ATTEMPT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if target_entry.status = 'failed'::public.entry_status
     and target_attempt.status = 'failed'::public.processing_attempt_status then
    return query select target_entry.id, target_entry.status;
    return;
  end if;

  if target_entry.status = 'ready'::public.entry_status
     or target_attempt.status = 'succeeded'::public.processing_attempt_status then
    raise exception 'INVALID_ENTRY_STATE' using errcode = 'P0001';
  end if;

  p_error_code := left(coalesce(nullif(btrim(p_error_code), ''), 'PIPELINE_FAILED'), 100);
  p_error_message := left(
    coalesce(nullif(btrim(p_error_message), ''), 'Entry processing failed'),
    1000
  );

  update public.processing_attempts as processing_attempt
  set status = 'failed'::public.processing_attempt_status,
      retryable = coalesce(p_retryable, false),
      error_code = p_error_code,
      error_message = p_error_message,
      started_at = coalesce(processing_attempt.started_at, statement_timestamp()),
      finished_at = statement_timestamp()
  where processing_attempt.id = p_attempt_id;

  update public.entries as entry
  set status = 'failed'::public.entry_status,
      error_code = p_error_code,
      error_message = p_error_message,
      published_at = null,
      dispatch_lease_until = null
  where entry.id = p_entry_id
  returning * into target_entry;

  insert into public.audit_events (
    actor_user_id,
    event_type,
    target_table,
    target_id,
    payload
  )
  values (
    target_entry.created_by,
    'entry.processing_failed',
    'entries',
    p_entry_id,
    jsonb_build_object(
      'attempt_id', p_attempt_id,
      'error_code', p_error_code,
      'retryable', coalesce(p_retryable, false)
    )
  );

  return query select target_entry.id, target_entry.status;
end;
$$;

revoke all on function private.assert_valid_tag_ids(uuid[]) from public;
revoke all on function private.submit_entry_for_user(
  uuid,
  public.app_role,
  uuid,
  text,
  text,
  public.entry_source_type,
  uuid[]
) from public;
revoke all on function private.retry_entry_for_user(
  uuid,
  public.app_role,
  uuid,
  uuid
) from public;

commit;
