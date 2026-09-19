begin;

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function private.text_array_has_unique_values(values_to_check text[])
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select cardinality(values_to_check) = count(distinct item.value)::integer
  from unnest(values_to_check) as item(value);
$$;

revoke all on function private.text_array_has_unique_values(text[]) from public;

create type public.app_role as enum (
  'reader',
  'contributor',
  'administrator'
);

create type public.entry_source_type as enum (
  'opensource',
  'proprietary'
);

create type public.entry_status as enum (
  'queued',
  'analyzing',
  'finalizing',
  'ready',
  'failed'
);

create type public.processing_attempt_status as enum (
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role public.app_role not null default 'contributor',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_normalized check (
    email = lower(btrim(email))
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
  )
);

create unique index profiles_email_unique_ci_idx
  on public.profiles (lower(email));
create index profiles_active_role_idx
  on public.profiles (role)
  where is_active;

create table public.allowed_email_domains (
  domain text primary key,
  created_at timestamptz not null default now(),
  constraint allowed_email_domains_normalized check (
    domain = lower(btrim(domain))
    and char_length(domain) between 3 and 253
    and domain ~ (
      '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
      || '(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
    )
  )
);

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  canonical_url text not null,
  title text,
  tldr text,
  source_type public.entry_source_type not null default 'opensource',
  status public.entry_status not null default 'queued',
  error_code text,
  error_message text,
  dispatch_lease_until timestamptz,
  thumbnail_path text,
  created_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_document tsvector generated always as (
    to_tsvector(
      'simple'::regconfig,
      coalesce(title, '') || ' ' || coalesce(tldr, '')
    )
  ) stored,
  constraint entries_url_length check (
    char_length(url) between 1 and 4096
    and char_length(canonical_url) between 1 and 4096
  ),
  constraint entries_http_urls check (
    url ~* '^https?://'
    and canonical_url ~* '^https?://'
  ),
  constraint entries_title_length check (
    title is null or char_length(title) between 1 and 300
  ),
  constraint entries_tldr_length check (
    tldr is null or char_length(tldr) between 1 and 5000
  ),
  constraint entries_error_code_length check (
    error_code is null or char_length(error_code) between 1 and 100
  ),
  constraint entries_error_message_length check (
    error_message is null or char_length(error_message) between 1 and 1000
  ),
  constraint entries_thumbnail_path_safe check (
    thumbnail_path is null
    or (
      char_length(thumbnail_path) between 1 and 1024
      and thumbnail_path !~ '(^|/)\.\.(/|$)'
      and thumbnail_path !~ '^/'
    )
  ),
  constraint entries_thumbnail_belongs_to_entry check (
    thumbnail_path is null
    or split_part(thumbnail_path, '/', 1) = id::text
  ),
  constraint entries_ready_shape check (
    status <> 'ready'
    or (
      title is not null
      and tldr is not null
      and published_at is not null
      and error_code is null
      and error_message is null
    )
  ),
  constraint entries_failed_shape check (
    status <> 'failed'
    or (error_code is not null and error_message is not null)
  )
);

create unique index entries_canonical_url_unique_idx
  on public.entries (canonical_url);
create index entries_status_created_idx
  on public.entries (status, created_at desc, id desc);
create index entries_queued_dispatch_lease_idx
  on public.entries (dispatch_lease_until, id)
  where status = 'queued';
create index entries_created_by_created_idx
  on public.entries (created_by, created_at desc, id desc);
create index entries_source_ready_idx
  on public.entries (source_type, published_at desc, id desc)
  where status = 'ready';
create index entries_search_document_idx
  on public.entries using gin (search_document);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  color text not null default '#64748b',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tags_name_length check (char_length(name) between 1 and 80),
  constraint tags_slug_format check (
    slug = lower(slug)
    and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    and char_length(slug) <= 80
  ),
  constraint tags_color_format check (color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint tags_sort_order_nonnegative check (sort_order >= 0)
);

create unique index tags_name_unique_ci_idx on public.tags (lower(name));
create unique index tags_slug_unique_idx on public.tags (slug);
create index tags_order_idx on public.tags (sort_order, name, id);

create table public.entry_tags (
  entry_id uuid not null references public.entries(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (entry_id, tag_id)
);

create index entry_tags_tag_entry_idx
  on public.entry_tags (tag_id, entry_id);

create table public.processing_attempts (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries(id) on delete cascade,
  workflow_run_id text not null,
  attempt integer not null,
  status public.processing_attempt_status not null default 'queued',
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_message text,
  retryable boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint processing_attempts_workflow_run_length check (
    char_length(workflow_run_id) between 1 and 255
  ),
  constraint processing_attempts_attempt_positive check (attempt > 0),
  constraint processing_attempts_error_code_length check (
    error_code is null or char_length(error_code) between 1 and 100
  ),
  constraint processing_attempts_error_message_length check (
    error_message is null or char_length(error_message) between 1 and 1000
  ),
  constraint processing_attempts_metadata_object check (
    jsonb_typeof(metadata) = 'object'
  ),
  constraint processing_attempts_finished_shape check (
    status not in ('succeeded', 'failed', 'cancelled')
    or finished_at is not null
  ),
  constraint processing_attempts_failed_shape check (
    status <> 'failed'
    or (error_code is not null and error_message is not null)
  ),
  unique (entry_id, attempt),
  unique (workflow_run_id)
);

create index processing_attempts_entry_created_idx
  on public.processing_attempts (entry_id, created_at desc);
create index processing_attempts_status_created_idx
  on public.processing_attempts (status, created_at)
  where status in ('queued', 'running');

create table public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  token_prefix text not null,
  token_hash text not null,
  scopes text[] not null,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint api_tokens_name_length check (char_length(name) between 1 and 80),
  constraint api_tokens_prefix_format check (
    token_prefix ~ '^curio_pat_[A-Za-z0-9_-]{8}$'
  ),
  constraint api_tokens_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint api_tokens_scopes_allowed check (
    cardinality(scopes) between 1 and 3
    and scopes <@ array['entries:write', 'tags:read', 'profile:read']::text[]
  ),
  constraint api_tokens_scopes_unique check (
    private.text_array_has_unique_values(scopes)
  ),
  constraint api_tokens_expiration_after_creation check (
    expires_at is null or expires_at > created_at
  )
);

create unique index api_tokens_hash_unique_idx on public.api_tokens (token_hash);
create index api_tokens_user_created_idx
  on public.api_tokens (user_id, created_at desc);
create index api_tokens_active_hash_idx
  on public.api_tokens (token_hash)
  where revoked_at is null;

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_token_id uuid references public.api_tokens(id) on delete set null,
  event_type text not null,
  target_table text,
  target_id uuid,
  request_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_event_type_format check (
    event_type ~ '^[a-z][a-z0-9_.-]{1,99}$'
  ),
  constraint audit_events_target_table_format check (
    target_table is null or target_table ~ '^[a-z][a-z0-9_]{0,62}$'
  ),
  constraint audit_events_request_id_length check (
    request_id is null or char_length(request_id) <= 255
  ),
  constraint audit_events_payload_object check (jsonb_typeof(payload) = 'object')
);

create index audit_events_created_idx on public.audit_events (created_at desc, id desc);
create index audit_events_actor_idx
  on public.audit_events (actor_user_id, created_at desc, id desc);
create index audit_events_target_idx
  on public.audit_events (target_table, target_id, created_at desc, id desc);

comment on column public.api_tokens.token_hash is
  'SHA-256 verifier of the server-side HMAC digest. Neither raw token nor API-supplied digest is stored.';
comment on column public.entries.thumbnail_path is
  'Private object path in the thumbnails storage bucket; never a public URL.';
comment on column public.entries.search_document is
  'Generated full-text search vector for title and TL;DR.';

commit;
