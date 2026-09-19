begin;

create or replace function public.replace_allowed_email_domains(p_domains text[])
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

  delete from public.allowed_email_domains
  where domain is not null;

  insert into public.allowed_email_domains (domain)
  select candidate.domain
  from unnest(normalized_domains) as candidate(domain);

  return query
  select allowed_domain.domain
  from public.allowed_email_domains as allowed_domain
  order by allowed_domain.domain;
end;
$$;

commit;
