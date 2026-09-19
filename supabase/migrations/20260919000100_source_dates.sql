begin;

alter table public.entries
  add column source_published_at date,
  add column source_date_kind text,
  add column source_date_origin text,
  add constraint entries_source_date_kind check (source_date_kind in ('published', 'released', 'uploaded', 'repository_created')),
  add constraint entries_source_date_origin check (source_date_origin in ('ai', 'manual')),
  add constraint entries_source_date_pair check (
    (source_published_at is null and source_date_kind is null) or
    (source_published_at is not null and source_date_kind is not null and source_date_origin is not null and source_published_at >= date '1900-01-01')
  );
comment on column public.entries.source_published_at is 'Explicit source publication/release/upload date. Never inferred from Curio timestamps.';
comment on column public.entries.source_date_origin is 'manual is preserved through analysis and retry, including an explicitly cleared date.';
comment on column public.entries.published_at is 'Internal ready timestamp, NOT the source publication date. Use source_published_at for source age.';

-- Overload the established update RPC: authorization, ownership, state checks and row lock
-- remain in that implementation; both content and source date commit in one transaction.
create function public.update_entry(
  p_actor_user_id uuid, p_entry_id uuid, p_title text, p_tldr text,
  p_source_type public.entry_source_type, p_tag_ids uuid[],
  p_update_source_date boolean, p_source_published_at date, p_source_date_kind text
) returns setof public.entries
language plpgsql security definer set search_path = '' as $$
begin
  perform public.update_entry(p_actor_user_id, p_entry_id, p_title, p_tldr, p_source_type, p_tag_ids);
  if p_update_source_date then
    if (p_source_published_at is null) <> (p_source_date_kind is null)
       or p_source_published_at < date '1900-01-01'
       or p_source_published_at > (statement_timestamp() at time zone 'UTC')::date
       or p_source_date_kind not in ('published', 'released', 'uploaded', 'repository_created') then
      raise exception 'INVALID_SOURCE_DATE' using errcode = '22023';
    end if;
    update public.entries set source_published_at = p_source_published_at,
      source_date_kind = p_source_date_kind, source_date_origin = 'manual'
    where id = p_entry_id;
    insert into public.audit_events(actor_user_id, event_type, target_table, target_id, payload)
      values (p_actor_user_id, 'entry.source_date_updated', 'entries', p_entry_id,
        jsonb_build_object('source_date', p_source_published_at, 'kind', p_source_date_kind));
  end if;
  return query select e.* from public.entries e where e.id = p_entry_id;
end;
$$;

-- Additional arguments keep old workers compatible. The existing finalizer owns locking,
-- timeout fencing, thumbnail selection and idempotency; enrich only the first successful commit.
create function public.finalize_entry_processing(
  p_entry_id uuid, p_attempt_id uuid, p_title text, p_tldr text,
  p_thumbnail_path text, p_thumbnail_origin public.thumbnail_origin, p_tag_ids uuid[],
  p_source_published_at date, p_source_date_kind text
) returns table (id uuid, status public.entry_status, thumbnail_path text,
  thumbnail_origin public.thumbnail_origin, previous_thumbnail_path text, discarded_thumbnail_path text)
language plpgsql security definer set search_path = '' as $$
declare was_succeeded boolean;
begin
  perform 1 from public.entries e where e.id = p_entry_id for update;
  select a.status = 'succeeded' into was_succeeded from public.processing_attempts a
    where a.id = p_attempt_id and a.entry_id = p_entry_id;
  return query select * from public.finalize_entry_processing(
    p_entry_id, p_attempt_id, p_title, p_tldr, p_thumbnail_path, p_thumbnail_origin, p_tag_ids);
  if not coalesce(was_succeeded, false) then
    if (p_source_published_at is null) <> (p_source_date_kind is null)
       or p_source_published_at < date '1900-01-01'
       or p_source_published_at > (statement_timestamp() at time zone 'UTC')::date
       or p_source_date_kind not in ('published', 'released', 'uploaded', 'repository_created') then
      raise exception 'INVALID_SOURCE_DATE' using errcode = '22023';
    end if;
    update public.entries e set source_published_at = p_source_published_at,
      source_date_kind = p_source_date_kind,
      source_date_origin = case when p_source_published_at is null then null else 'ai' end
    where e.id = p_entry_id and e.source_date_origin is distinct from 'manual';
  end if;
end;
$$;

revoke all on function public.update_entry(uuid, uuid, text, text, public.entry_source_type, uuid[], boolean, date, text) from public, anon, authenticated, service_role;
grant execute on function public.update_entry(uuid, uuid, text, text, public.entry_source_type, uuid[], boolean, date, text) to authenticated;
revoke all on function public.finalize_entry_processing(uuid, uuid, text, text, text, public.thumbnail_origin, uuid[], date, text) from public, anon, authenticated, service_role;
grant execute on function public.finalize_entry_processing(uuid, uuid, text, text, text, public.thumbnail_origin, uuid[], date, text) to service_role;
commit;
