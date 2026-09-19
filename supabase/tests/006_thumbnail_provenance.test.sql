begin;

select plan(41);

select is(
  (
    select array_agg(enum_value.enumlabel::text order by enum_value.enumsortorder)
    from pg_catalog.pg_enum as enum_value
    where enum_value.enumtypid = 'public.thumbnail_origin'::regtype
  ),
  array['automatic', 'placeholder', 'manual']::text[],
  'thumbnail provenance distinguishes trusted previews, placeholders and manual uploads'
);
select ok(
  to_regprocedure(
    'public.finalize_entry_processing(uuid,uuid,text,text,text,public.thumbnail_origin,uuid[])'
  ) is not null,
  'finalization accepts explicit automatic thumbnail provenance'
);
select ok(
  to_regprocedure(
    'public.finalize_entry_processing(uuid,uuid,text,text,text,uuid[])'
  ) is not null,
  'the legacy finalization overload remains available during rolling deployment'
);
select matches(
  pg_get_function_result(
    'public.finalize_entry_processing(uuid,uuid,text,text,text,public.thumbnail_origin,uuid[])'::regprocedure
  ),
  'thumbnail_path text.*thumbnail_origin thumbnail_origin.*previous_thumbnail_path text.*discarded_thumbnail_path text',
  'explicit-provenance finalization retains the cleanup-safe return contract'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.finalize_entry_processing(uuid,uuid,text,text,text,public.thumbnail_origin,uuid[])',
    'execute'
  ),
  'service workers can finalize with explicit provenance'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.finalize_entry_processing(uuid,uuid,text,text,text,public.thumbnail_origin,uuid[])',
    'execute'
  ),
  'authenticated callers cannot forge explicit thumbnail provenance'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.finalize_entry_processing(uuid,uuid,text,text,text,public.thumbnail_origin,uuid[])',
    'execute'
  ),
  'anonymous callers cannot forge explicit thumbnail provenance'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.finalize_entry_processing(uuid,uuid,text,text,text,uuid[])',
    'execute'
  ),
  'service workers retain the legacy finalization overload during rollout'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.finalize_entry_processing(uuid,uuid,text,text,text,uuid[])',
    'execute'
  ),
  'authenticated callers cannot execute the legacy finalization overload'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.finalize_entry_processing(uuid,uuid,text,text,text,uuid[])',
    'execute'
  ),
  'anonymous callers cannot execute the legacy finalization overload'
);
select matches(
  pg_get_function_result(
    'public.list_entries_page(text,public.entry_source_type,text[],boolean,integer,integer)'::regprocedure
  ),
  'thumbnail_origin thumbnail_origin',
  'catalog pagination exposes the extended thumbnail provenance enum'
);

do $$
begin
  perform public.replace_allowed_email_domains(array['example.test']);
end;
$$;

insert into auth.users (id, email)
values ('61000000-0000-4000-8000-000000000001', 'provenance@example.test');

insert into public.profiles (id, email, role)
values (
  '61000000-0000-4000-8000-000000000001',
  'provenance@example.test',
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
  status,
  thumbnail_path,
  thumbnail_origin,
  created_by
)
values (
  '62000000-0000-4000-8000-000000000001',
  'https://example.test/placeholder',
  'https://example.test/placeholder',
  'queued',
  '62000000-0000-4000-8000-000000000001/old-automatic.webp',
  'automatic',
  '61000000-0000-4000-8000-000000000001'
);

set local role service_role;
do $$
declare
  processing_attempt_id uuid;
begin
  select started.id into processing_attempt_id
  from public.begin_processing_attempt(
    '62000000-0000-4000-8000-000000000001',
    'placeholder-provenance-run'
  ) as started;
  perform public.mark_entry_analyzing(
    '62000000-0000-4000-8000-000000000001',
    processing_attempt_id
  );
  perform public.mark_entry_finalizing(
    '62000000-0000-4000-8000-000000000001',
    processing_attempt_id
  );
end;
$$;

create temporary table placeholder_finalization as
select finalized.*
from public.finalize_entry_processing(
  '62000000-0000-4000-8000-000000000001',
  (
    select processing_attempt.id
    from public.processing_attempts as processing_attempt
    where processing_attempt.workflow_run_id = 'placeholder-provenance-run'
  ),
  'Placeholder retained',
  'This resource uses the deterministic Curio fallback thumbnail.',
  pg_temp.curio_workflow_thumbnail_path('placeholder-provenance-run'),
  'placeholder'::public.thumbnail_origin,
  '{}'::uuid[]
) as finalized;
reset role;

select is(
  (select status from placeholder_finalization),
  'ready'::public.entry_status,
  'placeholder finalization makes the entry ready'
);
select is(
  (select thumbnail_origin from placeholder_finalization),
  'placeholder'::public.thumbnail_origin,
  'placeholder finalization returns placeholder provenance'
);
select is(
  (select thumbnail_path from placeholder_finalization),
  pg_temp.curio_workflow_thumbnail_path('placeholder-provenance-run'),
  'placeholder finalization returns the retained fallback path'
);
select is(
  (select previous_thumbnail_path from placeholder_finalization),
  '62000000-0000-4000-8000-000000000001/old-automatic.webp',
  'placeholder finalization returns the replaced automatic path for cleanup'
);
select is(
  (select discarded_thumbnail_path from placeholder_finalization),
  null::text,
  'an accepted placeholder candidate is not discarded'
);
select is(
  (
    select entry.thumbnail_origin
    from public.entries as entry
    where entry.id = '62000000-0000-4000-8000-000000000001'
  ),
  'placeholder'::public.thumbnail_origin,
  'the durable entry records placeholder provenance'
);
select is(
  (
    select processing_attempt.metadata ->> 'thumbnail_origin'
    from public.processing_attempts as processing_attempt
    where processing_attempt.workflow_run_id = 'placeholder-provenance-run'
  ),
  'placeholder',
  'attempt metadata records the selected placeholder provenance'
);
select is(
  (
    select processing_attempt.metadata ->> 'candidate_thumbnail_origin'
    from public.processing_attempts as processing_attempt
    where processing_attempt.workflow_run_id = 'placeholder-provenance-run'
  ),
  'placeholder',
  'attempt metadata records the candidate placeholder provenance'
);
select is(
  (
    select audit_event.payload ->> 'thumbnail_origin'
    from public.audit_events as audit_event
    where audit_event.event_type = 'entry.processing_succeeded'
      and audit_event.target_id = '62000000-0000-4000-8000-000000000001'
    order by audit_event.created_at desc, audit_event.id desc
    limit 1
  ),
  'placeholder',
  'the success audit records selected placeholder provenance'
);
select is(
  (
    select audit_event.payload ->> 'candidate_thumbnail_origin'
    from public.audit_events as audit_event
    where audit_event.event_type = 'entry.processing_succeeded'
      and audit_event.target_id = '62000000-0000-4000-8000-000000000001'
    order by audit_event.created_at desc, audit_event.id desc
    limit 1
  ),
  'placeholder',
  'the success audit records candidate placeholder provenance'
);

set local role service_role;
select is(
  (
    select replay.thumbnail_origin
    from public.finalize_entry_processing(
      '62000000-0000-4000-8000-000000000001',
      (
        select processing_attempt.id
        from public.processing_attempts as processing_attempt
        where processing_attempt.workflow_run_id = 'placeholder-provenance-run'
      ),
      'Placeholder retained',
      'This resource uses the deterministic Curio fallback thumbnail.',
      pg_temp.curio_workflow_thumbnail_path('placeholder-provenance-run'),
      'automatic'::public.thumbnail_origin,
      '{}'::uuid[]
    ) as replay
  ),
  'placeholder'::public.thumbnail_origin,
  'an acknowledgement replay returns the committed placeholder provenance'
);
reset role;

select set_config(
  'request.jwt.claim.sub',
  '61000000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"61000000-0000-4000-8000-000000000001","email":"provenance@example.test"}',
  true
);
set local role authenticated;
select is(
  (
    select count(*)
    from public.list_entries_page(null, null, null, false, 0, 100) as page
    where page.thumbnail_origin = 'placeholder'::public.thumbnail_origin
  ),
  1::bigint,
  'authenticated catalog pagination exposes placeholder provenance'
);
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
      'provenance@example.test'
    ) as page
    where page.thumbnail_origin = 'placeholder'::public.thumbnail_origin
  ),
  1::bigint,
  'author-aware pagination preserves placeholder provenance'
);
reset role;

insert into public.entries (id, url, canonical_url, status, created_by)
values (
  '62000000-0000-4000-8000-000000000002',
  'https://github.com/example/preview',
  'https://github.com/example/preview',
  'queued',
  '61000000-0000-4000-8000-000000000001'
);

set local role service_role;
do $$
declare
  processing_attempt_id uuid;
begin
  select started.id into processing_attempt_id
  from public.begin_processing_attempt(
    '62000000-0000-4000-8000-000000000002',
    'automatic-provenance-run'
  ) as started;
  perform public.mark_entry_analyzing(
    '62000000-0000-4000-8000-000000000002',
    processing_attempt_id
  );
  perform public.mark_entry_finalizing(
    '62000000-0000-4000-8000-000000000002',
    processing_attempt_id
  );
end;
$$;

create temporary table automatic_provenance_finalization as
select finalized.*
from public.finalize_entry_processing(
  '62000000-0000-4000-8000-000000000002',
  (
    select processing_attempt.id
    from public.processing_attempts as processing_attempt
    where processing_attempt.workflow_run_id = 'automatic-provenance-run'
  ),
  'Trusted preview retained',
  'This resource uses an allowlisted source preview.',
  pg_temp.curio_workflow_thumbnail_path('automatic-provenance-run'),
  'automatic'::public.thumbnail_origin,
  '{}'::uuid[]
) as finalized;
reset role;

select is(
  (select thumbnail_origin from automatic_provenance_finalization),
  'automatic'::public.thumbnail_origin,
  'trusted preview finalization returns automatic provenance'
);
select is(
  (
    select entry.thumbnail_origin
    from public.entries as entry
    where entry.id = '62000000-0000-4000-8000-000000000002'
  ),
  'automatic'::public.thumbnail_origin,
  'the durable trusted preview remains automatic'
);

insert into public.entries (
  id,
  url,
  canonical_url,
  status,
  thumbnail_path,
  thumbnail_origin,
  created_by
)
values (
  '62000000-0000-4000-8000-000000000003',
  'https://example.test/manual-priority',
  'https://example.test/manual-priority',
  'queued',
  '62000000-0000-4000-8000-000000000003/manual.webp',
  'manual',
  '61000000-0000-4000-8000-000000000001'
);

set local role service_role;
do $$
declare
  processing_attempt_id uuid;
begin
  select started.id into processing_attempt_id
  from public.begin_processing_attempt(
    '62000000-0000-4000-8000-000000000003',
    'manual-priority-provenance-run'
  ) as started;
  perform public.mark_entry_analyzing(
    '62000000-0000-4000-8000-000000000003',
    processing_attempt_id
  );
  perform public.mark_entry_finalizing(
    '62000000-0000-4000-8000-000000000003',
    processing_attempt_id
  );
end;
$$;

create temporary table manual_priority_finalization as
select finalized.*
from public.finalize_entry_processing(
  '62000000-0000-4000-8000-000000000003',
  (
    select processing_attempt.id
    from public.processing_attempts as processing_attempt
    where processing_attempt.workflow_run_id = 'manual-priority-provenance-run'
  ),
  'Manual preview retained',
  'The member-provided thumbnail must retain priority over the fallback.',
  pg_temp.curio_workflow_thumbnail_path('manual-priority-provenance-run'),
  'placeholder'::public.thumbnail_origin,
  '{}'::uuid[]
) as finalized;
reset role;

select is(
  (select thumbnail_origin from manual_priority_finalization),
  'manual'::public.thumbnail_origin,
  'manual provenance wins over an incoming placeholder'
);
select is(
  (select discarded_thumbnail_path from manual_priority_finalization),
  pg_temp.curio_workflow_thumbnail_path('manual-priority-provenance-run'),
  'the unused placeholder is returned for cleanup'
);
select is(
  (
    select entry.thumbnail_path
    from public.entries as entry
    where entry.id = '62000000-0000-4000-8000-000000000003'
  ),
  '62000000-0000-4000-8000-000000000003/manual.webp',
  'manual priority preserves the member-provided path'
);
select is(
  (
    select entry.thumbnail_origin
    from public.entries as entry
    where entry.id = '62000000-0000-4000-8000-000000000003'
  ),
  'manual'::public.thumbnail_origin,
  'manual priority preserves the durable origin'
);
select is(
  (
    select processing_attempt.metadata ->> 'candidate_thumbnail_origin'
    from public.processing_attempts as processing_attempt
    where processing_attempt.workflow_run_id = 'manual-priority-provenance-run'
  ),
  'placeholder',
  'attempt metadata records the discarded candidate provenance'
);

insert into public.entries (id, url, canonical_url, status, created_by)
values (
  '62000000-0000-4000-8000-000000000004',
  'https://example.test/invalid-origin',
  'https://example.test/invalid-origin',
  'queued',
  '61000000-0000-4000-8000-000000000001'
);

set local role service_role;
do $$
declare
  processing_attempt_id uuid;
begin
  select started.id into processing_attempt_id
  from public.begin_processing_attempt(
    '62000000-0000-4000-8000-000000000004',
    'invalid-provenance-run'
  ) as started;
  perform public.mark_entry_analyzing(
    '62000000-0000-4000-8000-000000000004',
    processing_attempt_id
  );
  perform public.mark_entry_finalizing(
    '62000000-0000-4000-8000-000000000004',
    processing_attempt_id
  );
end;
$$;

select throws_ok(
  $$select * from public.finalize_entry_processing(
    '62000000-0000-4000-8000-000000000004',
    (select id from public.processing_attempts where workflow_run_id = 'invalid-provenance-run'),
    'Cross-entry candidate',
    'A workflow candidate must remain scoped to its own entry.',
    '62000000-0000-4000-8000-000000000099/workflow-'
      || (select id::text from public.processing_attempts where workflow_run_id = 'invalid-provenance-run')
      || '.webp',
    'placeholder'::public.thumbnail_origin,
    '{}'::uuid[]
  )$$,
  '22023',
  'INVALID_THUMBNAIL_PATH',
  'finalization rejects a candidate path scoped to another entry'
);
select throws_ok(
  $$select * from public.finalize_entry_processing(
    '62000000-0000-4000-8000-000000000004',
    (select id from public.processing_attempts where workflow_run_id = 'invalid-provenance-run'),
    'Wrong-attempt candidate',
    'A workflow candidate must remain scoped to its own processing attempt.',
    '62000000-0000-4000-8000-000000000004/workflow-11111111-1111-4111-8111-111111111111.webp',
    'placeholder'::public.thumbnail_origin,
    '{}'::uuid[]
  )$$,
  '22023',
  'INVALID_THUMBNAIL_PATH',
  'finalization rejects a candidate path from another attempt'
);
select throws_ok(
  $$select * from public.finalize_entry_processing(
    '62000000-0000-4000-8000-000000000004',
    (select id from public.processing_attempts where workflow_run_id = 'invalid-provenance-run'),
    'Wrong-name candidate',
    'A workflow candidate must use the exact deterministic object name.',
    '62000000-0000-4000-8000-000000000004/preview-'
      || (select id::text from public.processing_attempts where workflow_run_id = 'invalid-provenance-run')
      || '.webp',
    'placeholder'::public.thumbnail_origin,
    '{}'::uuid[]
  )$$,
  '22023',
  'INVALID_THUMBNAIL_PATH',
  'finalization rejects a malformed workflow candidate name'
);

select throws_ok(
  $$select * from public.finalize_entry_processing(
    '62000000-0000-4000-8000-000000000004',
    (select id from public.processing_attempts where workflow_run_id = 'invalid-provenance-run'),
    'Invalid manual candidate',
    'A workflow may not claim that its candidate was uploaded manually.',
    pg_temp.curio_workflow_thumbnail_path('invalid-provenance-run'),
    'manual'::public.thumbnail_origin,
    '{}'::uuid[]
  )$$,
  '22023',
  'INVALID_THUMBNAIL_ORIGIN',
  'workflow finalization rejects a forged manual candidate origin'
);
select throws_ok(
  $$select * from public.finalize_entry_processing(
    '62000000-0000-4000-8000-000000000004',
    (select id from public.processing_attempts where workflow_run_id = 'invalid-provenance-run'),
    'Missing candidate origin',
    'A workflow must explicitly identify its candidate provenance.',
    pg_temp.curio_workflow_thumbnail_path('invalid-provenance-run'),
    null::public.thumbnail_origin,
    '{}'::uuid[]
  )$$,
  '22023',
  'INVALID_THUMBNAIL_ORIGIN',
  'workflow finalization rejects a missing candidate origin'
);
select throws_ok(
  $$select * from public.finalize_entry_processing(
    '62000000-0000-4000-8000-000000000004',
    (select id from public.processing_attempts where workflow_run_id = 'invalid-provenance-run'),
    'Missing candidate path',
    'A stored automatic thumbnail always requires a private object path.',
    '   ',
    'placeholder'::public.thumbnail_origin,
    '{}'::uuid[]
  )$$,
  '22023',
  'INVALID_THUMBNAIL_PATH',
  'workflow finalization rejects a blank candidate path'
);
reset role;

insert into public.entries (id, url, canonical_url, status, created_by)
values (
  '62000000-0000-4000-8000-000000000005',
  'https://example.test/legacy-finalization',
  'https://example.test/legacy-finalization',
  'queued',
  '61000000-0000-4000-8000-000000000001'
);

set local role service_role;
do $$
declare
  processing_attempt_id uuid;
begin
  select started.id into processing_attempt_id
  from public.begin_processing_attempt(
    '62000000-0000-4000-8000-000000000005',
    'legacy-provenance-run'
  ) as started;
  perform public.mark_entry_analyzing(
    '62000000-0000-4000-8000-000000000005',
    processing_attempt_id
  );
  perform public.mark_entry_finalizing(
    '62000000-0000-4000-8000-000000000005',
    processing_attempt_id
  );
end;
$$;

create temporary table legacy_provenance_finalization as
select finalized.*
from public.finalize_entry_processing(
  '62000000-0000-4000-8000-000000000005',
  (
    select processing_attempt.id
    from public.processing_attempts as processing_attempt
    where processing_attempt.workflow_run_id = 'legacy-provenance-run'
  ),
  'Legacy worker compatibility',
  'A rolling-deployment worker remains functional until it is upgraded.',
  pg_temp.curio_workflow_thumbnail_path('legacy-provenance-run'),
  '{}'::uuid[]
) as finalized;
reset role;

select is(
  (select thumbnail_origin from legacy_provenance_finalization),
  'automatic'::public.thumbnail_origin,
  'the legacy overload records its ambiguous candidate as automatic'
);
select is(
  (
    select processing_attempt.metadata ->> 'candidate_thumbnail_origin'
    from public.processing_attempts as processing_attempt
    where processing_attempt.workflow_run_id = 'legacy-provenance-run'
  ),
  'automatic',
  'legacy finalization records its compatibility provenance in metadata'
);

set local role service_role;
do $$
begin
  perform public.replace_entry_thumbnail(
    '61000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000001/11111111-1111-4111-8111-111111111111.webp'
  );
end;
$$;
reset role;

select is(
  (
    select entry.thumbnail_origin
    from public.entries as entry
    where entry.id = '62000000-0000-4000-8000-000000000001'
  ),
  'manual'::public.thumbnail_origin,
  'manual replacement upgrades a placeholder to manual provenance'
);
select is(
  (
    select audit_event.payload ->> 'previous_thumbnail_path'
    from public.audit_events as audit_event
    where audit_event.event_type = 'entry.thumbnail_replaced'
      and audit_event.target_id = '62000000-0000-4000-8000-000000000001'
    order by audit_event.created_at desc, audit_event.id desc
    limit 1
  ),
  pg_temp.curio_workflow_thumbnail_path('placeholder-provenance-run'),
  'manual replacement returns the prior placeholder path for cleanup'
);

select * from finish();
rollback;
