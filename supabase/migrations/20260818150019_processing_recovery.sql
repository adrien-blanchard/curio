begin;

create type public.thumbnail_origin as enum ('automatic', 'manual');

alter table public.entries
  add column processing_heartbeat_at timestamptz not null default statement_timestamp(),
  add column thumbnail_origin public.thumbnail_origin;

create function private.infer_thumbnail_origin(
  p_entry_id uuid,
  p_thumbnail_path text
)
returns public.thumbnail_origin
language sql
stable
set search_path = ''
as $$
  select case
    when p_thumbnail_path is null then null
    when (
      select audit_event.event_type
      from public.audit_events as audit_event
      where audit_event.target_table = 'entries'
        and audit_event.target_id = p_entry_id
        and audit_event.event_type in (
          'entry.thumbnail_replaced',
          'entry.processing_succeeded'
        )
      order by audit_event.created_at desc, audit_event.id desc
      limit 1
    ) = 'entry.thumbnail_replaced' then 'manual'::public.thumbnail_origin
    else 'automatic'::public.thumbnail_origin
  end;
$$;

revoke all on function private.infer_thumbnail_origin(uuid, text) from public;

update public.entries as entry
set thumbnail_origin = private.infer_thumbnail_origin(
  entry.id,
  entry.thumbnail_path
);

alter table public.entries
  add constraint entries_thumbnail_origin_shape check (
    (thumbnail_path is null and thumbnail_origin is null)
    or (thumbnail_path is not null and thumbnail_origin is not null)
  );

comment on column public.entries.processing_heartbeat_at is
  'Last durable progress signal for the active processing lifecycle.';
comment on column public.entries.thumbnail_origin is
  'Whether the current private thumbnail was generated automatically or uploaded manually.';

create function private.normalize_entry_processing_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.thumbnail_path is null then
    new.thumbnail_origin := null;
  elsif new.thumbnail_origin is null then
    new.thumbnail_origin := 'automatic'::public.thumbnail_origin;
  end if;

  if tg_op = 'INSERT' then
    new.processing_heartbeat_at := coalesce(
      new.processing_heartbeat_at,
      statement_timestamp()
    );
  elsif new.status is distinct from old.status then
    new.processing_heartbeat_at := statement_timestamp();
  end if;

  return new;
end;
$$;

create trigger entries_normalize_processing_fields
before insert or update of status, thumbnail_path, thumbnail_origin
on public.entries
for each row execute function private.normalize_entry_processing_fields();

with ranked_active_attempts as (
  select
    processing_attempt.id,
    row_number() over (
      partition by processing_attempt.entry_id
      order by processing_attempt.created_at desc, processing_attempt.id desc
    ) as active_rank
  from public.processing_attempts as processing_attempt
  where processing_attempt.status in (
    'queued'::public.processing_attempt_status,
    'running'::public.processing_attempt_status
  )
)
update public.processing_attempts as processing_attempt
set status = 'cancelled'::public.processing_attempt_status,
    retryable = false,
    finished_at = statement_timestamp(),
    metadata = processing_attempt.metadata || jsonb_build_object(
      'cancelled_by', 'processing_recovery_migration'
    )
from ranked_active_attempts as ranked_attempt
where processing_attempt.id = ranked_attempt.id
  and ranked_attempt.active_rank > 1;

create unique index processing_attempts_one_active_per_entry_idx
  on public.processing_attempts (entry_id)
  where status in ('queued', 'running');

create or replace function private.claim_entry_dispatch(p_entry_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  claimed boolean := false;
begin
  update public.entries as entry
  set dispatch_lease_until = statement_timestamp() + interval '1 minute',
      processing_heartbeat_at = statement_timestamp()
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

create or replace function public.replace_entry_thumbnail(
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
  set thumbnail_path = p_thumbnail_path,
      thumbnail_origin = 'manual'::public.thumbnail_origin
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
      'thumbnail_origin', 'manual',
      'previous_thumbnail_path', old_thumbnail_path
    )
  );

  return query
  select p_entry_id, p_thumbnail_path, old_thumbnail_path;
end;
$$;

create or replace function public.begin_processing_attempt(
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
  select entry.*
  into target_entry
  from public.entries as entry
  where entry.id = p_entry_id
  for update;

  if target_entry.id is null then
    raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0002';
  end if;

  select processing_attempt.*
  into existing_attempt
  from public.processing_attempts as processing_attempt
  where processing_attempt.workflow_run_id = p_workflow_run_id
  for update;

  if existing_attempt.id is not null then
    if existing_attempt.entry_id <> p_entry_id then
      raise exception 'WORKFLOW_RUN_CONFLICT' using errcode = '23505';
    end if;
    if existing_attempt.error_code = 'PROCESSING_TIMEOUT' then
      raise exception 'PROCESSING_TIMEOUT' using errcode = 'P0001';
    end if;

    if existing_attempt.status in (
      'queued'::public.processing_attempt_status,
      'running'::public.processing_attempt_status
    ) then
      update public.entries as entry
      set processing_heartbeat_at = statement_timestamp()
      where entry.id = p_entry_id;
    end if;

    return query
    select existing_attempt.id, existing_attempt.attempt, existing_attempt.status;
    return;
  end if;

  if target_entry.error_code = 'PROCESSING_TIMEOUT' then
    raise exception 'PROCESSING_TIMEOUT' using errcode = 'P0001';
  end if;
  if target_entry.status <> 'queued'::public.entry_status then
    raise exception 'INVALID_ENTRY_STATE' using errcode = 'P0001';
  end if;

  select coalesce(max(processing_attempt.attempt), 0) + 1
  into next_attempt
  from public.processing_attempts as processing_attempt
  where processing_attempt.entry_id = p_entry_id;

  begin
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
  exception
    when unique_violation then
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
      raise;
  end;

  update public.entries as entry
  set dispatch_lease_until = null,
      processing_heartbeat_at = statement_timestamp()
  where entry.id = p_entry_id;

  return query
  select created_attempt.id, created_attempt.attempt, created_attempt.status;
end;
$$;

create or replace function public.fail_entry_dispatch(
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
      dispatch_lease_until = null,
      processing_heartbeat_at = statement_timestamp()
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

create or replace function public.mark_entry_analyzing(
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
  if target_attempt.error_code = 'PROCESSING_TIMEOUT' then
    raise exception 'PROCESSING_TIMEOUT' using errcode = 'P0001';
  end if;

  if target_entry.status = 'analyzing'::public.entry_status
     and target_attempt.status = 'running'::public.processing_attempt_status then
    update public.entries as entry
    set processing_heartbeat_at = statement_timestamp()
    where entry.id = p_entry_id;
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
      dispatch_lease_until = null,
      processing_heartbeat_at = statement_timestamp()
  where entry.id = p_entry_id;
end;
$$;

create or replace function public.mark_entry_finalizing(
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
  if target_attempt.error_code = 'PROCESSING_TIMEOUT' then
    raise exception 'PROCESSING_TIMEOUT' using errcode = 'P0001';
  end if;

  if target_entry.status = 'finalizing'::public.entry_status
     and target_attempt.status = 'running'::public.processing_attempt_status then
    update public.entries as entry
    set processing_heartbeat_at = statement_timestamp()
    where entry.id = p_entry_id;
    return;
  end if;

  if target_entry.status <> 'analyzing'::public.entry_status
     or target_attempt.status <> 'running'::public.processing_attempt_status then
    raise exception 'INVALID_ENTRY_STATE' using errcode = 'P0001';
  end if;

  update public.entries as entry
  set status = 'finalizing'::public.entry_status,
      processing_heartbeat_at = statement_timestamp()
  where entry.id = p_entry_id;
end;
$$;

create function public.update_processing_heartbeat(
  p_entry_id uuid,
  p_attempt_id uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_entry public.entries;
  target_attempt public.processing_attempts;
  heartbeat_at timestamptz := statement_timestamp();
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
  if target_attempt.error_code = 'PROCESSING_TIMEOUT'
     or target_entry.error_code = 'PROCESSING_TIMEOUT' then
    raise exception 'PROCESSING_TIMEOUT' using errcode = 'P0001';
  end if;
  if target_attempt.status in (
    'succeeded'::public.processing_attempt_status,
    'failed'::public.processing_attempt_status,
    'cancelled'::public.processing_attempt_status
  ) then
    raise exception 'PROCESSING_ATTEMPT_TERMINAL' using errcode = 'P0001';
  end if;
  if target_attempt.status <> 'running'::public.processing_attempt_status
     or target_entry.status not in (
       'analyzing'::public.entry_status,
       'finalizing'::public.entry_status
     ) then
    raise exception 'INVALID_ENTRY_STATE' using errcode = 'P0001';
  end if;

  update public.processing_attempts as processing_attempt
  set updated_at = heartbeat_at
  where processing_attempt.id = p_attempt_id;

  update public.entries as entry
  set processing_heartbeat_at = heartbeat_at
  where entry.id = p_entry_id;

  return heartbeat_at;
end;
$$;

drop function public.finalize_entry_processing(uuid, uuid, text, text, text, uuid[]);

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
  thumbnail_path text,
  thumbnail_origin public.thumbnail_origin,
  previous_thumbnail_path text,
  discarded_thumbnail_path text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_entry public.entries;
  target_attempt public.processing_attempts;
  selected_thumbnail_path text;
  selected_thumbnail_origin public.thumbnail_origin;
  old_thumbnail_path text;
  discarded_candidate_path text;
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
  if target_attempt.error_code = 'PROCESSING_TIMEOUT' then
    raise exception 'PROCESSING_TIMEOUT' using errcode = 'P0001';
  end if;

  if target_entry.status = 'ready'::public.entry_status
     and target_attempt.status = 'succeeded'::public.processing_attempt_status then
    return query
    select
      target_entry.id,
      target_entry.status,
      target_entry.thumbnail_path,
      target_entry.thumbnail_origin,
      target_attempt.metadata ->> 'previous_thumbnail_path',
      target_attempt.metadata ->> 'discarded_thumbnail_path';
    return;
  end if;

  if target_entry.status <> 'finalizing'::public.entry_status
     or target_attempt.status <> 'running'::public.processing_attempt_status then
    raise exception 'INVALID_ENTRY_STATE' using errcode = 'P0001';
  end if;

  p_title := btrim(p_title);
  p_tldr := btrim(p_tldr);
  p_thumbnail_path := nullif(btrim(p_thumbnail_path), '');
  p_tag_ids := coalesce(p_tag_ids, '{}'::uuid[]);
  perform private.assert_valid_tag_ids(p_tag_ids);

  if target_entry.thumbnail_origin = 'manual'::public.thumbnail_origin
     and target_entry.thumbnail_path is not null then
    selected_thumbnail_path := target_entry.thumbnail_path;
    selected_thumbnail_origin := 'manual'::public.thumbnail_origin;
    old_thumbnail_path := null;
    discarded_candidate_path := nullif(p_thumbnail_path, target_entry.thumbnail_path);
  else
    selected_thumbnail_path := p_thumbnail_path;
    selected_thumbnail_origin := case
      when p_thumbnail_path is null then null
      else 'automatic'::public.thumbnail_origin
    end;
    old_thumbnail_path := nullif(target_entry.thumbnail_path, p_thumbnail_path);
    discarded_candidate_path := null;
  end if;

  delete from public.entry_tags as entry_tag
  where entry_tag.entry_id = p_entry_id;

  insert into public.entry_tags (entry_id, tag_id)
  select p_entry_id, requested.tag_id
  from unnest(p_tag_ids) as requested(tag_id);

  update public.entries as entry
  set title = p_title,
      tldr = p_tldr,
      thumbnail_path = selected_thumbnail_path,
      thumbnail_origin = selected_thumbnail_origin,
      status = 'ready'::public.entry_status,
      error_code = null,
      error_message = null,
      dispatch_lease_until = null,
      processing_heartbeat_at = statement_timestamp(),
      published_at = statement_timestamp()
  where entry.id = p_entry_id
  returning * into target_entry;

  update public.processing_attempts as processing_attempt
  set status = 'succeeded'::public.processing_attempt_status,
      retryable = false,
      error_code = null,
      error_message = null,
      metadata = processing_attempt.metadata || jsonb_build_object(
        'thumbnail_path', selected_thumbnail_path,
        'thumbnail_origin', selected_thumbnail_origin,
        'previous_thumbnail_path', old_thumbnail_path,
        'discarded_thumbnail_path', discarded_candidate_path
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
    jsonb_build_object(
      'attempt_id', p_attempt_id,
      'tag_count', cardinality(p_tag_ids),
      'thumbnail_origin', selected_thumbnail_origin
    )
  );

  return query
  select
    target_entry.id,
    target_entry.status,
    target_entry.thumbnail_path,
    target_entry.thumbnail_origin,
    old_thumbnail_path,
    discarded_candidate_path;
end;
$$;

create or replace function public.fail_entry_processing(
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
     or target_attempt.status in (
       'succeeded'::public.processing_attempt_status,
       'cancelled'::public.processing_attempt_status
     ) then
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
      dispatch_lease_until = null,
      processing_heartbeat_at = statement_timestamp()
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

create function public.expire_stale_entry_processing(p_cutoff timestamptz)
returns table (
  entry_id uuid,
  attempt_id uuid,
  workflow_run_id text,
  expired_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  expiry_timestamp timestamptz := statement_timestamp();
begin
  if p_cutoff is null or p_cutoff > expiry_timestamp then
    raise exception 'INVALID_PROCESSING_CUTOFF' using errcode = '22023';
  end if;

  return query
  with stale_entries as materialized (
    select
      entry.id as entry_id,
      entry.created_by,
      active_attempt.id as attempt_id,
      active_attempt.workflow_run_id
    from public.entries as entry
    left join lateral (
      select processing_attempt.id, processing_attempt.workflow_run_id
      from public.processing_attempts as processing_attempt
      where processing_attempt.entry_id = entry.id
        and processing_attempt.status in (
          'queued'::public.processing_attempt_status,
          'running'::public.processing_attempt_status
        )
      order by processing_attempt.created_at desc, processing_attempt.id desc
      limit 1
    ) as active_attempt on true
    where entry.status in (
      'queued'::public.entry_status,
      'analyzing'::public.entry_status,
      'finalizing'::public.entry_status
    )
      and entry.processing_heartbeat_at <= p_cutoff
    order by entry.processing_heartbeat_at, entry.id
    limit 20
    for update of entry skip locked
  ), expired_attempts as (
    update public.processing_attempts as processing_attempt
    set status = 'failed'::public.processing_attempt_status,
        retryable = true,
        error_code = 'PROCESSING_TIMEOUT',
        error_message = 'Processing timed out after 15 minutes without progress. Retry this entry to try again.',
        started_at = coalesce(processing_attempt.started_at, expiry_timestamp),
        finished_at = expiry_timestamp,
        metadata = processing_attempt.metadata || jsonb_build_object(
          'expired_at', expiry_timestamp,
          'cutoff', p_cutoff
        )
    from stale_entries as stale_entry
    where processing_attempt.id = stale_entry.attempt_id
      and processing_attempt.status in (
        'queued'::public.processing_attempt_status,
        'running'::public.processing_attempt_status
      )
    returning processing_attempt.id
  ), expired_entries as (
    update public.entries as entry
    set status = 'failed'::public.entry_status,
        error_code = 'PROCESSING_TIMEOUT',
        error_message = 'Processing timed out after 15 minutes without progress. Retry this entry to try again.',
        published_at = null,
        dispatch_lease_until = null,
        processing_heartbeat_at = expiry_timestamp
    from stale_entries as stale_entry
    where entry.id = stale_entry.entry_id
      and entry.status in (
        'queued'::public.entry_status,
        'analyzing'::public.entry_status,
        'finalizing'::public.entry_status
      )
      and entry.processing_heartbeat_at <= p_cutoff
      and (
        stale_entry.attempt_id is null
        or exists (
          select 1
          from expired_attempts as expired_attempt
          where expired_attempt.id = stale_entry.attempt_id
        )
      )
    returning entry.id, entry.created_by
  ), recorded_events as (
    insert into public.audit_events (
      actor_user_id,
      event_type,
      target_table,
      target_id,
      payload
    )
    select
      expired_entry.created_by,
      'entry.processing_timed_out',
      'entries',
      expired_entry.id,
      jsonb_build_object(
        'attempt_id', stale_entry.attempt_id,
        'workflow_run_id', stale_entry.workflow_run_id,
        'error_code', 'PROCESSING_TIMEOUT',
        'cutoff', p_cutoff
      )
    from expired_entries as expired_entry
    join stale_entries as stale_entry on stale_entry.entry_id = expired_entry.id
    returning target_id
  )
  select
    expired_entry.id,
    stale_entry.attempt_id,
    stale_entry.workflow_run_id,
    expiry_timestamp
  from expired_entries as expired_entry
  join stale_entries as stale_entry on stale_entry.entry_id = expired_entry.id
  where exists (
    select 1
    from recorded_events as recorded_event
    where recorded_event.target_id = expired_entry.id
  )
  order by expired_entry.id;
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
drop function public.list_entries_page(
  text,
  public.entry_source_type,
  text[],
  boolean,
  integer,
  integer,
  text
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
  thumbnail_origin public.thumbnail_origin,
  status public.entry_status,
  source_type public.entry_source_type,
  created_at timestamptz,
  created_by uuid,
  author_email text,
  author_display_name text,
  author_avatar_url text,
  processing_heartbeat_at timestamptz,
  error_code text,
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
      entry.thumbnail_origin,
      entry.status,
      entry.source_type,
      entry.created_at,
      entry.created_by,
      attribution.author_email,
      attribution.display_name as author_display_name,
      attribution.avatar_url as author_avatar_url,
      entry.processing_heartbeat_at,
      entry.error_code,
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
    counted_entry.thumbnail_origin,
    counted_entry.status,
    counted_entry.source_type,
    counted_entry.created_at,
    counted_entry.created_by,
    counted_entry.author_email,
    counted_entry.author_display_name,
    counted_entry.author_avatar_url,
    counted_entry.processing_heartbeat_at,
    counted_entry.error_code,
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
  thumbnail_origin public.thumbnail_origin,
  status public.entry_status,
  source_type public.entry_source_type,
  created_at timestamptz,
  created_by uuid,
  author_email text,
  author_display_name text,
  author_avatar_url text,
  processing_heartbeat_at timestamptz,
  error_code text,
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

revoke all on function private.normalize_entry_processing_fields() from public;

revoke all on function public.update_processing_heartbeat(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.update_processing_heartbeat(uuid, uuid)
  to service_role;

revoke all on function public.expire_stale_entry_processing(timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.expire_stale_entry_processing(timestamptz)
  to service_role;

revoke all on function public.finalize_entry_processing(
  uuid,
  uuid,
  text,
  text,
  text,
  uuid[]
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_entry_processing(
  uuid,
  uuid,
  text,
  text,
  text,
  uuid[]
) to service_role;

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

do $cron_setup$
begin
  begin
    create extension if not exists pg_cron;
  exception
    when others then
      raise notice 'pg_cron is unavailable (%); stale processing recovery remains callable on demand', sqlerrm;
  end;

  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    begin
      execute
        'select cron.schedule('
        || quote_literal('curio-expire-stale-entry-processing') || ', '
        || quote_literal('* * * * *') || ', '
        || quote_literal(
          'select * from public.expire_stale_entry_processing(statement_timestamp() - interval ''15 minutes'')'
        )
        || ')';
    exception
      when others then
        raise notice 'pg_cron scheduling is unavailable (%); stale processing recovery remains callable on demand', sqlerrm;
    end;
  end if;
end;
$cron_setup$;

commit;
