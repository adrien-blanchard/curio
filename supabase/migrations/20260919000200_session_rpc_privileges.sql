begin;

-- Supabase grants service_role EXECUTE on new public functions by default.
-- Session mutations must instead use the caller's authenticated client; the
-- server role retains only its explicitly granted administration/worker RPCs.
revoke execute on function public.submit_entry(uuid, text, text, public.entry_source_type, uuid[]) from service_role;
revoke execute on function public.create_api_token(uuid, text, text, text, text[], timestamptz) from service_role;
revoke execute on function public.revoke_api_token(uuid, uuid) from service_role;
revoke execute on function public.retry_entry(uuid, uuid) from service_role;
revoke execute on function public.update_entry(uuid, uuid, text, text, public.entry_source_type, uuid[]) from service_role;
revoke execute on function public.update_entry(uuid, uuid, text, text, public.entry_source_type, uuid[], boolean, date, text) from service_role;
revoke execute on function public.delete_entry(uuid, uuid) from service_role;

-- Schema-level revocations cannot override global defaults (including the
-- built-in PUBLIC EXECUTE grant). Remove both sources for future functions.
-- Existing function grants, including worker access, are unchanged.
alter default privileges revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated, service_role;

commit;
