begin;

create index if not exists audit_events_actor_token_id_idx
  on public.audit_events (actor_token_id);

create policy allowed_email_domains_deny_direct_access
on public.allowed_email_domains
for all
to anon, authenticated
using (false)
with check (false);

drop policy profiles_select_self_or_administrator on public.profiles;

create policy profiles_select_self_or_administrator
on public.profiles
for select
to authenticated
using (
  public.current_app_role() is not null
  and (
    id = (select auth.uid())
    or public.current_app_role() = 'administrator'::public.app_role
  )
);

drop policy processing_attempts_select_owner_or_administrator
  on public.processing_attempts;

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
        and entry.created_by = (select auth.uid())
    )
  )
);

drop policy api_tokens_select_owner_or_administrator on public.api_tokens;

create policy api_tokens_select_owner_or_administrator
on public.api_tokens
for select
to authenticated
using (
  public.current_app_role() is not null
  and (
    user_id = (select auth.uid())
    or public.current_app_role() = 'administrator'::public.app_role
  )
);

commit;
