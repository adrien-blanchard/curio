begin;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger entries_set_updated_at
before update on public.entries
for each row execute function private.set_updated_at();

create trigger tags_set_updated_at
before update on public.tags
for each row execute function private.set_updated_at();

create trigger processing_attempts_set_updated_at
before update on public.processing_attempts
for each row execute function private.set_updated_at();

create trigger api_tokens_set_updated_at
before update on public.api_tokens
for each row execute function private.set_updated_at();

create function private.role_scopes(role_to_check public.app_role)
returns text[]
language sql
immutable
strict
set search_path = ''
as $$
  select case role_to_check
    when 'reader'::public.app_role then
      array['tags:read', 'profile:read']::text[]
    when 'contributor'::public.app_role then
      array['entries:write', 'tags:read', 'profile:read']::text[]
    when 'administrator'::public.app_role then
      array['entries:write', 'tags:read', 'profile:read']::text[]
  end;
$$;

create function private.effective_token_scopes(
  token_scopes text[],
  profile_role public.app_role
)
returns text[]
language sql
immutable
strict
set search_path = ''
as $$
  select coalesce(array_agg(granted.scope order by granted.scope), '{}'::text[])
  from unnest(token_scopes) as granted(scope)
  where granted.scope = any(private.role_scopes(profile_role));
$$;

create function private.email_domain_allowed(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.allowed_email_domains as allowed_domain
    where allowed_domain.domain = split_part(lower(btrim(p_email)), '@', 2)
  );
$$;

create function public.replace_allowed_email_domains(p_domains text[])
returns table (domain text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_domains text[];
  current_domains text[];
  active_administrator_count integer;
begin
  select array_agg(distinct lower(btrim(candidate.domain)) order by lower(btrim(candidate.domain)))
  into normalized_domains
  from unnest(coalesce(p_domains, '{}'::text[])) as candidate(domain);

  if cardinality(coalesce(p_domains, '{}'::text[])) not between 1 and 100
     or cardinality(coalesce(normalized_domains, '{}'::text[]))
        <> cardinality(coalesce(p_domains, '{}'::text[]))
     or exists (
       select 1
       from unnest(coalesce(normalized_domains, '{}'::text[])) as candidate(domain)
       where char_length(candidate.domain) not between 3 and 253
         or position('@' in candidate.domain) > 0
         or position('.' in candidate.domain) = 0
     )
     or exists (
       select 1
       from unnest(coalesce(normalized_domains, '{}'::text[])) as candidate(domain)
       cross join lateral unnest(string_to_array(candidate.domain, '.')) as label(value)
       where char_length(label.value) not between 1 and 63
         or label.value !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
     ) then
    raise exception 'INVALID_ALLOWED_EMAIL_DOMAINS' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('curio:allowed-email-domains', 0)
  );

  select array_agg(allowed_domain.domain order by allowed_domain.domain)
  into current_domains
  from public.allowed_email_domains as allowed_domain;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('curio:last-active-administrator', 0)
  );

  select count(*)::integer
  into active_administrator_count
  from public.profiles as profile
  where profile.role = 'administrator'::public.app_role
    and profile.is_active;

  if active_administrator_count > 0
     and not exists (
       select 1
       from public.profiles as profile
       where profile.role = 'administrator'::public.app_role
         and profile.is_active
         and split_part(profile.email, '@', 2) = any(normalized_domains)
     ) then
    raise exception 'LAST_ADMIN_REQUIRED' using errcode = '23514';
  end if;

  if current_domains is not distinct from normalized_domains then
    return query
    select allowed_domain.domain
    from public.allowed_email_domains as allowed_domain
    order by allowed_domain.domain;
    return;
  end if;

  delete from public.allowed_email_domains;

  insert into public.allowed_email_domains (domain)
  select candidate.domain
  from unnest(normalized_domains) as candidate(domain);

  return query
  select allowed_domain.domain
  from public.allowed_email_domains as allowed_domain
  order by allowed_domain.domain;
end;
$$;

create function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select profile.role
  from public.profiles as profile
  where profile.id = auth.uid()
    and profile.is_active
    and profile.email = lower(btrim(auth.jwt() ->> 'email'))
    and private.email_domain_allowed(profile.email)
    and private.email_domain_allowed(auth.jwt() ->> 'email');
$$;

create function private.sync_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text;
begin
  normalized_email := lower(btrim(new.email));
  if normalized_email is null
     or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' then
    raise exception 'PROFILE_EMAIL_REQUIRED' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.profiles as profile where profile.id = new.id
  ) then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('curio:last-active-administrator', 0)
    );

    if not private.email_domain_allowed(normalized_email) then
      raise exception 'EMAIL_DOMAIN_NOT_ALLOWED' using errcode = '42501';
    end if;
  end if;

  -- The OAuth callback is the only profile creator because it supplies the
  -- deployment's DEFAULT_USER_ROLE. This trigger only follows later email
  -- changes for an already-bootstrapped profile.
  update public.profiles as profile
  set email = normalized_email
  where profile.id = new.id;

  return new;
end;
$$;

create trigger auth_user_profile_sync
after insert or update of email on auth.users
for each row execute function private.sync_auth_user_profile();

create function private.protect_last_administrator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  removes_active_administrator boolean;
  remaining_administrators integer;
begin
  if tg_op = 'DELETE' then
    removes_active_administrator :=
      old.role = 'administrator'::public.app_role and old.is_active;
  else
    removes_active_administrator :=
      old.role = 'administrator'::public.app_role
      and old.is_active
      and (
        new.role <> 'administrator'::public.app_role
        or not new.is_active
      );
  end if;

  if not removes_active_administrator then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('curio:last-active-administrator', 0)
  );

  select count(*)::integer
  into remaining_administrators
  from public.profiles as profile
  where profile.role = 'administrator'::public.app_role
    and profile.is_active
    and profile.id <> old.id;

  if remaining_administrators = 0 then
    raise exception 'LAST_ADMIN_REQUIRED' using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger profiles_protect_last_administrator
before update of role, is_active or delete on public.profiles
for each row execute function private.protect_last_administrator();

create function public.bootstrap_profile(
  p_user_id uuid,
  p_email text,
  p_default_role public.app_role,
  p_is_initial_administrator boolean
)
returns setof public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(p_email));
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('curio:allowed-email-domains', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('curio:last-active-administrator', 0)
  );

  if p_default_role = 'administrator'::public.app_role then
    raise exception 'INVALID_DEFAULT_ROLE' using errcode = '22023';
  end if;

  if not private.email_domain_allowed(normalized_email) then
    raise exception 'EMAIL_DOMAIN_NOT_ALLOWED' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = p_user_id
      and lower(auth_user.email) = normalized_email
  ) then
    raise exception 'AUTH_USER_MISMATCH' using errcode = '42501';
  end if;

  insert into public.profiles (id, email, role, is_active)
  values (
    p_user_id,
    normalized_email,
    case
      when p_is_initial_administrator then 'administrator'::public.app_role
      else p_default_role
    end,
    true
  )
  on conflict (id) do update
    set email = excluded.email;

  return query
  select profile.*
  from public.profiles as profile
  where profile.id = p_user_id;
end;
$$;

create function public.update_profile_role(
  p_actor_user_id uuid,
  p_profile_id uuid,
  p_role public.app_role
)
returns setof public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := p_actor_user_id;
  actor_role public.app_role;
begin
  select profile.role
  into actor_role
  from public.profiles as profile
  where profile.id = actor_id
    and profile.is_active;

  if actor_role is distinct from 'administrator'::public.app_role then
    raise exception 'ADMINISTRATOR_REQUIRED' using errcode = '42501';
  end if;

  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.profiles as profile
  set role = p_role
  where profile.id = p_profile_id;

  insert into public.audit_events (
    actor_user_id,
    event_type,
    target_table,
    target_id,
    payload
  )
  values (
    actor_id,
    'profile.role_updated',
    'profiles',
    p_profile_id,
    jsonb_build_object('role', p_role::text)
  );

  return query
  select profile.*
  from public.profiles as profile
  where profile.id = p_profile_id;
end;
$$;

create function private.resolve_api_token(
  p_token_hash text,
  p_required_scopes text[] default '{}'::text[]
)
returns table (
  token_id uuid,
  user_id uuid,
  email text,
  role public.app_role,
  scopes text[]
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  p_required_scopes := coalesce(p_required_scopes, '{}'::text[]);
  if not p_required_scopes <@
      array['entries:write', 'tags:read', 'profile:read']::text[]
     or not private.text_array_has_unique_values(p_required_scopes) then
    return;
  end if;

  return query
  with resolved as (
    update public.api_tokens as api_token
    set last_used_at = statement_timestamp()
    from public.profiles as profile
    where api_token.token_hash = encode(
        extensions.digest(p_token_hash, 'sha256'),
        'hex'
      )
      and api_token.user_id = profile.id
      and api_token.revoked_at is null
      and (api_token.expires_at is null or api_token.expires_at > statement_timestamp())
      and profile.is_active
      and private.email_domain_allowed(profile.email)
      and api_token.scopes @> p_required_scopes
      and private.role_scopes(profile.role) @> p_required_scopes
    returning
      api_token.id,
      profile.id as profile_id,
      profile.email,
      profile.role,
      api_token.scopes as token_scopes
  )
  select
    resolved.id,
    resolved.profile_id,
    resolved.email,
    resolved.role,
    private.effective_token_scopes(resolved.token_scopes, resolved.role)
  from resolved;
end;
$$;

create function public.authenticate_api_token(
  p_token_hash text,
  p_required_scopes text[] default '{}'::text[]
)
returns table (
  token_id uuid,
  user_id uuid,
  email text,
  role public.app_role,
  scopes text[]
)
language sql
security definer
set search_path = ''
as $$
  select *
  from private.resolve_api_token(p_token_hash, p_required_scopes);
$$;

create function public.get_profile_with_token(p_token_hash text)
returns table (
  user_id uuid,
  email text,
  role public.app_role,
  scopes text[]
)
language sql
security definer
set search_path = ''
as $$
  select identity.user_id, identity.email, identity.role, identity.scopes
  from private.resolve_api_token(
    p_token_hash,
    array['profile:read']::text[]
  ) as identity;
$$;

create function public.get_tags_with_token(p_token_hash text)
returns table (
  id uuid,
  name text,
  slug text,
  color text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from private.resolve_api_token(
      p_token_hash,
      array['tags:read']::text[]
    )
  ) then
    return;
  end if;

  return query
  select tag.id, tag.name, tag.slug, tag.color
  from public.tags as tag
  order by tag.sort_order, tag.name, tag.id;
end;
$$;

create function public.create_api_token(
  p_actor_user_id uuid,
  p_name text,
  p_token_prefix text,
  p_token_hash text,
  p_scopes text[],
  p_expires_at timestamptz default null
)
returns table (
  id uuid,
  name text,
  token_prefix text,
  scopes text[],
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := p_actor_user_id;
  actor_role public.app_role;
  created_token public.api_tokens;
begin
  if auth.uid() is distinct from actor_id then
    raise exception 'ENTRY_FORBIDDEN' using errcode = '42501';
  end if;

  actor_role := public.current_app_role();

  if actor_role is null then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;

  p_name := btrim(p_name);
  if p_name is null or char_length(p_name) not between 1 and 80
     or p_token_prefix !~ '^curio_pat_[A-Za-z0-9_-]{8}$'
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_scopes is null
     or cardinality(p_scopes) not between 1 and 3
     or not private.text_array_has_unique_values(p_scopes)
     or not private.role_scopes(actor_role) @> p_scopes then
    raise exception 'INVALID_TOKEN_CONFIGURATION' using errcode = '22023';
  end if;

  if p_expires_at is not null
     and (
       p_expires_at <= statement_timestamp()
       or p_expires_at > statement_timestamp() + interval '366 days'
     ) then
    raise exception 'INVALID_TOKEN_EXPIRATION' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('curio:api-tokens:' || actor_id::text, 0)
  );

  if (
    select count(*)
    from public.api_tokens as api_token
    where api_token.user_id = actor_id
      and api_token.revoked_at is null
      and (api_token.expires_at is null or api_token.expires_at > statement_timestamp())
  ) >= 10 then
    raise exception 'TOKEN_LIMIT_REACHED' using errcode = '54000';
  end if;

  insert into public.api_tokens (
    user_id,
    name,
    token_prefix,
    token_hash,
    scopes,
    expires_at
  )
  values (
    actor_id,
    p_name,
    p_token_prefix,
    encode(extensions.digest(p_token_hash, 'sha256'), 'hex'),
    p_scopes,
    p_expires_at
  )
  returning * into created_token;

  insert into public.audit_events (
    actor_user_id,
    event_type,
    target_table,
    target_id,
    payload
  )
  values (
    actor_id,
    'api_token.created',
    'api_tokens',
    created_token.id,
    jsonb_build_object('scopes', p_scopes, 'expires_at', p_expires_at)
  );

  return query
  select
    created_token.id,
    created_token.name,
    created_token.token_prefix,
    created_token.scopes,
    created_token.expires_at,
    created_token.last_used_at,
    created_token.revoked_at,
    created_token.created_at;
end;
$$;

create function public.revoke_api_token(
  p_actor_user_id uuid,
  p_token_id uuid
)
returns table (
  id uuid,
  name text,
  token_prefix text,
  scopes text[],
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := p_actor_user_id;
  actor_role public.app_role;
  revoked_token public.api_tokens;
begin
  if auth.uid() is distinct from actor_id then
    raise exception 'ENTRY_FORBIDDEN' using errcode = '42501';
  end if;

  actor_role := public.current_app_role();

  if actor_role is null then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;

  update public.api_tokens as api_token
  set revoked_at = coalesce(api_token.revoked_at, statement_timestamp())
  where api_token.id = p_token_id
    and (
      api_token.user_id = actor_id
      or actor_role = 'administrator'::public.app_role
    )
  returning * into revoked_token;

  if revoked_token.id is null then
    raise exception 'TOKEN_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.audit_events (
    actor_user_id,
    event_type,
    target_table,
    target_id
  )
  values (actor_id, 'api_token.revoked', 'api_tokens', revoked_token.id);

  return query
  select
    revoked_token.id,
    revoked_token.name,
    revoked_token.token_prefix,
    revoked_token.scopes,
    revoked_token.expires_at,
    revoked_token.last_used_at,
    revoked_token.revoked_at,
    revoked_token.created_at;
end;
$$;

revoke all on function private.set_updated_at() from public;
revoke all on function private.role_scopes(public.app_role) from public;
revoke all on function private.effective_token_scopes(text[], public.app_role) from public;
revoke all on function private.email_domain_allowed(text) from public;
revoke all on function private.sync_auth_user_profile() from public;
revoke all on function private.protect_last_administrator() from public;
revoke all on function private.resolve_api_token(text, text[]) from public;

commit;
