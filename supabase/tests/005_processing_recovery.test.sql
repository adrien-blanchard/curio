begin;

select plan(62);

select has_column(
  'public',
  'entries',
  'processing_heartbeat_at',
  'entries expose a durable processing heartbeat'
);
select col_type_is(
  'public',
  'entries',
  'processing_heartbeat_at',
  'timestamp with time zone',
  'the processing heartbeat uses timestamptz'
);
select col_not_null(
  'public',
  'entries',
  'processing_heartbeat_at',
  'every entry has a processing heartbeat baseline'
);
select has_column(
  'public',
  'entries',
  'thumbnail_origin',
  'entries record thumbnail provenance'
);
select is(
  (
    select format_type(attribute.atttypid, attribute.atttypmod)
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.entries'::regclass
      and attribute.attname = 'thumbnail_origin'
  ),
  'thumbnail_origin',
  'thumbnail provenance uses a dedicated enum'
);
select is(
  (
    select array_agg(enum_value.enumlabel::text order by enum_value.enumsortorder)
    from pg_catalog.pg_enum as enum_value
    where enum_value.enumtypid = 'public.thumbnail_origin'::regtype
  ),
  array['automatic', 'placeholder', 'manual']::text[],
  'thumbnail provenance values are exact'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_definition
    where constraint_definition.conrelid = 'public.entries'::regclass
      and constraint_definition.conname = 'entries_thumbnail_origin_shape'
      and constraint_definition.contype = 'c'
  ),
  'thumbnail paths and origins have a paired shape constraint'
);
select has_index(
  'public',
  'processing_attempts',
  'processing_attempts_one_active_per_entry_idx',
  'active processing attempts are protected by an index'
);
select ok(
  (
    select
      index_definition.indisunique
      and pg_get_expr(index_definition.indpred, index_definition.indrelid)
        like '%queued%running%'
    from pg_catalog.pg_index as index_definition
    where index_definition.indexrelid =
      'public.processing_attempts_one_active_per_entry_idx'::regclass
  ),
  'the active attempt uniqueness fence covers queued and running attempts only'
);
select ok(
  to_regprocedure('public.update_processing_heartbeat(uuid,uuid)') is not null,
  'the worker heartbeat RPC exists'
);
select ok(
  to_regprocedure('public.expire_stale_entry_processing(timestamptz)') is not null,
  'the stale processing expiry RPC exists'
);
select matches(
  pg_get_function_result(
    'public.finalize_entry_processing(uuid,uuid,text,text,text,uuid[])'::regprocedure
  ),
  'thumbnail_path text.*thumbnail_origin thumbnail_origin.*previous_thumbnail_path text.*discarded_thumbnail_path text',
  'finalization returns retained and cleanup-safe thumbnail paths'
);
select matches(
  pg_get_function_result(
    'public.list_entries_page(text,public.entry_source_type,text[],boolean,integer,integer)'::regprocedure
  ),
  'processing_heartbeat_at timestamp with time zone.*error_code text.*error_message text',
  'the backward-compatible catalog page exposes recovery fields'
);
select ok(
  to_regprocedure(
    'public.list_entries_page(text,public.entry_source_type,text[],boolean,integer,integer,text)'
  ) is not null,
  'the author-aware catalog overload remains available'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.update_processing_heartbeat(uuid,uuid)',
    'execute'
  ),
  'authenticated callers cannot forge worker heartbeats'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.update_processing_heartbeat(uuid,uuid)',
    'execute'
  ),
  'anonymous callers cannot forge worker heartbeats'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.update_processing_heartbeat(uuid,uuid)',
    'execute'
  ),
  'service workers can report processing progress'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.expire_stale_entry_processing(timestamptz)',
    'execute'
  ),
  'authenticated callers cannot expire processing jobs'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.expire_stale_entry_processing(timestamptz)',
    'execute'
  ),
  'anonymous callers cannot expire processing jobs'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.expire_stale_entry_processing(timestamptz)',
    'execute'
  ),
  'service workers can expire stale processing jobs'
);
select matches(
  pg_get_functiondef(
    'public.expire_stale_entry_processing(timestamptz)'::regprocedure
  ),
  '(?i)for update of entry skip locked',
  'stale recovery uses non-blocking row claims'
);
select matches(
  pg_get_functiondef(
    'public.expire_stale_entry_processing(timestamptz)'::regprocedure
  ),
  '(?i)limit 20[[:space:]]+for update of entry skip locked',
  'each stale recovery sweep is bounded to twenty entries'
);

create function pg_temp.curio_cron_job_count()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  job_count integer;
begin
  if to_regclass('cron.job') is null then
    return null;
  end if;

  execute
    'select count(*)::integer from cron.job where jobname = $1'
    into job_count
    using 'curio-expire-stale-entry-processing';
  return job_count;
end;
$$;

select ok(
  pg_temp.curio_cron_job_count() is null
  or pg_temp.curio_cron_job_count() = 1,
  'the optional pg_cron recovery job is unique when pg_cron is available'
);

insert into public.audit_events (
  event_type,
  target_table,
  target_id,
  created_at
)
values
  (
    'entry.thumbnail_replaced',
    'entries',
    '54000000-0000-4000-8000-000000000001',
    '2026-01-01 00:00:00+00'
  ),
  (
    'entry.processing_succeeded',
    'entries',
    '54000000-0000-4000-8000-000000000001',
    '2026-02-01 00:00:00+00'
  ),
  (
    'entry.processing_succeeded',
    'entries',
    '54000000-0000-4000-8000-000000000002',
    '2026-01-01 00:00:00+00'
  ),
  (
    'entry.thumbnail_replaced',
    'entries',
    '54000000-0000-4000-8000-000000000002',
    '2026-02-01 00:00:00+00'
  );

select is(
  private.infer_thumbnail_origin(
    '54000000-0000-4000-8000-000000000003',
    null
  ),
  null::public.thumbnail_origin,
  'thumbnail origin inference returns null when there is no thumbnail'
);
select is(
  private.infer_thumbnail_origin(
    '54000000-0000-4000-8000-000000000003',
    '54000000-0000-4000-8000-000000000003/imported.webp'
  ),
  'automatic'::public.thumbnail_origin,
  'thumbnail origin inference treats an unaudited imported path as automatic'
);
select is(
  private.infer_thumbnail_origin(
    '54000000-0000-4000-8000-000000000001',
    '54000000-0000-4000-8000-000000000001/latest.webp'
  ),
  'automatic'::public.thumbnail_origin,
  'a processing success newer than a manual replacement infers automatic provenance'
);
select is(
  private.infer_thumbnail_origin(
    '54000000-0000-4000-8000-000000000002',
    '54000000-0000-4000-8000-000000000002/latest.webp'
  ),
  'manual'::public.thumbnail_origin,
  'a manual replacement newer than processing success infers manual provenance'
);

do $$
begin
  perform public.replace_allowed_email_domains(array['example.test']);
end;
$$;

insert into auth.users (id, email)
values ('51000000-0000-4000-8000-000000000001', 'recovery@example.test');

insert into public.profiles (id, email, role)
values (
  '51000000-0000-4000-8000-000000000001',
  'recovery@example.test',
  'contributor'
);

create function pg_temp.curio_workflow_thumbnail_path(p_workflow_run_id text)
returns text
language sql
stable
set search_path = ''
as $$
  select
    processing_attempt.entry_id::text
    || '/workflow-'
    || processing_attempt.id::text
    || '.webp'
  from public.processing_attempts as processing_attempt
  where processing_attempt.workflow_run_id = p_workflow_run_id;
$$;

insert into public.entries (
  id,
  url,
  canonical_url,
  title,
  tldr,
  status,
  thumbnail_path,
  created_by,
  published_at
)
values (
  '52000000-0000-4000-8000-000000000001',
  'https://example.test/manual-recovery',
  'https://example.test/manual-recovery',
  'Manual thumbnail',
  'A fixture used to verify manual thumbnail priority.',
  'ready',
  '52000000-0000-4000-8000-000000000001/old-automatic.webp',
  '51000000-0000-4000-8000-000000000001',
  now()
);

select is(
  (
    select entry.thumbnail_origin
    from public.entries as entry
    where entry.id = '52000000-0000-4000-8000-000000000001'
  ),
  'automatic'::public.thumbnail_origin,
  'a legacy-compatible thumbnail write defaults to automatic provenance'
);

set local role service_role;
select lives_ok(
  $$select * from public.replace_entry_thumbnail(
    '51000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000001/11111111-1111-4111-8111-111111111111.webp'
  )$$,
  'the guarded upload RPC attaches a manual thumbnail'
);
reset role;

select is(
  (
    select entry.thumbnail_origin
    from public.entries as entry
    where entry.id = '52000000-0000-4000-8000-000000000001'
  ),
  'manual'::public.thumbnail_origin,
  'a guarded upload marks the thumbnail as manual'
);

update public.entries as entry
set status = 'failed'::public.entry_status,
    error_code = 'TEST_RETRY',
    error_message = 'Synthetic retry state',
    published_at = null
where entry.id = '52000000-0000-4000-8000-000000000001';

select set_config(
  'request.jwt.claim.sub',
  '51000000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"51000000-0000-4000-8000-000000000001","email":"recovery@example.test"}',
  true
);
set local role authenticated;
select lives_ok(
  $$select * from public.retry_entry(
    '51000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000001'
  )$$,
  'retry accepts a failed entry with a manual thumbnail'
);
reset role;

select is(
  (
    select entry.thumbnail_path
    from public.entries as entry
    where entry.id = '52000000-0000-4000-8000-000000000001'
  ),
  '52000000-0000-4000-8000-000000000001/11111111-1111-4111-8111-111111111111.webp',
  'retry preserves the manual thumbnail path'
);
select is(
  (
    select entry.thumbnail_origin
    from public.entries as entry
    where entry.id = '52000000-0000-4000-8000-000000000001'
  ),
  'manual'::public.thumbnail_origin,
  'retry preserves manual thumbnail provenance'
);

set local role service_role;
do $$
declare
  processing_attempt_id uuid;
begin
  select started.id into processing_attempt_id
  from public.begin_processing_attempt(
    '52000000-0000-4000-8000-000000000001',
    'manual-thumbnail-run'
  ) as started;
  perform public.mark_entry_analyzing(
    '52000000-0000-4000-8000-000000000001',
    processing_attempt_id
  );
  perform public.mark_entry_finalizing(
    '52000000-0000-4000-8000-000000000001',
    processing_attempt_id
  );
end;
$$;

create temporary table manual_finalization as
select finalized.*
from public.finalize_entry_processing(
  '52000000-0000-4000-8000-000000000001',
  (
    select processing_attempt.id
    from public.processing_attempts as processing_attempt
    where processing_attempt.workflow_run_id = 'manual-thumbnail-run'
  ),
  'Manual thumbnail retained',
  'The automatic analysis must not replace a thumbnail uploaded by a member.',
  pg_temp.curio_workflow_thumbnail_path('manual-thumbnail-run'),
  '{}'::uuid[]
) as finalized;
reset role;

select is(
  (select thumbnail_path from manual_finalization),
  '52000000-0000-4000-8000-000000000001/11111111-1111-4111-8111-111111111111.webp',
  'finalization returns the retained manual thumbnail path'
);
select is(
  (select thumbnail_origin from manual_finalization),
  'manual'::public.thumbnail_origin,
  'finalization returns manual provenance for the retained thumbnail'
);
select is(
  (select previous_thumbnail_path from manual_finalization),
  null::text,
  'a retained manual thumbnail is never returned as a previous cleanup target'
);
select is(
  (select discarded_thumbnail_path from manual_finalization),
  pg_temp.curio_workflow_thumbnail_path('manual-thumbnail-run'),
  'the unused automatic candidate is returned as a discarded cleanup target'
);
select is(
  (
    select entry.thumbnail_path
    from public.entries as entry
    where entry.id = '52000000-0000-4000-8000-000000000001'
  ),
  '52000000-0000-4000-8000-000000000001/11111111-1111-4111-8111-111111111111.webp',
  'the durable entry still references the manual thumbnail'
);
select is(
  (
    select processing_attempt.metadata ->> 'discarded_thumbnail_path'
    from public.processing_attempts as processing_attempt
    where processing_attempt.workflow_run_id = 'manual-thumbnail-run'
  ),
  pg_temp.curio_workflow_thumbnail_path('manual-thumbnail-run'),
  'attempt metadata preserves the discarded path for acknowledgement recovery'
);

set local role service_role;
select is(
  (
    select replay.discarded_thumbnail_path
    from public.finalize_entry_processing(
      '52000000-0000-4000-8000-000000000001',
      (
        select processing_attempt.id
        from public.processing_attempts as processing_attempt
        where processing_attempt.workflow_run_id = 'manual-thumbnail-run'
      ),
      'Manual thumbnail retained',
      'The automatic analysis must not replace a thumbnail uploaded by a member.',
      pg_temp.curio_workflow_thumbnail_path('manual-thumbnail-run'),
      '{}'::uuid[]
    ) as replay
  ),
  pg_temp.curio_workflow_thumbnail_path('manual-thumbnail-run'),
  'finalization replay returns the same discarded cleanup path'
);
reset role;

insert into public.entries (
  id,
  url,
  canonical_url,
  status,
  error_code,
  error_message,
  thumbnail_path,
  thumbnail_origin,
  created_by
)
values (
  '52000000-0000-4000-8000-000000000002',
  'https://example.test/automatic-recovery',
  'https://example.test/automatic-recovery',
  'failed',
  'TEST_RETRY',
  'Synthetic retry state',
  '52000000-0000-4000-8000-000000000002/old-automatic.webp',
  'automatic',
  '51000000-0000-4000-8000-000000000001'
);

set local role authenticated;
select * from public.retry_entry(
  '51000000-0000-4000-8000-000000000001',
  '52000000-0000-4000-8000-000000000002'
);
reset role;
set local role service_role;
do $$
declare
  processing_attempt_id uuid;
begin
  select started.id into processing_attempt_id
  from public.begin_processing_attempt(
    '52000000-0000-4000-8000-000000000002',
    'automatic-thumbnail-run'
  ) as started;
  perform public.mark_entry_analyzing(
    '52000000-0000-4000-8000-000000000002',
    processing_attempt_id
  );
  perform public.mark_entry_finalizing(
    '52000000-0000-4000-8000-000000000002',
    processing_attempt_id
  );
end;
$$;

create temporary table automatic_finalization as
select finalized.*
from public.finalize_entry_processing(
  '52000000-0000-4000-8000-000000000002',
  (
    select processing_attempt.id
    from public.processing_attempts as processing_attempt
    where processing_attempt.workflow_run_id = 'automatic-thumbnail-run'
  ),
  'Automatic thumbnail replaced',
  'The new automatic thumbnail replaces the previous automatic thumbnail.',
  pg_temp.curio_workflow_thumbnail_path('automatic-thumbnail-run'),
  '{}'::uuid[]
) as finalized;
reset role;

select is(
  (select thumbnail_path from automatic_finalization),
  pg_temp.curio_workflow_thumbnail_path('automatic-thumbnail-run'),
  'automatic finalization returns the accepted candidate path'
);
select is(
  (select thumbnail_origin from automatic_finalization),
  'automatic'::public.thumbnail_origin,
  'automatic finalization records automatic provenance'
);
select is(
  (select previous_thumbnail_path from automatic_finalization),
  '52000000-0000-4000-8000-000000000002/old-automatic.webp',
  'automatic finalization returns the replaced path for cleanup'
);
select is(
  (select discarded_thumbnail_path from automatic_finalization),
  null::text,
  'an accepted automatic candidate is not returned as discarded'
);
select is(
  (
    select entry.thumbnail_path
    from public.entries as entry
    where entry.id = '52000000-0000-4000-8000-000000000002'
  ),
  pg_temp.curio_workflow_thumbnail_path('automatic-thumbnail-run'),
  'the durable entry references the accepted automatic thumbnail'
);

insert into public.entries (id, url, canonical_url, status, created_by)
values (
  '52000000-0000-4000-8000-000000000003',
  'https://example.test/heartbeat',
  'https://example.test/heartbeat',
  'queued',
  '51000000-0000-4000-8000-000000000001'
);
set local role service_role;
do $$
declare
  processing_attempt_id uuid;
begin
  select started.id into processing_attempt_id
  from public.begin_processing_attempt(
    '52000000-0000-4000-8000-000000000003',
    'heartbeat-run'
  ) as started;
  perform public.mark_entry_analyzing(
    '52000000-0000-4000-8000-000000000003',
    processing_attempt_id
  );
  update public.entries
  set processing_heartbeat_at = now() - interval '5 minutes'
  where id = '52000000-0000-4000-8000-000000000003';
end;
$$;
create temporary table processing_heartbeat_result as
select public.update_processing_heartbeat(
  '52000000-0000-4000-8000-000000000003',
  processing_attempt.id
) as heartbeat_at
from public.processing_attempts as processing_attempt
where processing_attempt.workflow_run_id = 'heartbeat-run';
select is(
  (select heartbeat_at from processing_heartbeat_result),
  (
    select entry.processing_heartbeat_at
    from public.entries as entry
    where entry.id = '52000000-0000-4000-8000-000000000003'
  ),
  'a worker heartbeat atomically returns the stored progress time'
);
select throws_ok(
  $$insert into public.processing_attempts (
    entry_id,
    workflow_run_id,
    attempt,
    status
  ) values (
    '52000000-0000-4000-8000-000000000003',
    'duplicate-active-run',
    2,
    'queued'
  )$$,
  '23505',
  null,
  'the database rejects a second active attempt for one entry'
);
reset role;

insert into public.entries (
  id,
  url,
  canonical_url,
  status,
  created_by,
  processing_heartbeat_at
)
values
  (
    '53000000-0000-4000-8000-000000000001',
    'https://example.test/exact-timeout',
    'https://example.test/exact-timeout',
    'queued',
    '51000000-0000-4000-8000-000000000001',
    now() - interval '15 minutes'
  ),
  (
    '53000000-0000-4000-8000-000000000002',
    'https://example.test/not-yet-timeout',
    'https://example.test/not-yet-timeout',
    'queued',
    '51000000-0000-4000-8000-000000000001',
    now() - interval '14 minutes 59 seconds'
  ),
  (
    '53000000-0000-4000-8000-000000000003',
    'https://example.test/analyzing-timeout',
    'https://example.test/analyzing-timeout',
    'queued',
    '51000000-0000-4000-8000-000000000001',
    now()
  ),
  (
    '53000000-0000-4000-8000-000000000004',
    'https://example.test/finalizing-timeout',
    'https://example.test/finalizing-timeout',
    'queued',
    '51000000-0000-4000-8000-000000000001',
    now()
  );

set local role service_role;
do $$
declare
  analyzing_attempt_id uuid;
  finalizing_attempt_id uuid;
begin
  select started.id into analyzing_attempt_id
  from public.begin_processing_attempt(
    '53000000-0000-4000-8000-000000000003',
    'analyzing-timeout-run'
  ) as started;
  perform public.mark_entry_analyzing(
    '53000000-0000-4000-8000-000000000003',
    analyzing_attempt_id
  );

  select started.id into finalizing_attempt_id
  from public.begin_processing_attempt(
    '53000000-0000-4000-8000-000000000004',
    'finalizing-timeout-run'
  ) as started;
  perform public.mark_entry_analyzing(
    '53000000-0000-4000-8000-000000000004',
    finalizing_attempt_id
  );
  perform public.mark_entry_finalizing(
    '53000000-0000-4000-8000-000000000004',
    finalizing_attempt_id
  );

  update public.entries
  set processing_heartbeat_at = now() - interval '20 minutes'
  where id in (
    '53000000-0000-4000-8000-000000000003',
    '53000000-0000-4000-8000-000000000004'
  );
end;
$$;

create temporary table expired_processing as
select expired.*
from public.expire_stale_entry_processing(now() - interval '15 minutes') as expired;
reset role;

select is(
  (select count(*) from expired_processing),
  3::bigint,
  'expiry claims queued-without-attempt, analyzing, and finalizing entries at the cutoff'
);
select is(
  (select count(distinct expired_at) from expired_processing),
  1::bigint,
  'one expiry call records a single atomic timeout timestamp'
);
select is(
  (
    select entry.status
    from public.entries as entry
    where entry.id = '53000000-0000-4000-8000-000000000001'
  ),
  'failed'::public.entry_status,
  'an entry at exactly fifteen minutes is expired'
);
select is(
  (
    select entry.status
    from public.entries as entry
    where entry.id = '53000000-0000-4000-8000-000000000002'
  ),
  'queued'::public.entry_status,
  'an entry at fourteen minutes fifty-nine seconds is not expired'
);
select is(
  (
    select processing_attempt.error_code
    from public.processing_attempts as processing_attempt
    where processing_attempt.workflow_run_id = 'analyzing-timeout-run'
  ),
  'PROCESSING_TIMEOUT',
  'expiry fences the active analyzing attempt with a stable error code'
);
select is(
  (
    select expired.workflow_run_id
    from expired_processing as expired
    where expired.entry_id = '53000000-0000-4000-8000-000000000004'
  ),
  'finalizing-timeout-run',
  'expiry returns the workflow run ID without a follow-up race'
);

set local role service_role;
select is(
  (
    select count(*)
    from public.expire_stale_entry_processing(now() - interval '15 minutes')
  ),
  0::bigint,
  'stale processing expiry is idempotent'
);
select throws_ok(
  $$select public.update_processing_heartbeat(
    '53000000-0000-4000-8000-000000000003',
    (
      select processing_attempt.id
      from public.processing_attempts as processing_attempt
      where processing_attempt.workflow_run_id = 'analyzing-timeout-run'
    )
  )$$,
  'P0001',
  'PROCESSING_TIMEOUT',
  'a late heartbeat cannot revive an expired attempt'
);
select throws_ok(
  $$select public.mark_entry_finalizing(
    '53000000-0000-4000-8000-000000000003',
    (
      select processing_attempt.id
      from public.processing_attempts as processing_attempt
      where processing_attempt.workflow_run_id = 'analyzing-timeout-run'
    )
  )$$,
  'P0001',
  'PROCESSING_TIMEOUT',
  'a late state transition cannot advance an expired attempt'
);
select throws_ok(
  $$select * from public.finalize_entry_processing(
    '53000000-0000-4000-8000-000000000004',
    (
      select processing_attempt.id
      from public.processing_attempts as processing_attempt
      where processing_attempt.workflow_run_id = 'finalizing-timeout-run'
    ),
    'Too late',
    'This stale workflow result must never be committed.',
    '53000000-0000-4000-8000-000000000004/late.webp',
    '{}'::uuid[]
  )$$,
  'P0001',
  'PROCESSING_TIMEOUT',
  'late finalization is fenced after timeout recovery'
);
reset role;

select is(
  (
    select count(*)
    from public.audit_events as audit_event
    where audit_event.event_type = 'entry.processing_timed_out'
      and audit_event.target_id in (
        '53000000-0000-4000-8000-000000000001',
        '53000000-0000-4000-8000-000000000003',
        '53000000-0000-4000-8000-000000000004'
      )
  ),
  3::bigint,
  'every expired entry emits one durable timeout audit event'
);

set local role authenticated;
select is(
  (
    select count(*)
    from public.list_entries_page(
      null,
      null,
      null,
      false,
      0,
      100,
      'recovery@example.test'
    ) as page
    where page.processing_heartbeat_at is not null
      and page.thumbnail_origin in ('automatic', 'manual')
  ),
  2::bigint,
  'author filtering remains intact while exposing heartbeat and thumbnail provenance'
);
select is(
  (
    select retried.status
    from public.retry_entry(
      '51000000-0000-4000-8000-000000000001',
      '53000000-0000-4000-8000-000000000001'
    ) as retried
  ),
  'queued'::public.entry_status,
  'an owner can retry a timed-out entry with the same ID'
);
reset role;

insert into public.entries (
  id,
  url,
  canonical_url,
  status,
  created_by,
  processing_heartbeat_at
)
select
  (
    '55000000-0000-4000-8000-'
    || lpad(batch_entry.sequence_number::text, 12, '0')
  )::uuid,
  'https://example.test/batch-timeout/' || batch_entry.sequence_number::text,
  'https://example.test/batch-timeout/' || batch_entry.sequence_number::text,
  'queued'::public.entry_status,
  '51000000-0000-4000-8000-000000000001'::uuid,
  now() - interval '30 minutes'
from generate_series(1, 21) as batch_entry(sequence_number);

set local role service_role;
create temporary table first_expiry_batch as
select expired.*
from public.expire_stale_entry_processing(now() - interval '15 minutes') as expired;
select is(
  (select count(*) from first_expiry_batch),
  20::bigint,
  'one recovery sweep expires at most twenty stale entries'
);
select is(
  (
    select count(*)
    from public.expire_stale_entry_processing(now() - interval '15 minutes')
  ),
  1::bigint,
  'a following sweep recovers the remaining stale entry'
);
reset role;

select * from finish();
rollback;
