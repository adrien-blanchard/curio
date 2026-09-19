begin;

select plan(29);

select has_table(
  'public',
  'allowed_email_addresses',
  'exact email-address configuration exists'
);
select ok(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class as relation
    where relation.oid = 'public.allowed_email_addresses'::regclass
  ),
  'exact email-address configuration has forced RLS'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'allowed_email_addresses'
      and policyname = 'allowed_email_addresses_deny_direct_access'
      and cmd = 'ALL'
      and qual = 'false'
      and with_check = 'false'
  ),
  'exact email-address configuration has an explicit client deny policy'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.allowed_email_addresses',
    'select'
  ),
  'authenticated clients cannot read exact email-address configuration'
);
select ok(
  to_regprocedure('public.replace_allowed_email_access(text[],text[])') is not null,
  'combined email-access replacement RPC exists'
);
select is(
  pg_get_function_result(
    'public.replace_allowed_email_access(text[],text[])'::regprocedure
  ),
  'void',
  'combined email-access replacement RPC returns void'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.replace_allowed_email_access(text[],text[])',
    'execute'
  ),
  'service role can replace combined email access'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.replace_allowed_email_access(text[],text[])',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.replace_allowed_email_access(text[],text[])',
    'execute'
  ),
  'client roles cannot replace combined email access'
);

select lives_ok(
  $$select public.replace_allowed_email_access(
    array[' EXAMPLE.TEST ', 'members.test', 'example.test'],
    array[
      ' Person@Outside.Test ',
      'other@outside.test',
      'person@outside.test'
    ]
  )$$,
  'combined replacement lowercases, trims, and deduplicates both lists'
);
select is(
  (select array_agg(configured.domain order by configured.domain)
   from public.allowed_email_domains as configured),
  array['example.test', 'members.test']::text[],
  'combined replacement stores normalized domains'
);
select is(
  (select array_agg(configured.email order by configured.email)
   from public.allowed_email_addresses as configured),
  array['other@outside.test', 'person@outside.test']::text[],
  'combined replacement stores normalized exact addresses'
);

update public.allowed_email_domains
set created_at = '2000-01-01 00:00:00+00'::timestamptz
where domain is not null;
update public.allowed_email_addresses
set created_at = '2000-01-01 00:00:00+00'::timestamptz
where email is not null;
do $$
begin
  perform public.replace_allowed_email_access(
    array['MEMBERS.TEST', 'example.test', 'example.test'],
    array['PERSON@OUTSIDE.TEST', 'other@outside.test']
  );
end;
$$;
select is(
  (
    select count(*)
    from (
      select configured.created_at
      from public.allowed_email_domains as configured
      union all
      select configured.created_at
      from public.allowed_email_addresses as configured
    ) as access_configuration
    where access_configuration.created_at = '2000-01-01 00:00:00+00'::timestamptz
  ),
  4::bigint,
  'an unchanged combined set is a write-free idempotent no-op'
);

select ok(
  private.email_domain_allowed(' PERSON@OUTSIDE.TEST '),
  'an exact normalized address is allowed'
);
select ok(
  private.email_domain_allowed('anyone@example.test'),
  'an address on an allowed domain is allowed'
);
select ok(
  not private.email_domain_allowed('blocked@outside.test'),
  'an unlisted exact address outside configured domains is denied'
);

select throws_ok(
  $$select public.replace_allowed_email_access('{}'::text[], '{}'::text[])$$,
  '22023',
  'INVALID_ALLOWED_EMAIL_ACCESS',
  'combined replacement requires at least one access entry'
);
select throws_ok(
  $$select public.replace_allowed_email_access(array['bad..test'], '{}'::text[])$$,
  '22023',
  'INVALID_ALLOWED_EMAIL_DOMAINS',
  'combined replacement rejects malformed domains'
);
select throws_ok(
  $$select public.replace_allowed_email_access(
    '{}'::text[],
    array['not-an-email']
  )$$,
  '22023',
  'INVALID_ALLOWED_EMAIL_ADDRESSES',
  'combined replacement rejects malformed exact addresses'
);
select throws_ok(
  $$select public.replace_allowed_email_access(
    array(
      select format('domain%s.example.test', value)
      from generate_series(1, 101) as generated(value)
    ),
    '{}'::text[]
  )$$,
  '22023',
  'INVALID_ALLOWED_EMAIL_DOMAINS',
  'combined replacement limits domains to 100 inputs'
);
select throws_ok(
  $$select public.replace_allowed_email_access(
    '{}'::text[],
    array(
      select format('person%s@example.test', value)
      from generate_series(1, 101) as generated(value)
    )
  )$$,
  '22023',
  'INVALID_ALLOWED_EMAIL_ADDRESSES',
  'combined replacement limits exact addresses to 100 inputs'
);

insert into auth.users (id, email)
values ('10000000-0000-4000-8000-000000000007', 'admin@admin-only.test');
insert into public.profiles (id, email, role)
values (
  '10000000-0000-4000-8000-000000000007',
  'admin@admin-only.test',
  'administrator'
);

select lives_ok(
  $$select public.replace_allowed_email_access(
    '{}'::text[],
    array['ADMIN@ADMIN-ONLY.TEST']
  )$$,
  'an exact address can retain the last active administrator'
);
select ok(
  private.email_domain_allowed('admin@admin-only.test'),
  'the last administrator is allowed by its exact address'
);
select lives_ok(
  $$select public.replace_allowed_email_access(
    array['ADMIN-ONLY.TEST'],
    '{}'::text[]
  )$$,
  'a domain can retain the last active administrator'
);
select ok(
  private.email_domain_allowed('admin@admin-only.test'),
  'the last administrator is allowed by its domain'
);
select throws_ok(
  $$select public.replace_allowed_email_access(
    array['other.test'],
    array['someone@else.test']
  )$$,
  '23514',
  'LAST_ADMIN_REQUIRED',
  'combined replacement cannot exclude every active administrator'
);
select is(
  (select array_agg(configured.domain order by configured.domain)
   from public.allowed_email_domains as configured),
  array['admin-only.test']::text[],
  'a rejected last-administrator replacement leaves configuration unchanged'
);
select lives_ok(
  $$select public.replace_allowed_email_access(
    '{}'::text[],
    array['admin@admin-only.test']
  )$$,
  'exact-only access can be prepared for a legacy domain synchronization'
);
select is(
  (select array_agg(configured.domain order by configured.domain)
   from public.replace_allowed_email_domains(array['legacy.test']) as configured),
  array['legacy.test']::text[],
  'legacy domain replacement RPC remains compatible'
);
select is(
  (select array_agg(configured.email order by configured.email)
   from public.allowed_email_addresses as configured),
  array['admin@admin-only.test']::text[],
  'legacy domain replacement preserves exact-address configuration'
);

select * from finish();
rollback;
