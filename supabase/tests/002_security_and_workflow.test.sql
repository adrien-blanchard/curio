begin;

select plan(65);

select is(
  (select array_agg(configured.domain order by configured.domain)
   from public.replace_allowed_email_domains(
     array['MEMBERS.TEST', 'EXAMPLE.TEST']
   ) as configured),
  array['example.test', 'members.test']::text[],
  'deployment domains are normalized and replaced atomically'
);
update public.allowed_email_domains
set created_at = '2000-01-01 00:00:00+00'::timestamptz
where domain = 'example.test';
do $$
begin
  perform public.replace_allowed_email_domains(
    array['example.test', 'members.test']
  );
end;
$$;

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

select is(
  (select created_at from public.allowed_email_domains where domain = 'example.test'),
  '2000-01-01 00:00:00+00'::timestamptz,
  'an unchanged domain set is a write-free idempotent no-op'
);
select throws_ok(
  $$select * from public.replace_allowed_email_domains(array['bad..test'])$$,
  '22023',
  'INVALID_ALLOWED_EMAIL_DOMAINS',
  'domain replacement rejects malformed DNS labels without changing configuration'
);

insert into auth.users (id, email)
values
  ('10000000-0000-4000-8000-000000000001', 'reader@example.test'),
  ('10000000-0000-4000-8000-000000000002', 'contributor@members.test'),
  ('10000000-0000-4000-8000-000000000003', 'second@members.test'),
  ('10000000-0000-4000-8000-000000000004', 'admin-one@example.test'),
  ('10000000-0000-4000-8000-000000000005', 'admin-two@example.test'),
  ('10000000-0000-4000-8000-000000000006', 'blocked@blocked.test');

insert into public.profiles (id, email, role)
values
  ('10000000-0000-4000-8000-000000000001', 'reader@example.test', 'reader'),
  ('10000000-0000-4000-8000-000000000002', 'contributor@members.test', 'contributor'),
  ('10000000-0000-4000-8000-000000000003', 'second@members.test', 'contributor'),
  ('10000000-0000-4000-8000-000000000004', 'admin-one@example.test', 'administrator'),
  ('10000000-0000-4000-8000-000000000005', 'admin-two@example.test', 'administrator');

select throws_ok(
  $$select * from public.replace_allowed_email_domains(array['members.test'])$$,
  '23514',
  'LAST_ADMIN_REQUIRED',
  'domain replacement cannot exclude every active administrator'
);
select throws_ok(
  $$update auth.users
    set email = 'admin-one@blocked.test'
    where id = '10000000-0000-4000-8000-000000000004'$$,
  '42501',
  'EMAIL_DOMAIN_NOT_ALLOWED',
  'auth email synchronization cannot move an existing administrator outside the allowlist'
);

insert into public.entries (
  id,
  url,
  canonical_url,
  title,
  tldr,
  source_type,
  status,
  error_code,
  error_message,
  thumbnail_path,
  created_by,
  published_at
)
values
  (
    '20000000-0000-4000-8000-000000000001',
    'https://example.test/ready',
    'https://example.test/ready',
    'Ready entry',
    'A ready entry for row-level tests.',
    'proprietary',
    'ready',
    null,
    null,
    '20000000-0000-4000-8000-000000000001/original.webp',
    '10000000-0000-4000-8000-000000000002',
    now()
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'https://example.test/failed',
    'https://example.test/failed',
    null,
    null,
    'opensource',
    'failed',
    'TEST_FAILURE',
    'Synthetic failure',
    null,
    '10000000-0000-4000-8000-000000000002',
    null
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    'https://example.test/other-failed',
    'https://example.test/other-failed',
    null,
    null,
    'opensource',
    'failed',
    'TEST_FAILURE',
    'Synthetic failure',
    null,
    '10000000-0000-4000-8000-000000000003',
    null
  ),
  (
    '20000000-0000-4000-8000-000000000004',
    'https://example.test/delete',
    'https://example.test/delete',
    'Delete me',
    'This entry exercises atomic database deletion.',
    'opensource',
    'ready',
    null,
    null,
    '20000000-0000-4000-8000-000000000004/original.webp',
    '10000000-0000-4000-8000-000000000002',
    now()
  );

insert into public.entry_tags (entry_id, tag_id)
values
  (
    '20000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001'
  ),
  (
    '20000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002'
  ),
  (
    '20000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000001'
  );

select throws_ok(
  $$select * from public.bootstrap_profile(
    '10000000-0000-4000-8000-000000000006',
    'blocked@blocked.test',
    'contributor',
    false
  )$$,
  '42501',
  'EMAIL_DOMAIN_NOT_ALLOWED',
  'profile bootstrap rejects a domain absent from deployment configuration'
);

insert into public.api_tokens (
  user_id,
  name,
  token_prefix,
  token_hash,
  scopes,
  revoked_at
)
values
  (
    '10000000-0000-4000-8000-000000000002',
    'valid contributor token',
    'curio_pat_abcdefgh',
    encode(extensions.digest(repeat('a', 64), 'sha256'), 'hex'),
    array['entries:write', 'tags:read', 'profile:read'],
    null
  ),
  (
    '10000000-0000-4000-8000-000000000001',
    'reader over-scoped fixture',
    'curio_pat_ijklmnop',
    encode(extensions.digest(repeat('b', 64), 'sha256'), 'hex'),
    array['entries:write'],
    null
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'revoked fixture',
    'curio_pat_qrstuvwx',
    encode(extensions.digest(repeat('c', 64), 'sha256'), 'hex'),
    array['profile:read'],
    now()
  );

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000001',
    'email', 'READER@EXAMPLE.TEST'
  )::text,
  true
);
set local role authenticated;
select is(public.current_app_role(), 'reader'::public.app_role, 'reader role resolves from active profile');
select is((select count(*) from public.profiles), 1::bigint, 'reader sees only its profile');
select is((select count(*) from public.entries), 4::bigint, 'reader can browse visible entries');
select is(
  (select count(*) from public.api_tokens),
  1::bigint,
  'a reader can inventory only its own API token metadata'
);
select is(
  (select count(*) from public.list_entries_page(null, null, null, false, 0, 2)),
  2::bigint,
  'catalog pagination applies the requested database page size'
);
select is(
  (select max(page.total_count)
   from public.list_entries_page(null, null, null, false, 0, 2) as page),
  4::bigint,
  'catalog pagination reports the full filtered count'
);
select is(
  (select count(*)
   from public.list_entries_page('Ready', null, null, false, 0, 100)),
  1::bigint,
  'catalog search uses the indexed simple text document'
);
select is(
  (select count(*)
   from public.list_entries_page(
     null,
     null,
     array['computer-vision', 'research'],
     false,
     0,
     100
   )),
  1::bigint,
  'catalog tag filtering requires every requested slug'
);
select is(
  (select count(*)
   from public.list_entries_page(null, 'proprietary', null, false, 0, 100)),
  1::bigint,
  'catalog source filtering is applied by the database'
);
select throws_ok(
  $$select * from public.list_entries_page(null, null, null, false, -1, 100)$$,
  '22023',
  'INVALID_PAGINATION',
  'catalog pagination rejects an invalid offset'
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000001',
    'email', 'reader@blocked.test'
  )::text,
  true
);
select is(
  public.current_app_role(),
  null::public.app_role,
  'a JWT email outside deployment domains cannot resolve an application role'
);
reset role;

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000004',
  true
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000004',
    'email', 'admin-one@example.test'
  )::text,
  true
);
set local role authenticated;
select is((select count(*) from public.profiles), 5::bigint, 'administrator sees all profiles');
select is(
  (select count(*) from public.api_tokens),
  3::bigint,
  'an administrator can inventory all non-secret API token metadata'
);
reset role;

set local role anon;
select is(
  (select count(*) from public.authenticate_api_token(
    repeat('a', 64),
    array['entries:write']::text[]
  )),
  1::bigint,
  'valid PAT digest resolves one active identity'
);
select is(
  (select count(*) from public.authenticate_api_token(
    repeat('b', 64),
    array['entries:write']::text[]
  )),
  0::bigint,
  'current reader role removes an over-scoped token capability'
);
select is(
  (select count(*) from public.authenticate_api_token(
    repeat('c', 64),
    array['profile:read']::text[]
  )),
  0::bigint,
  'revoked PAT cannot authenticate'
);
select ok(
  (select count(*) from public.get_tags_with_token(repeat('a', 64))) > 0,
  'PAT tag RPC returns the seeded taxonomy'
);
reset role;

do $$
begin
  perform public.replace_allowed_email_domains(array['example.test']);
end;
$$;
set local role anon;
select is(
  (select count(*) from public.authenticate_api_token(
    repeat('a', 64),
    array['entries:write']::text[]
  )),
  0::bigint,
  'PAT authentication is revoked when its profile domain is removed'
);
reset role;
do $$
begin
  perform public.replace_allowed_email_domains(array['example.test', 'members.test']);
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000002',
    'email', 'contributor@members.test'
  )::text,
  true
);
set local role authenticated;
select throws_ok(
  $$select * from public.submit_entry(
    '10000000-0000-4000-8000-000000000003',
    'https://example.test/forged-actor',
    'https://example.test/forged-actor',
    'opensource',
    '{}'::uuid[]
  )$$,
  '42501',
  'ENTRY_FORBIDDEN',
  'session submission rejects a forged actor UUID'
);
select throws_ok(
  $$select * from public.create_api_token(
    '10000000-0000-4000-8000-000000000003',
    'Forged actor token',
    'curio_pat_zyxwvuts',
    repeat('d', 64),
    array['profile:read']::text[],
    null
  )$$,
  '42501',
  'ENTRY_FORBIDDEN',
  'token creation rejects a forged actor UUID'
);
select throws_ok(
  $$select * from public.revoke_api_token(
    '10000000-0000-4000-8000-000000000003',
    (select id from public.api_tokens where token_prefix = 'curio_pat_abcdefgh')
  )$$,
  '42501',
  'ENTRY_FORBIDDEN',
  'token revocation rejects a forged actor UUID'
);
select throws_ok(
  $$select * from public.retry_entry(
    '10000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000003'
  )$$,
  '42501',
  'ENTRY_FORBIDDEN',
  'session retry rejects a forged actor UUID'
);
select throws_ok(
  $$select * from public.update_entry(
    '10000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000003',
    'Forged update',
    'A forged update must not cross the session boundary.',
    null,
    null
  )$$,
  '42501',
  'ENTRY_FORBIDDEN',
  'session update rejects a forged actor UUID'
);
select throws_ok(
  $$select public.delete_entry(
    '10000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000003'
  )$$,
  '42501',
  'ENTRY_FORBIDDEN',
  'session deletion rejects a forged actor UUID'
);
select lives_ok(
  $$select * from public.submit_entry(
    '10000000-0000-4000-8000-000000000002',
    'https://example.test/new',
    'https://example.test/new',
    'opensource',
    array['00000000-0000-4000-8000-000000000001']::uuid[]
  )$$,
  'contributor can submit an entry atomically'
);
select is(
  (select status from public.entries where canonical_url = 'https://example.test/new'),
  'queued'::public.entry_status,
  'submitted entry starts queued'
);
select is(
  (select created from public.submit_entry(
    '10000000-0000-4000-8000-000000000002',
    'https://example.test/duplicate',
    'https://example.test/new',
    'opensource',
    '{}'::uuid[]
  )),
  false,
  'duplicate canonical URL is idempotent and reports created false'
);
select is(
  (select dispatch_required from public.submit_entry(
    '10000000-0000-4000-8000-000000000002',
    'https://example.test/duplicate',
    'https://example.test/new',
    'opensource',
    '{}'::uuid[]
  )),
  false,
  'the dispatch lease prevents concurrent duplicate workflow starts'
);
reset role;
update public.entries
set dispatch_lease_until = statement_timestamp() - interval '1 second'
where canonical_url = 'https://example.test/new';
set local role authenticated;
select is(
  (select dispatch_required from public.submit_entry(
    '10000000-0000-4000-8000-000000000002',
    'https://example.test/duplicate',
    'https://example.test/new',
    'opensource',
    '{}'::uuid[]
  )),
  true,
  'an expired lease lets a queued entry recover after a request crash'
);
select throws_ok(
  $$select * from public.submit_entry(
    '10000000-0000-4000-8000-000000000002',
    'https://example.test/invalid-tag',
    'https://example.test/invalid-tag',
    'opensource',
    array['ffffffff-ffff-4fff-8fff-ffffffffffff']::uuid[]
  )$$,
  '23503',
  'INVALID_TAGS',
  'unknown tag has a stable error'
);
select is(
  (select dispatch_required from public.retry_entry(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002'
  )),
  true,
  'owner retry acquires the first workflow dispatch lease'
);
select is(
  (select status from public.entries where id = '20000000-0000-4000-8000-000000000002'),
  'queued'::public.entry_status,
  'retry preserves the entry ID and queues it'
);
select is(
  (select dispatch_required from public.retry_entry(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002'
  )),
  false,
  'an immediate retry replay does not start a duplicate workflow'
);
reset role;
update public.entries
set dispatch_lease_until = statement_timestamp() - interval '1 second'
where id = '20000000-0000-4000-8000-000000000002';
set local role authenticated;
select is(
  (select dispatch_required from public.retry_entry(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002'
  )),
  true,
  'an expired retry lease recovers the same queued entry ID'
);
reset role;
insert into public.processing_attempts (
  entry_id,
  workflow_run_id,
  attempt,
  status,
  started_at,
  finished_at,
  error_code,
  error_message
)
values (
  '20000000-0000-4000-8000-000000000002',
  'historical-failed-run',
  1,
  'failed',
  now() - interval '1 minute',
  now(),
  'HISTORICAL_FAILURE',
  'Synthetic historical failure'
);
set local role service_role;
select lives_ok(
  $$select * from public.fail_entry_dispatch(
    '20000000-0000-4000-8000-000000000002',
    'WORKFLOW_START_FAILED',
    'Synthetic dispatch failure'
  )$$,
  'dispatch failure tolerates historical terminal processing attempts'
);
select lives_ok(
  $$select * from public.fail_entry_dispatch(
    '20000000-0000-4000-8000-000000000002',
    'WORKFLOW_START_FAILED',
    'Synthetic dispatch failure'
  )$$,
  'dispatch failure is idempotent with historical terminal attempts'
);

do $$
declare
  target_entry_id uuid;
  target_attempt_id uuid;
begin
  select entry.id into target_entry_id
  from public.entries as entry
  where entry.canonical_url = 'https://example.test/new';

  update public.entries as entry
  set thumbnail_path = target_entry_id::text || '/old.webp'
  where entry.id = target_entry_id;

  select attempt.id into target_attempt_id
  from public.begin_processing_attempt(target_entry_id, 'thumbnail-finalize-run') as attempt;

  perform public.mark_entry_analyzing(target_entry_id, target_attempt_id);
  perform public.mark_entry_finalizing(target_entry_id, target_attempt_id);
end;
$$;
select is(
  (select finalized.previous_thumbnail_path
   from public.finalize_entry_processing(
     (select id from public.entries where canonical_url = 'https://example.test/new'),
     (select id from public.processing_attempts where workflow_run_id = 'thumbnail-finalize-run'),
     'Processed entry',
     'A processed entry used to verify replay-safe thumbnail cleanup.',
     pg_temp.curio_workflow_thumbnail_path('thumbnail-finalize-run'),
     array['00000000-0000-4000-8000-000000000001']::uuid[]
   ) as finalized),
  (select id::text || '/old.webp' from public.entries where canonical_url = 'https://example.test/new'),
  'finalization returns the private thumbnail path that it replaced'
);
select is(
  (select finalized.previous_thumbnail_path
   from public.finalize_entry_processing(
     (select id from public.entries where canonical_url = 'https://example.test/new'),
     (select id from public.processing_attempts where workflow_run_id = 'thumbnail-finalize-run'),
     'Processed entry',
     'A processed entry used to verify replay-safe thumbnail cleanup.',
     pg_temp.curio_workflow_thumbnail_path('thumbnail-finalize-run'),
     array['00000000-0000-4000-8000-000000000001']::uuid[]
   ) as finalized),
  (select id::text || '/old.webp' from public.entries where canonical_url = 'https://example.test/new'),
  'finalization replay returns the same prior thumbnail for crash recovery'
);
select is(
  (select thumbnail_path from public.entries where canonical_url = 'https://example.test/new'),
  pg_temp.curio_workflow_thumbnail_path('thumbnail-finalize-run'),
  'finalization stores the replacement thumbnail path exactly once'
);

select throws_ok(
  $$select public.reserve_thumbnail_upload(
    '10000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'ENTRY_FORBIDDEN',
  'thumbnail reservation rejects a non-owner contributor'
);
select lives_ok(
  $$select public.reserve_thumbnail_upload(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001'
  )$$,
  'thumbnail reservation accepts the entry owner'
);
do $$
begin
  for reservation_number in 1..4 loop
    perform public.reserve_thumbnail_upload(
      '10000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000001'
    );
  end loop;
end;
$$;
select is(
  (select count(*)
   from public.audit_events
   where actor_user_id = '10000000-0000-4000-8000-000000000002'
     and event_type = 'thumbnail.upload_prepared'),
  5::bigint,
  'thumbnail reservations are recorded for atomic rate limiting'
);
select throws_ok(
  $$select public.reserve_thumbnail_upload(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001'
  )$$,
  'P0001',
  'RATE_LIMIT_EXCEEDED',
  'sixth thumbnail preparation inside ten minutes is rejected'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000002',
    'email', 'contributor@blocked.test'
  )::text,
  true
);
select is(
  (select count(*) from public.processing_attempts),
  0::bigint,
  'a removed-domain session cannot read owned processing attempts'
);
select throws_ok(
  $$select * from public.submit_entry(
    '10000000-0000-4000-8000-000000000002',
    'https://example.test/removed-domain',
    'https://example.test/removed-domain',
    'opensource',
    '{}'::uuid[]
  )$$,
  '42501',
  'ENTRY_FORBIDDEN',
  'actor-bound mutations reject a session whose email domain was removed'
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000002',
    'email', 'contributor@members.test'
  )::text,
  true
);
select lives_ok(
  $$select * from public.update_entry(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    'Updated title',
    'Updated TLDR content for the ready test entry.',
    null,
    null
  )$$,
  'owner can update a terminal entry atomically'
);
select is(
  public.delete_entry(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000004'
  ),
  '20000000-0000-4000-8000-000000000004/original.webp',
  'delete RPC returns the private thumbnail path'
);
reset role;
insert into public.audit_events (
  actor_user_id,
  event_type,
  target_table,
  target_id
)
select
  '10000000-0000-4000-8000-000000000002',
  'entry.submitted',
  'entries',
  '20000000-0000-4000-8000-000000000001'
from generate_series(1, 4);
set local role authenticated;
select throws_ok(
  $$select * from public.submit_entry(
    '10000000-0000-4000-8000-000000000002',
    'https://example.test/rate-limited',
    'https://example.test/rate-limited',
    'opensource',
    '{}'::uuid[]
  )$$,
  'P0001',
  'RATE_LIMIT_EXCEEDED',
  'sixth new submission inside one minute is rejected atomically'
);
set local role service_role;
select throws_ok(
  $$select * from public.create_tag(
    '10000000-0000-4000-8000-000000000002',
    'Forbidden tag',
    'forbidden-tag',
    '#123456'
  )$$,
  '42501',
  'ADMINISTRATOR_REQUIRED',
  'non-administrator cannot mutate taxonomy through the BFF RPC'
);
reset role;

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000003',
  true
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000003',
    'email', 'second@members.test'
  )::text,
  true
);
insert into public.audit_events (
  actor_user_id,
  event_type,
  target_table,
  target_id
)
select
  '10000000-0000-4000-8000-000000000003',
  'entry.retry_requested',
  'entries',
  '20000000-0000-4000-8000-000000000003'
from generate_series(1, 5);
set local role authenticated;
select throws_ok(
  $$select * from public.retry_entry(
    '10000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000003'
  )$$,
  'P0001',
  'RATE_LIMIT_EXCEEDED',
  'retry dispatch is rate limited atomically per actor'
);
select throws_ok(
  $$select * from public.retry_entry(
    '10000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'ENTRY_FORBIDDEN',
  'non-owner contributor cannot retry another entry'
);
reset role;

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000004',
  true
);
set local role service_role;
select lives_ok(
  $$select * from public.update_profile_role(
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000005',
    'reader'
  )$$,
  'one of two administrators can be demoted'
);
select is(
  (select profile.role
   from public.bootstrap_profile(
     '10000000-0000-4000-8000-000000000005',
     'admin-two@example.test',
     'contributor',
     true
   ) as profile),
  'reader'::public.app_role,
  'initial administrator bootstrap never re-elevates an existing demoted profile'
);
select throws_ok(
  $$select * from public.update_profile_role(
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000004',
    'reader'
  )$$,
  '23514',
  'LAST_ADMIN_REQUIRED',
  'database rejects demotion of the last active administrator'
);
select is(
  (select slug from public.create_tag(
    '10000000-0000-4000-8000-000000000004',
    'Portable validation',
    'portable-validation',
    '#654321'
  )),
  'portable-validation',
  'administrator can create a validated tag'
);
select is(
  (select color from public.update_tag(
    '10000000-0000-4000-8000-000000000004',
    (select id from public.tags where slug = 'portable-validation'),
    null,
    null,
    '#123456',
    42
  )),
  '#123456',
  'administrator can update a tag atomically'
);
select throws_ok(
  $$select public.delete_tag(
    '10000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000001'
  )$$,
  '23503',
  'TAG_IN_USE',
  'tag deletion reports a stable error while the tag is in use'
);
select lives_ok(
  $$select public.delete_tag(
    '10000000-0000-4000-8000-000000000004',
    (select id from public.tags where slug = 'portable-validation')
  )$$,
  'administrator can delete an unused tag atomically'
);
select is(
  (select count(*)
   from public.audit_events
   where event_type in ('tag.created', 'tag.updated', 'tag.deleted')
     and payload ->> 'slug' = 'portable-validation'),
  3::bigint,
  'all taxonomy mutations emit audit events'
);
reset role;

select * from finish();
rollback;
