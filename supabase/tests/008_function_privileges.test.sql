begin;

select plan(7);

create function public.test_ungranted_function()
returns integer
language sql
as $$ select 1 $$;

select ok(
  not has_function_privilege('anon', 'public.test_ungranted_function()', 'execute'),
  'new functions are not implicitly executable by anonymous clients'
);
select ok(
  not has_function_privilege('authenticated', 'public.test_ungranted_function()', 'execute'),
  'new functions require an explicit authenticated grant'
);
select ok(
  not has_function_privilege('service_role', 'public.test_ungranted_function()', 'execute'),
  'new functions require an explicit service role grant'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.update_entry(uuid,uuid,text,text,public.entry_source_type,uuid[],boolean,date,text)',
    'execute'
  ),
  'dated entry updates remain session-only'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.finalize_entry_processing(uuid,uuid,text,text,text,public.thumbnail_origin,uuid[],date,text)',
    'execute'
  ),
  'worker finalization remains explicitly granted to the service role'
);

set local role service_role;
select throws_ok(
  $$ select public.test_ungranted_function() $$,
  '42501',
  'permission denied for function test_ungranted_function',
  'service role cannot execute a function without an explicit grant'
);
select throws_ok(
  $$ select public.submit_entry(null::uuid, 'https://example.test/', 'example', null::public.entry_source_type, '{}'::uuid[]) $$,
  '42501',
  'permission denied for function submit_entry',
  'service role cannot invoke session submission'
);
reset role;

select * from finish();
rollback;
