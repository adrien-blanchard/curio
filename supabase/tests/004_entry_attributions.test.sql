begin;

select plan(59);

select has_column('public', 'profiles', 'display_name', 'profiles store a display name');
select has_column('public', 'profiles', 'avatar_url', 'profiles store a trusted avatar URL');
select has_table('public', 'entry_attributions', 'entry attribution snapshots exist');
select has_pk('public', 'entry_attributions', 'entry attribution has a primary key');
select has_index(
  'public',
  'entry_attributions',
  'entry_attributions_author_email_entry_idx',
  'entry attribution author filtering is indexed'
);
select ok(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class as relation
    where relation.oid = 'public.entry_attributions'::regclass
  ),
  'entry attribution has forced RLS'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'entry_attributions'
      and policyname = 'entry_attributions_select_active_profile'
      and cmd = 'SELECT'
  ),
  'active members have an explicit attribution read policy'
);
select ok(
  has_table_privilege('authenticated', 'public.entry_attributions', 'select'),
  'authenticated members receive attribution read access'
);
select ok(
  not has_table_privilege('anon', 'public.entry_attributions', 'select'),
  'anonymous clients cannot read attribution snapshots'
);
select ok(
  to_regprocedure('public.sync_profile_identity(uuid,text,text)') is not null,
  'profile identity synchronization RPC exists'
);
select ok(
  to_regprocedure('public.upsert_entry_attribution(uuid,uuid,text,text,text)') is not null,
  'administrator attribution import RPC exists'
);
select ok(
  to_regprocedure(
    'public.list_entries_page(text,public.entry_source_type,text[],boolean,integer,integer,text)'
  ) is not null,
  'author-aware catalog RPC exists'
);
select ok(
  to_regprocedure(
    'public.list_entries_page(text,public.entry_source_type,text[],boolean,integer,integer)'
  ) is not null,
  'backward-compatible catalog wrapper exists'
);
select ok(
  to_regprocedure('public.list_entry_authors()') is not null,
  'distinct catalog author RPC exists'
);
select ok(
  to_regprocedure('private.attribution_email_valid(text)') is not null,
  'shared attribution email validator exists'
);
select ok(
  private.attribution_email_valid('member@example.test'),
  'attribution validator accepts a normalized address with DNS labels'
);
select ok(
  not private.attribution_email_valid('x@y'),
  'attribution validator rejects an address without a dotted domain'
);
select ok(
  private.attribution_email_valid('a+b@sub.example.co'),
  'attribution validator accepts a Zod-compatible address'
);
select ok(
  not private.attribution_email_valid('x@y.z'),
  'attribution validator rejects a one-character top-level label'
);
select ok(
  not private.attribution_email_valid('x@y.1'),
  'attribution validator rejects a numeric top-level label'
);
select ok(
  not private.attribution_email_valid('x@y.c0'),
  'attribution validator rejects an alphanumeric top-level label'
);
select ok(
  not private.attribution_email_valid('a@b-.co'),
  'attribution validator rejects a domain label ending in a hyphen'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.sync_profile_identity(uuid,text,text)',
    'execute'
  ),
  'service role can synchronize OAuth identity'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.sync_profile_identity(uuid,text,text)',
    'execute'
  ),
  'members cannot call identity synchronization directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.upsert_entry_attribution(uuid,uuid,text,text,text)',
    'execute'
  ),
  'service role can import an attribution after administrator validation'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.upsert_entry_attribution(uuid,uuid,text,text,text)',
    'execute'
  ),
  'members cannot import attribution directly'
);

select public.replace_allowed_email_access(
  array['example.test'],
  '{}'::text[]
);

insert into auth.users (id, email, raw_user_meta_data)
values
  (
    '71000000-0000-4000-8000-000000000001',
    'admin@example.test',
    '{}'::jsonb
  ),
  (
    '71000000-0000-4000-8000-000000000002',
    'member@example.test',
    '{}'::jsonb
  );

insert into public.profiles (
  id,
  email,
  role,
  display_name,
  avatar_url
)
values
  (
    '71000000-0000-4000-8000-000000000001',
    'admin@example.test',
    'administrator',
    'Admin User',
    'https://lh3.googleusercontent.com/a/admin=s96-c'
  ),
  (
    '71000000-0000-4000-8000-000000000002',
    'member@example.test',
    'contributor',
    'Member User',
    'https://lh3.googleusercontent.com/a/member=s96-c'
  );

insert into public.entries (
  id,
  url,
  canonical_url,
  title,
  tldr,
  source_type,
  status,
  created_by,
  published_at
)
values (
  '72000000-0000-4000-8000-000000000001',
  'https://example.test/legacy',
  'https://example.test/legacy',
  'Legacy entry',
  'A ready entry used to verify attribution snapshots.',
  'opensource',
  'ready',
  '71000000-0000-4000-8000-000000000002',
  now()
);

select is(
  (select count(*) from public.entry_attributions),
  1::bigint,
  'entry insertion creates one attribution snapshot'
);
select is(
  (select author_email from public.entry_attributions),
  'member@example.test',
  'the snapshot records the normalized profile email'
);
select is(
  (select display_name from public.entry_attributions),
  'Member User',
  'the snapshot records the profile display name'
);
select is(
  (select avatar_url from public.entry_attributions),
  'https://lh3.googleusercontent.com/a/member=s96-c',
  'the snapshot records the trusted Google avatar'
);
select is(
  (
    select created_by
    from public.entries
    where id = '72000000-0000-4000-8000-000000000001'
  ),
  '71000000-0000-4000-8000-000000000002'::uuid,
  'secure ownership remains on entries.created_by'
);

select public.sync_profile_identity(
  '71000000-0000-4000-8000-000000000002',
  '  Ada   Lovelace  ',
  'https://lh3.googleusercontent.com/a/current=s96-c'
);
select is(
  (
    select display_name
    from public.profiles
    where id = '71000000-0000-4000-8000-000000000002'
  ),
  'Ada Lovelace',
  'profile synchronization normalizes repeated whitespace'
);
select is(
  (
    select avatar_url
    from public.profiles
    where id = '71000000-0000-4000-8000-000000000002'
  ),
  'https://lh3.googleusercontent.com/a/current=s96-c',
  'profile synchronization stores the trusted Google avatar'
);
select is(
  (select display_name from public.entry_attributions),
  'Ada Lovelace',
  'current-profile attribution receives the synchronized display name'
);
select is(
  (select avatar_url from public.entry_attributions),
  'https://lh3.googleusercontent.com/a/current=s96-c',
  'current-profile attribution receives the synchronized avatar'
);

select public.sync_profile_identity(
  '71000000-0000-4000-8000-000000000002',
  null,
  null
);
select is(
  (
    select display_name
    from public.profiles
    where id = '71000000-0000-4000-8000-000000000002'
  ),
  'Ada Lovelace',
  'missing OAuth name metadata does not erase a valid profile name'
);
select is(
  (select avatar_url from public.entry_attributions),
  'https://lh3.googleusercontent.com/a/current=s96-c',
  'missing OAuth avatar metadata does not erase a valid attribution avatar'
);
select throws_ok(
  $$select public.sync_profile_identity(
    '71000000-0000-4000-8000-000000000002',
    'Ada Lovelace',
    'https://attacker.example/avatar.png'
  )$$,
  '22023',
  'INVALID_PROFILE_AVATAR_URL',
  'profile synchronization rejects a non-Google avatar host'
);
select throws_ok(
  $$select public.upsert_entry_attribution(
    '71000000-0000-4000-8000-000000000002',
    '72000000-0000-4000-8000-000000000001',
    'legacy@example.test',
    'Legacy Author',
    null
  )$$,
  '42501',
  'ADMINISTRATOR_REQUIRED',
  'a contributor cannot import historical attribution'
);
select throws_ok(
  $$select public.upsert_entry_attribution(
    '71000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    'x@y',
    'Invalid Author',
    null
  )$$,
  '22023',
  'INVALID_ATTRIBUTION_EMAIL',
  'administrator attribution import rejects an address the dashboard cannot parse'
);
select throws_ok(
  $$update public.entry_attributions
    set author_email = 'x@y.z'
    where entry_id = '72000000-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'the table constraint rejects an address the dashboard cannot parse'
);

select public.upsert_entry_attribution(
  '71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  ' LEGACY@EXAMPLE.TEST ',
  '  Legacy   Author ',
  null
);
select is(
  (select author_email from public.entry_attributions),
  'legacy@example.test',
  'administrator attribution import normalizes the author email'
);
select is(
  (select display_name from public.entry_attributions),
  'Legacy Author',
  'administrator attribution import normalizes the display name'
);
select is(
  (select avatar_url from public.entry_attributions),
  null,
  'historical attribution accepts an absent avatar'
);
create temporary table attribution_before_idempotent_upsert as
select updated_at
from public.entry_attributions
where entry_id = '72000000-0000-4000-8000-000000000001';
select public.upsert_entry_attribution(
  '71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  'legacy@example.test',
  'Legacy Author',
  null
);
select is(
  (
    select attribution.updated_at
    from public.entry_attributions as attribution
    where attribution.entry_id = '72000000-0000-4000-8000-000000000001'
  ),
  (select snapshot.updated_at from attribution_before_idempotent_upsert as snapshot),
  'replaying an unchanged attribution import is a write-free no-op'
);
select is(
  (
    select count(*)
    from public.audit_events as audit_event
    where audit_event.event_type = 'entry.attribution_updated'
      and audit_event.target_id = '72000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'replaying an unchanged attribution import does not duplicate its audit event'
);
select is(
  (
    select created_by
    from public.entries
    where id = '72000000-0000-4000-8000-000000000001'
  ),
  '71000000-0000-4000-8000-000000000002'::uuid,
  'attribution import never changes secure ownership'
);

select public.sync_profile_identity(
  '71000000-0000-4000-8000-000000000002',
  'Current Member',
  'https://lh3.googleusercontent.com/a/new-current=s96-c'
);
select is(
  (select author_email from public.entry_attributions),
  'legacy@example.test',
  'profile refresh does not overwrite imported historical attribution'
);

select set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000002',
  true
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '71000000-0000-4000-8000-000000000002',
    'email', 'MEMBER@EXAMPLE.TEST'
  )::text,
  true
);
set local role authenticated;

select ok(
  (
    select submitted.created
    from public.submit_entry(
      '71000000-0000-4000-8000-000000000002',
      'https://example.test/current',
      'https://example.test/current',
      'opensource',
      '{}'::uuid[]
    ) as submitted
  ),
  'normal submission creates a new entry'
);
select is(
  (
    select attribution.author_email
    from public.entry_attributions as attribution
    join public.entries as entry on entry.id = attribution.entry_id
    where entry.canonical_url = 'https://example.test/current'
  ),
  'member@example.test',
  'future submissions snapshot the current profile email'
);
select is(
  (
    select attribution.avatar_url
    from public.entry_attributions as attribution
    join public.entries as entry on entry.id = attribution.entry_id
    where entry.canonical_url = 'https://example.test/current'
  ),
  'https://lh3.googleusercontent.com/a/new-current=s96-c',
  'future submissions snapshot the current Google avatar'
);
select is(
  (select count(*) from public.entry_attributions),
  2::bigint,
  'an active member can read catalog attribution snapshots through RLS'
);
select is(
  (
    select count(*)
    from public.list_entries_page(
      null,
      null,
      '{}'::text[],
      false,
      0,
      100,
      'legacy@example.test'
    )
  ),
  1::bigint,
  'catalog author filtering matches one exact historical email'
);
select is(
  (
    select page.author_display_name
    from public.list_entries_page(
      null,
      null,
      '{}'::text[],
      false,
      0,
      100,
      'legacy@example.test'
    ) as page
  ),
  'Legacy Author',
  'catalog rows expose the attribution display name'
);
select is(
  (
    select count(*)
    from public.list_entries_page(
      null,
      null,
      '{}'::text[],
      false,
      0,
      100,
      ' MEMBER@EXAMPLE.TEST '
    )
  ),
  1::bigint,
  'catalog author filtering is case-insensitive around an exact email'
);
select is(
  (
    select count(*)
    from public.list_entries_page(
      null,
      null,
      '{}'::text[],
      false,
      0,
      100
    )
  ),
  2::bigint,
  'legacy six-argument catalog calls still return the full catalog'
);
select is(
  (select count(*) from public.list_entry_authors()),
  2::bigint,
  'author filter options contain one row per exact author email'
);
select is(
  (
    select author.entry_count
    from public.list_entry_authors() as author
    where author.author_email = 'legacy@example.test'
  ),
  1::bigint,
  'author options report the exact entry count'
);
select throws_ok(
  $$select * from public.list_entries_page(
    null,
    null,
    '{}'::text[],
    false,
    0,
    100,
    'x@y'
  )$$,
  '22023',
  'INVALID_AUTHOR_EMAIL',
  'catalog author filtering rejects malformed email input'
);

reset role;
select * from finish();
rollback;
