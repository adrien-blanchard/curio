begin;

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.allowed_email_domains enable row level security;
alter table public.allowed_email_domains force row level security;
alter table public.entries enable row level security;
alter table public.entries force row level security;
alter table public.tags enable row level security;
alter table public.tags force row level security;
alter table public.entry_tags enable row level security;
alter table public.entry_tags force row level security;
alter table public.processing_attempts enable row level security;
alter table public.processing_attempts force row level security;
alter table public.api_tokens enable row level security;
alter table public.api_tokens force row level security;
alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;

create policy profiles_select_self_or_administrator
on public.profiles
for select
to authenticated
using (
  public.current_app_role() is not null
  and (
    id = auth.uid()
    or public.current_app_role() = 'administrator'::public.app_role
  )
);

create policy entries_select_active_profile
on public.entries
for select
to authenticated
using (public.current_app_role() is not null);

create policy tags_select_active_profile
on public.tags
for select
to authenticated
using (public.current_app_role() is not null);

create policy entry_tags_select_active_profile
on public.entry_tags
for select
to authenticated
using (public.current_app_role() is not null);

create policy processing_attempts_select_owner_or_administrator
on public.processing_attempts
for select
to authenticated
using (
  public.current_app_role() is not null
  and (
    public.current_app_role() = 'administrator'::public.app_role
    or exists (
      select 1
      from public.entries as entry
      where entry.id = processing_attempts.entry_id
        and entry.created_by = auth.uid()
    )
  )
);

create policy api_tokens_select_owner_or_administrator
on public.api_tokens
for select
to authenticated
using (
  public.current_app_role() is not null
  and (
    user_id = auth.uid()
    or public.current_app_role() = 'administrator'::public.app_role
  )
);

create policy audit_events_select_administrator
on public.audit_events
for select
to authenticated
using (public.current_app_role() = 'administrator'::public.app_role);

revoke create on schema public from public;
grant usage on schema public to anon, authenticated, service_role;
revoke all on all tables in schema public from anon, authenticated;

grant select on public.profiles to authenticated;
grant select on public.entries to authenticated;
grant select on public.tags to authenticated;
grant select on public.entry_tags to authenticated;
grant select on public.processing_attempts to authenticated;
grant select (
  id,
  user_id,
  name,
  token_prefix,
  scopes,
  expires_at,
  last_used_at,
  revoked_at,
  created_at,
  updated_at
) on public.api_tokens to authenticated;
grant select on public.audit_events to authenticated;

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.current_app_role() to authenticated;
grant execute on function public.authenticate_api_token(text, text[])
  to anon;
grant execute on function public.get_profile_with_token(text)
  to anon;
grant execute on function public.get_tags_with_token(text)
  to anon;

grant execute on function public.create_api_token(
  uuid,
  text,
  text,
  text,
  text[],
  timestamptz
) to authenticated;
grant execute on function public.revoke_api_token(uuid, uuid) to authenticated;
grant execute on function public.submit_entry(
  uuid,
  text,
  text,
  public.entry_source_type,
  uuid[]
) to authenticated;
grant execute on function public.submit_entry_with_token(
  text,
  text,
  text,
  public.entry_source_type,
  uuid[]
) to anon;
grant execute on function public.retry_entry(uuid, uuid) to authenticated;
grant execute on function public.retry_entry_with_token(text, uuid)
  to anon;
grant execute on function public.update_entry(
  uuid,
  uuid,
  text,
  text,
  public.entry_source_type,
  uuid[]
) to authenticated;
grant execute on function public.delete_entry(uuid, uuid) to authenticated;
grant execute on function public.list_entries_page(
  text,
  public.entry_source_type,
  text[],
  boolean,
  integer,
  integer
) to authenticated;
grant execute on function public.replace_entry_thumbnail(uuid, uuid, text)
  to service_role;
grant execute on function public.reserve_thumbnail_upload(uuid, uuid)
  to service_role;
grant execute on function public.update_profile_role(
  uuid,
  uuid,
  public.app_role
) to service_role;
grant execute on function public.create_tag(uuid, text, text, text)
  to service_role;
grant execute on function public.update_tag(
  uuid,
  uuid,
  text,
  text,
  text,
  integer
) to service_role;
grant execute on function public.delete_tag(uuid, uuid)
  to service_role;

grant execute on function public.bootstrap_profile(
  uuid,
  text,
  public.app_role,
  boolean
) to service_role;
grant execute on function public.replace_allowed_email_domains(text[])
  to service_role;
grant execute on function public.begin_processing_attempt(uuid, text)
  to service_role;
grant execute on function public.fail_entry_dispatch(uuid, text, text)
  to service_role;
grant execute on function public.mark_entry_analyzing(uuid, uuid)
  to service_role;
grant execute on function public.mark_entry_finalizing(uuid, uuid)
  to service_role;
grant execute on function public.finalize_entry_processing(
  uuid,
  uuid,
  text,
  text,
  text,
  uuid[]
) to service_role;
grant execute on function public.fail_entry_processing(
  uuid,
  uuid,
  text,
  text,
  boolean
) to service_role;

alter default privileges in schema public
  revoke all on tables from anon, authenticated;
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'thumbnails',
  'thumbnails',
  false,
  5242880,
  array['image/webp']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'thumbnail_uploads',
  'thumbnail_uploads',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy thumbnails_select_active_profile
on storage.objects
for select
to authenticated
using (
  bucket_id = 'thumbnails'
  and public.current_app_role() is not null
  and exists (
    select 1
    from public.entries as entry
    where entry.id::text = split_part(storage.objects.name, '/', 1)
      and entry.thumbnail_path = storage.objects.name
  )
);

alter table public.entries replica identity full;
alter table public.tags replica identity full;
alter table public.entry_tags replica identity full;

do $$
declare
  table_to_publish text;
begin
  foreach table_to_publish in array array['entries', 'tags', 'entry_tags']
  loop
    if not exists (
      select 1
      from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_to_publish
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        table_to_publish
      );
    end if;
  end loop;
end;
$$;

commit;
