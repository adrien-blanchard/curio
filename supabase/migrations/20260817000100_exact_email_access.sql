begin;

create table public.allowed_email_addresses (
  email text primary key,
  created_at timestamptz not null default now(),
  constraint allowed_email_addresses_normalized check (
    email = lower(btrim(email))
    and char_length(email) between 3 and 320
    and char_length(split_part(email, '@', 1)) between 1 and 64
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    and split_part(email, '@', 1) !~ '(^[.]|[.]$|[.][.])'
    and split_part(email, '@', 2) ~ (
      '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
      || '(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
    )
  )
);

alter table public.allowed_email_addresses enable row level security;
alter table public.allowed_email_addresses force row level security;

create policy allowed_email_addresses_deny_direct_access
on public.allowed_email_addresses
for all
to anon, authenticated
using (false)
with check (false);

revoke all on table public.allowed_email_addresses from public, anon, authenticated;
grant all on table public.allowed_email_addresses to service_role;

create or replace function private.email_domain_allowed(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    normalized.email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    and (
      exists (
        select 1
        from public.allowed_email_addresses as allowed_address
        where allowed_address.email = normalized.email
      )
      or exists (
        select 1
        from public.allowed_email_domains as allowed_domain
        where allowed_domain.domain = split_part(normalized.email, '@', 2)
      )
    ),
    false
  )
  from (select lower(btrim(p_email)) as email) as normalized;
$$;

create function public.replace_allowed_email_access(
  p_domains text[],
  p_addresses text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_domains text[];
  normalized_addresses text[];
  current_domains text[];
  current_addresses text[];
  active_administrator_count integer;
begin
  select coalesce(
    array_agg(
      distinct lower(btrim(candidate.domain))
      order by lower(btrim(candidate.domain))
    ),
    '{}'::text[]
  )
  into normalized_domains
  from unnest(coalesce(p_domains, '{}'::text[])) as candidate(domain);

  select coalesce(
    array_agg(
      distinct lower(btrim(candidate.email))
      order by lower(btrim(candidate.email))
    ),
    '{}'::text[]
  )
  into normalized_addresses
  from unnest(coalesce(p_addresses, '{}'::text[])) as candidate(email);

  if cardinality(coalesce(p_domains, '{}'::text[])) > 100
     or exists (
       select 1
       from unnest(normalized_domains) as candidate(domain)
       where candidate.domain is null
         or char_length(candidate.domain) not between 3 and 253
         or position('@' in candidate.domain) > 0
         or position('.' in candidate.domain) = 0
     )
     or exists (
       select 1
       from unnest(normalized_domains) as candidate(domain)
       cross join lateral unnest(string_to_array(candidate.domain, '.')) as label(value)
       where char_length(label.value) not between 1 and 63
         or label.value !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
     ) then
    raise exception 'INVALID_ALLOWED_EMAIL_DOMAINS' using errcode = '22023';
  end if;

  if cardinality(coalesce(p_addresses, '{}'::text[])) > 100
     or exists (
       select 1
       from unnest(normalized_addresses) as candidate(email)
       where candidate.email is null
         or char_length(candidate.email) not between 3 and 320
         or candidate.email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
         or char_length(split_part(candidate.email, '@', 1)) not between 1 and 64
         or split_part(candidate.email, '@', 1) ~ '(^[.]|[.]$|[.][.])'
         or char_length(split_part(candidate.email, '@', 2)) not between 3 and 253
         or position('.' in split_part(candidate.email, '@', 2)) = 0
     )
     or exists (
       select 1
       from unnest(normalized_addresses) as candidate(email)
       cross join lateral unnest(
         string_to_array(split_part(candidate.email, '@', 2), '.')
       ) as label(value)
       where char_length(label.value) not between 1 and 63
         or label.value !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
     ) then
    raise exception 'INVALID_ALLOWED_EMAIL_ADDRESSES' using errcode = '22023';
  end if;

  if cardinality(normalized_domains) + cardinality(normalized_addresses) = 0 then
    raise exception 'INVALID_ALLOWED_EMAIL_ACCESS' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('curio:allowed-email-domains', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('curio:last-active-administrator', 0)
  );

  select coalesce(
    array_agg(allowed_domain.domain order by allowed_domain.domain),
    '{}'::text[]
  )
  into current_domains
  from public.allowed_email_domains as allowed_domain;

  select coalesce(
    array_agg(allowed_address.email order by allowed_address.email),
    '{}'::text[]
  )
  into current_addresses
  from public.allowed_email_addresses as allowed_address;

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
         and (
           profile.email = any(normalized_addresses)
           or split_part(profile.email, '@', 2) = any(normalized_domains)
         )
     ) then
    raise exception 'LAST_ADMIN_REQUIRED' using errcode = '23514';
  end if;

  if current_domains is not distinct from normalized_domains
     and current_addresses is not distinct from normalized_addresses then
    return;
  end if;

  delete from public.allowed_email_domains as allowed_domain
  where allowed_domain.domain is not null;

  delete from public.allowed_email_addresses as allowed_address
  where allowed_address.email is not null;

  insert into public.allowed_email_domains (domain)
  select candidate.domain
  from unnest(normalized_domains) as candidate(domain);

  insert into public.allowed_email_addresses (email)
  select candidate.email
  from unnest(normalized_addresses) as candidate(email);
end;
$$;

create or replace function public.replace_allowed_email_domains(p_domains text[])
returns table (domain text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_domains text[];
  current_addresses text[];
begin
  select array_agg(
    distinct lower(btrim(candidate.domain))
    order by lower(btrim(candidate.domain))
  )
  into normalized_domains
  from unnest(coalesce(p_domains, '{}'::text[])) as candidate(domain);

  if cardinality(coalesce(p_domains, '{}'::text[])) not between 1 and 100
     or cardinality(coalesce(normalized_domains, '{}'::text[]))
        <> cardinality(coalesce(p_domains, '{}'::text[]))
     or exists (
       select 1
       from unnest(coalesce(normalized_domains, '{}'::text[])) as candidate(domain)
       where candidate.domain is null
         or char_length(candidate.domain) not between 3 and 253
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

  select coalesce(
    array_agg(allowed_address.email order by allowed_address.email),
    '{}'::text[]
  )
  into current_addresses
  from public.allowed_email_addresses as allowed_address;

  perform public.replace_allowed_email_access(p_domains, current_addresses);

  return query
  select allowed_domain.domain
  from public.allowed_email_domains as allowed_domain
  order by allowed_domain.domain;
end;
$$;

revoke all on function private.email_domain_allowed(text)
  from public, anon, authenticated;
revoke all on function public.replace_allowed_email_access(text[], text[])
  from public, anon, authenticated;
revoke all on function public.replace_allowed_email_domains(text[])
  from public, anon, authenticated;

grant execute on function public.replace_allowed_email_access(text[], text[])
  to service_role;
grant execute on function public.replace_allowed_email_domains(text[])
  to service_role;

commit;
