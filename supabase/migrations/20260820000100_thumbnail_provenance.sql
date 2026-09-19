begin;

-- PostgreSQL requires a newly added enum value to be committed before it can
-- be referenced by functions in the same migration.
alter type public.thumbnail_origin
  add value if not exists 'placeholder' after 'automatic';

commit;

begin;

comment on type public.thumbnail_origin is
  'Provenance of the current thumbnail: trusted automatic preview, Curio placeholder, or manual upload.';

comment on column public.entries.thumbnail_origin is
  'Whether the current private thumbnail is a trusted automatic preview, a Curio placeholder, or a manual upload.';

create function public.finalize_entry_processing(
  p_entry_id uuid,
  p_attempt_id uuid,
  p_title text,
  p_tldr text,
  p_thumbnail_path text,
  p_thumbnail_origin public.thumbnail_origin,
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
  p_tag_ids := coalesce(p_tag_ids, '{}'::uuid[]);

  if p_thumbnail_path is distinct from (
    p_entry_id::text || '/workflow-' || p_attempt_id::text || '.webp'
  ) then
    raise exception 'INVALID_THUMBNAIL_PATH' using errcode = '22023';
  end if;
  if p_thumbnail_origin is null
     or p_thumbnail_origin not in (
       'automatic'::public.thumbnail_origin,
       'placeholder'::public.thumbnail_origin
     ) then
    raise exception 'INVALID_THUMBNAIL_ORIGIN' using errcode = '22023';
  end if;

  perform private.assert_valid_tag_ids(p_tag_ids);

  if target_entry.thumbnail_origin = 'manual'::public.thumbnail_origin
     and target_entry.thumbnail_path is not null then
    selected_thumbnail_path := target_entry.thumbnail_path;
    selected_thumbnail_origin := 'manual'::public.thumbnail_origin;
    old_thumbnail_path := null;
    discarded_candidate_path := nullif(p_thumbnail_path, target_entry.thumbnail_path);
  else
    selected_thumbnail_path := p_thumbnail_path;
    selected_thumbnail_origin := p_thumbnail_origin;
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
        'candidate_thumbnail_origin', p_thumbnail_origin,
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
      'thumbnail_origin', selected_thumbnail_origin,
      'candidate_thumbnail_origin', p_thumbnail_origin
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

-- Keep the six-argument overload during rolling deployments. Older workers
-- cannot distinguish a downloaded preview from a placeholder, so their
-- candidate is conservatively recorded as automatic until every worker uses
-- the explicit provenance argument.
create or replace function public.finalize_entry_processing(
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
language sql
security definer
set search_path = ''
as $$
  select *
  from public.finalize_entry_processing(
    p_entry_id,
    p_attempt_id,
    p_title,
    p_tldr,
    p_thumbnail_path,
    'automatic'::public.thumbnail_origin,
    p_tag_ids
  );
$$;

revoke all on function public.finalize_entry_processing(
  uuid,
  uuid,
  text,
  text,
  text,
  public.thumbnail_origin,
  uuid[]
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_entry_processing(
  uuid,
  uuid,
  text,
  text,
  text,
  public.thumbnail_origin,
  uuid[]
) to service_role;

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

commit;
