begin;

-- Separate address-book matches from legacy contacts built from chats and invitations.
create table private.synced_chat_contacts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  contact_id uuid not null references public.profiles(id) on delete cascade,
  primary key (user_id, contact_id)
);
create table private.contact_sync_state (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  synced_at timestamptz not null
);
revoke all on private.synced_chat_contacts, private.contact_sync_state from public, anon, authenticated;

create function private.is_synced_chat_contact(p_user uuid, p_contact uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from private.synced_chat_contacts
    where user_id = p_user and contact_id = p_contact
  );
$$;
revoke execute on function private.is_synced_chat_contact(uuid,uuid) from public, anon, authenticated;

create function public.sync_chat_contacts(p_emails text[], p_phones text[])
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.require_active_user();
  v_count integer;
begin
  if coalesce(cardinality(p_emails), 0) + coalesce(cardinality(p_phones), 0) > 2000 then
    raise exception 'Up to 2,000 contact details can be synced at once' using errcode = '22023';
  end if;
  insert into private.contact_sync_state as s (user_id, synced_at) values (v_user, clock_timestamp())
  on conflict (user_id) do update set synced_at = excluded.synced_at
  where s.synced_at <= clock_timestamp() - interval '10 seconds';
  if not found then
    raise exception 'Wait 10 seconds before syncing again' using errcode = 'PT429';
  end if;

  delete from private.synced_chat_contacts where user_id = v_user;
  insert into private.synced_chat_contacts (user_id, contact_id)
  select v_user, p.id
  from public.profiles p
  join auth.users u on u.id = p.id
  join public.authorized_emails a on a.id = p.authorized_email_id
  where p.id <> v_user and a.status = 'active' and (
    (u.email_confirmed_at is not null and lower(u.email) in (
      select lower(btrim(e)) from unnest(p_emails) e where char_length(e) <= 254
    )) or
    (u.phone_confirmed_at is not null and regexp_replace(u.phone, '^\+', '') in (
      select substring(n from 2) from unnest(p_phones) n where n ~ '^\+[1-9][0-9]{7,14}$'
    ))
  );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.sync_chat_contacts(text[],text[]) from public, anon;
grant execute on function public.sync_chat_contacts(text[],text[]) to authenticated;

create or replace function public.list_directory()
returns table (id uuid, display_name text, email text, avatar_path text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_user();
begin
  return query
    select p.id, p.display_name, p.email, p.avatar_path
    from private.synced_chat_contacts ct
    join public.profiles p on p.id = ct.contact_id
    join public.authorized_emails a on a.id = p.authorized_email_id
    where ct.user_id = v_uid and a.status = 'active'
    order by lower(nullif(p.display_name, '')) nulls last, p.email;
end;
$$;

create or replace function public.get_or_create_direct_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_user();
  v_key text;
  v_id  uuid;
begin
  if p_other_user_id is null or p_other_user_id = v_uid then
    raise exception 'Choose another person to message' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles p
    join public.authorized_emails a on a.id = p.authorized_email_id
    where p.id = p_other_user_id and a.status = 'active'
  ) then
    raise exception 'That person does not have access to this app' using errcode = '42501';
  end if;

  v_key := least(v_uid::text, p_other_user_id::text) || ':' || greatest(v_uid::text, p_other_user_id::text);

  if not private.is_synced_chat_contact(v_uid, p_other_user_id)
     and not exists (select 1 from public.conversations where direct_key = v_key) then
    raise exception 'Sync this person from your contacts to start a chat.' using errcode = '42501';
  end if;

  insert into public.conversations (kind, direct_key, created_by)
  values ('direct', v_key, v_uid)
  on conflict (direct_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.conversations where direct_key = v_key;
  end if;

  insert into public.conversation_members (conversation_id, user_id)
  values (v_id, v_uid), (v_id, p_other_user_id)
  on conflict do nothing;

  perform private.link_contacts(v_uid, p_other_user_id);
  return v_id;
end;
$$;

create or replace function public.create_group(p_title text, p_member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := private.require_active_user();
  v_title   text := btrim(coalesce(p_title, ''));
  v_members uuid[];
  v_id      uuid;
  v_member  uuid;
begin
  if char_length(v_title) not between 1 and 80 then
    raise exception 'Group name must be 1–80 characters' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct m), '{}') into v_members
    from unnest(coalesce(p_member_ids, '{}')) as m where m <> v_uid;
  if cardinality(v_members) < 1 then
    raise exception 'Add at least one other person' using errcode = '22023';
  end if;
  if cardinality(v_members) > 49 then
    raise exception 'Groups can have at most 50 members' using errcode = '22023';
  end if;
  foreach v_member in array v_members loop
    if not private.user_is_active(v_member) then
      raise exception 'Some of these people don''t have access to this app' using errcode = '42501';
    end if;
    if not private.is_synced_chat_contact(v_uid, v_member) then
      raise exception 'You can only add synced contacts to a group' using errcode = '42501';
    end if;
  end loop;

  insert into public.conversations (kind, title, created_by)
  values ('group', v_title, v_uid)
  returning id into v_id;

  insert into public.conversation_members (conversation_id, user_id, is_admin)
  values (v_id, v_uid, true);
  insert into public.conversation_members (conversation_id, user_id)
  select v_id, m from unnest(v_members) as m;

  perform private.post_system_message(v_id, v_uid, jsonb_build_object('type', 'group_created', 'title', v_title));
  return v_id;
end;
$$;

create or replace function public.add_group_members(p_conversation_id uuid, p_user_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_active_user();
  v_member uuid;
begin
  if not private.is_group_admin(p_conversation_id) then
    raise exception 'Only group admins can add people' using errcode = '42501';
  end if;
  if (select count(*) from public.conversation_members
      where conversation_id = p_conversation_id and left_at is null)
     + cardinality(coalesce(p_user_ids, '{}')) > 50 then
    raise exception 'Groups can have at most 50 members' using errcode = '22023';
  end if;

  foreach v_member in array coalesce(p_user_ids, '{}') loop
    if not private.user_is_active(v_member) then
      raise exception 'Some of these people don''t have access to this app' using errcode = '42501';
    end if;
    if exists (select 1 from public.conversation_members
               where conversation_id = p_conversation_id and user_id = v_member and left_at is null) then
      continue;
    end if;
    if not private.is_synced_chat_contact(v_uid, v_member) then
      raise exception 'You can only add synced contacts to a group' using errcode = '42501';
    end if;
    insert into public.conversation_members (conversation_id, user_id)
    values (p_conversation_id, v_member)
    on conflict (conversation_id, user_id) do update
      set left_at = null, is_admin = false, joined_at = now(),
          last_read_at = null, last_delivered_at = null;
    perform private.post_system_message(p_conversation_id, v_uid,
      jsonb_build_object('type', 'member_added', 'user_id', v_member));
  end loop;
end;
$$;

commit;
