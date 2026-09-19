begin;

create function private.require_administrator(p_actor_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_actor_user_id
      and profile.is_active
      and profile.role = 'administrator'::public.app_role
  ) then
    raise exception 'ADMINISTRATOR_REQUIRED' using errcode = '42501';
  end if;
end;
$$;

create function public.create_tag(
  p_actor_user_id uuid,
  p_name text,
  p_slug text,
  p_color text
)
returns setof public.tags
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_tag public.tags;
begin
  perform private.require_administrator(p_actor_user_id);

  insert into public.tags (name, slug, color)
  values (btrim(p_name), lower(btrim(p_slug)), btrim(p_color))
  returning * into created_tag;

  insert into public.audit_events (
    actor_user_id,
    event_type,
    target_table,
    target_id,
    payload
  )
  values (
    p_actor_user_id,
    'tag.created',
    'tags',
    created_tag.id,
    jsonb_build_object('slug', created_tag.slug)
  );

  return next created_tag;
end;
$$;

create function public.update_tag(
  p_actor_user_id uuid,
  p_tag_id uuid,
  p_name text,
  p_slug text,
  p_color text,
  p_sort_order integer
)
returns setof public.tags
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_tag public.tags;
begin
  perform private.require_administrator(p_actor_user_id);

  select tag.*
  into updated_tag
  from public.tags as tag
  where tag.id = p_tag_id
  for update;

  if updated_tag.id is null then
    raise exception 'TAG_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.tags as tag
  set name = coalesce(nullif(btrim(p_name), ''), tag.name),
      slug = coalesce(nullif(lower(btrim(p_slug)), ''), tag.slug),
      color = coalesce(nullif(btrim(p_color), ''), tag.color),
      sort_order = coalesce(p_sort_order, tag.sort_order)
  where tag.id = p_tag_id
  returning * into updated_tag;

  insert into public.audit_events (
    actor_user_id,
    event_type,
    target_table,
    target_id,
    payload
  )
  values (
    p_actor_user_id,
    'tag.updated',
    'tags',
    p_tag_id,
    jsonb_build_object(
      'slug', updated_tag.slug,
      'sort_order', updated_tag.sort_order
    )
  );

  return next updated_tag;
end;
$$;

create function public.delete_tag(
  p_actor_user_id uuid,
  p_tag_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_tag public.tags;
begin
  perform private.require_administrator(p_actor_user_id);

  select tag.*
  into deleted_tag
  from public.tags as tag
  where tag.id = p_tag_id
  for update;

  if deleted_tag.id is null then
    raise exception 'TAG_NOT_FOUND' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.entry_tags as entry_tag
    where entry_tag.tag_id = p_tag_id
  ) then
    raise exception 'TAG_IN_USE' using errcode = '23503';
  end if;

  delete from public.tags as tag where tag.id = p_tag_id;

  insert into public.audit_events (
    actor_user_id,
    event_type,
    target_table,
    target_id,
    payload
  )
  values (
    p_actor_user_id,
    'tag.deleted',
    'tags',
    p_tag_id,
    jsonb_build_object('slug', deleted_tag.slug)
  );

  return p_tag_id;
end;
$$;

revoke all on function private.require_administrator(uuid) from public;

commit;
