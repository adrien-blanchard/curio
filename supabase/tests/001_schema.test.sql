begin;

select plan(79);

select has_table('public', 'profiles', 'profiles table exists');
select has_table(
  'public',
  'allowed_email_domains',
  'allowed email domain configuration exists'
);
select has_table('public', 'entries', 'entries table exists');
select has_table('public', 'tags', 'tags table exists');
select has_table('public', 'entry_tags', 'entry_tags table exists');
select has_table('public', 'processing_attempts', 'processing_attempts table exists');
select has_table('public', 'api_tokens', 'api_tokens table exists');
select has_table('public', 'audit_events', 'audit_events table exists');

select is(
  (select format_type(attribute.atttypid, attribute.atttypmod)
   from pg_catalog.pg_attribute as attribute
   where attribute.attrelid = 'public.profiles'::regclass
     and attribute.attname = 'role'),
  'app_role',
  'profiles.role uses app_role'
);
select is(
  (select format_type(attribute.atttypid, attribute.atttypmod)
   from pg_catalog.pg_attribute as attribute
   where attribute.attrelid = 'public.entries'::regclass
     and attribute.attname = 'source_type'),
  'entry_source_type',
  'entries.source_type uses entry_source_type'
);
select is(
  (select format_type(attribute.atttypid, attribute.atttypmod)
   from pg_catalog.pg_attribute as attribute
   where attribute.attrelid = 'public.entries'::regclass
     and attribute.attname = 'status'),
  'entry_status',
  'entries.status uses entry_status'
);
select col_type_is(
  'public',
  'processing_attempts',
  'attempt',
  'integer',
  'processing_attempts.attempt is an integer'
);
select col_type_is(
  'public',
  'entries',
  'search_document',
  'tsvector',
  'entries.search_document is tsvector'
);
select is(
  (select attribute.attgenerated::text
   from pg_catalog.pg_attribute as attribute
   where attribute.attrelid = 'public.entries'::regclass
     and attribute.attname = 'search_document'),
  's',
  'search_document is generated and stored'
);

select has_index(
  'public',
  'entries',
  'entries_canonical_url_unique_idx',
  'canonical URL uniqueness is indexed'
);
select has_index(
  'public',
  'entries',
  'entries_search_document_idx',
  'full-text search is indexed'
);
select has_pk('public', 'entry_tags', 'entry_tags has a composite primary key');

select is(
  (select count(*)::integer
   from pg_catalog.pg_class
   where oid = any(array[
     'public.profiles'::regclass,
     'public.allowed_email_domains'::regclass,
     'public.entries'::regclass,
     'public.tags'::regclass,
     'public.entry_tags'::regclass,
     'public.processing_attempts'::regclass,
     'public.api_tokens'::regclass,
     'public.audit_events'::regclass
   ]) and relrowsecurity),
  8,
  'RLS is enabled on every exposed table'
);
select is(
  (select count(*)::integer
   from pg_catalog.pg_class
   where oid = any(array[
     'public.profiles'::regclass,
     'public.allowed_email_domains'::regclass,
     'public.entries'::regclass,
     'public.tags'::regclass,
     'public.entry_tags'::regclass,
     'public.processing_attempts'::regclass,
     'public.api_tokens'::regclass,
     'public.audit_events'::regclass
   ]) and relforcerowsecurity),
  8,
  'RLS is forced on every exposed table'
);

select ok(
  exists (select 1 from storage.buckets where id = 'thumbnails' and not public),
  'thumbnails bucket is private'
);
select is(
  (select file_size_limit from storage.buckets where id = 'thumbnails'),
  5242880::bigint,
  'thumbnails bucket enforces 5 MiB'
);
select is(
  (select allowed_mime_types from storage.buckets where id = 'thumbnails'),
  array['image/webp']::text[],
  'thumbnails bucket accepts WebP only'
);
select ok(
  exists (
    select 1
    from storage.buckets
    where id = 'thumbnail_uploads'
      and not public
  ),
  'thumbnail upload staging bucket is private'
);
select is(
  (select file_size_limit from storage.buckets where id = 'thumbnail_uploads'),
  5242880::bigint,
  'thumbnail upload staging enforces 5 MiB'
);
select is(
  (select allowed_mime_types from storage.buckets where id = 'thumbnail_uploads'),
  array['image/jpeg', 'image/png', 'image/webp']::text[],
  'thumbnail upload staging accepts only supported input MIME types'
);
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname like 'thumbnail_uploads%'
  ),
  0,
  'thumbnail upload staging exposes no direct client policy'
);
select is(
  (select count(*)::integer
   from pg_catalog.pg_publication_tables
   where pubname = 'supabase_realtime'
     and schemaname = 'public'
     and tablename in ('entries', 'tags', 'entry_tags')),
  3,
  'Realtime publishes the three catalog tables'
);

select is(
  (select array_agg(enumlabel::text order by enumsortorder)
   from pg_catalog.pg_enum
   where enumtypid = 'public.app_role'::regtype),
  array['reader', 'contributor', 'administrator'],
  'application roles are exact'
);
select is(
  (select array_agg(enumlabel::text order by enumsortorder)
   from pg_catalog.pg_enum
   where enumtypid = 'public.entry_source_type'::regtype),
  array['opensource', 'proprietary'],
  'entry source types are exact'
);
select is(
  (select array_agg(enumlabel::text order by enumsortorder)
   from pg_catalog.pg_enum
   where enumtypid = 'public.entry_status'::regtype),
  array['queued', 'analyzing', 'finalizing', 'ready', 'failed'],
  'entry states are exact'
);
select is(
  (select array_agg(enumlabel::text order by enumsortorder)
   from pg_catalog.pg_enum
   where enumtypid = 'public.processing_attempt_status'::regtype),
  array['queued', 'running', 'succeeded', 'failed', 'cancelled'],
  'attempt states are exact'
);

select ok(
  to_regprocedure('public.submit_entry(uuid,text,text,public.entry_source_type,uuid[])') is not null,
  'session submission RPC exists'
);
select ok(
  to_regprocedure('public.submit_entry_with_token(text,text,text,public.entry_source_type,uuid[])') is not null,
  'PAT submission RPC exists'
);
select ok(to_regprocedure('public.retry_entry(uuid,uuid)') is not null, 'session retry RPC exists');
select ok(
  to_regprocedure('public.retry_entry_with_token(text,uuid)') is not null,
  'PAT retry RPC exists'
);
select ok(
  to_regprocedure('public.update_entry(uuid,uuid,text,text,public.entry_source_type,uuid[])') is not null,
  'atomic entry update RPC exists'
);
select ok(to_regprocedure('public.delete_entry(uuid,uuid)') is not null, 'atomic entry delete RPC exists');
select ok(
  to_regprocedure(
    'public.list_entries_page(text,public.entry_source_type,text[],boolean,integer,integer)'
  ) is not null,
  'server-paginated catalog RPC exists'
);
select ok(
  to_regprocedure('public.replace_entry_thumbnail(uuid,uuid,text)') is not null,
  'thumbnail attachment RPC exists'
);
select ok(
  to_regprocedure('public.reserve_thumbnail_upload(uuid,uuid)') is not null,
  'thumbnail upload reservation RPC exists'
);
select ok(
  to_regprocedure('public.begin_processing_attempt(uuid,text)') is not null,
  'begin attempt RPC exists'
);
select ok(
  to_regprocedure('public.mark_entry_analyzing(uuid,uuid)') is not null,
  'analyzing transition RPC exists'
);
select ok(
  to_regprocedure('public.mark_entry_finalizing(uuid,uuid)') is not null,
  'finalizing transition RPC exists'
);
select ok(
  to_regprocedure('public.finalize_entry_processing(uuid,uuid,text,text,text,uuid[])') is not null,
  'finalization RPC exists'
);
select ok(
  to_regprocedure('public.fail_entry_processing(uuid,uuid,text,text,boolean)') is not null,
  'processing failure RPC exists'
);
select ok(
  to_regprocedure('public.fail_entry_dispatch(uuid,text,text)') is not null,
  'dispatch failure RPC exists'
);
select ok(
  to_regprocedure('public.update_profile_role(uuid,uuid,public.app_role)') is not null,
  'administrator role RPC exists'
);
select ok(
  to_regprocedure('public.create_tag(uuid,text,text,text)') is not null,
  'audited tag creation RPC exists'
);
select ok(
  to_regprocedure('public.update_tag(uuid,uuid,text,text,text,integer)') is not null,
  'audited tag update RPC exists'
);
select ok(
  to_regprocedure('public.delete_tag(uuid,uuid)') is not null,
  'audited tag deletion RPC exists'
);
select ok(
  to_regprocedure('public.authenticate_api_token(text,text[])') is not null,
  'PAT authentication RPC exists'
);
select ok(
  to_regprocedure('public.replace_allowed_email_domains(text[])') is not null,
  'allowed email domain replacement RPC exists'
);

select ok(
  not has_column_privilege('authenticated', 'public.api_tokens', 'token_hash', 'select'),
  'authenticated clients cannot select token verifiers'
);
select ok(
  not has_function_privilege('authenticated', 'public.begin_processing_attempt(uuid,text)', 'execute'),
  'authenticated clients cannot invoke worker RPCs'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.submit_entry(uuid,text,text,public.entry_source_type,uuid[])',
    'execute'
  ),
  'authenticated sessions can invoke the actor-bound submission RPC'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.submit_entry(uuid,text,text,public.entry_source_type,uuid[])',
    'execute'
  ),
  'service role is not granted ordinary session submission'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.create_api_token(uuid,text,text,text,text[],timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.revoke_api_token(uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.retry_entry(uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.update_entry(uuid,uuid,text,text,public.entry_source_type,uuid[])',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.delete_entry(uuid,uuid)',
    'execute'
  ),
  'service role is not granted ordinary token or entry mutations'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.create_api_token(uuid,text,text,text,text[],timestamptz)',
    'execute'
  ),
  'authenticated sessions can create their own API tokens'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.revoke_api_token(uuid,uuid)',
    'execute'
  ),
  'authenticated sessions can revoke owned API tokens'
);
select ok(
  has_function_privilege('authenticated', 'public.retry_entry(uuid,uuid)', 'execute'),
  'authenticated sessions can retry through an actor-bound RPC'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.update_entry(uuid,uuid,text,text,public.entry_source_type,uuid[])',
    'execute'
  ),
  'authenticated sessions can update through an actor-bound RPC'
);
select ok(
  has_function_privilege('authenticated', 'public.delete_entry(uuid,uuid)', 'execute'),
  'authenticated sessions can delete through an actor-bound RPC'
);
select ok(
  has_function_privilege(
    'anon',
    'public.submit_entry_with_token(text,text,text,public.entry_source_type,uuid[])',
    'execute'
  ),
  'anonymous PostgREST callers can submit only through PAT verification'
);
select ok(
  has_function_privilege('anon', 'public.retry_entry_with_token(text,uuid)', 'execute'),
  'anonymous PostgREST callers can retry only through PAT verification'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.list_entries_page(text,public.entry_source_type,text[],boolean,integer,integer)',
    'execute'
  ),
  'authenticated sessions can invoke server pagination'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.list_entries_page(text,public.entry_source_type,text[],boolean,integer,integer)',
    'execute'
  ),
  'anonymous callers cannot invoke private catalog pagination'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.replace_entry_thumbnail(uuid,uuid,text)',
    'execute'
  ),
  'authenticated PostgREST clients cannot attach arbitrary thumbnails'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.reserve_thumbnail_upload(uuid,uuid)',
    'execute'
  ),
  'authenticated PostgREST clients cannot reserve server-side staging uploads'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.reserve_thumbnail_upload(uuid,uuid)',
    'execute'
  ),
  'service role can reserve a guarded staging upload'
);
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and 'authenticated' = any(roles)
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ),
  0,
  'authenticated clients have no thumbnail storage write policy'
);
select ok(
  not has_table_privilege('authenticated', 'public.tags', 'insert'),
  'authenticated clients cannot insert tags directly'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.allowed_email_domains',
    'select'
  ),
  'authenticated clients cannot read deployment domain configuration'
);
select ok(
  not has_table_privilege('authenticated', 'public.entry_tags', 'delete'),
  'authenticated clients cannot mutate tag relations directly'
);
select ok(
  has_function_privilege('service_role', 'public.begin_processing_attempt(uuid,text)', 'execute'),
  'service role can begin processing'
);
select ok(
  not has_function_privilege('authenticated', 'public.bootstrap_profile(uuid,text,public.app_role,boolean)', 'execute'),
  'authenticated clients cannot bootstrap profiles'
);
select ok(
  has_function_privilege('service_role', 'public.bootstrap_profile(uuid,text,public.app_role,boolean)', 'execute'),
  'service role can bootstrap profiles'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.replace_allowed_email_domains(text[])',
    'execute'
  ),
  'authenticated clients cannot replace deployment domains'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.replace_allowed_email_domains(text[])',
    'execute'
  ),
  'service role can atomically replace deployment domains'
);
select ok(
  has_function_privilege('anon', 'public.authenticate_api_token(text,text[])', 'execute'),
  'anonymous PostgREST role can validate a PAT verifier input'
);

select * from finish();
rollback;
