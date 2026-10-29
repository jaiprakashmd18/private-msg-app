-- =============================================================================
-- 0800 — Group chats, replies, reactions, photo thumbnails, voice notes,
--        typing indicators and online status.
--
-- Security model is unchanged: every read is RLS-checked (active user AND
-- current member), every write goes through a SECURITY DEFINER RPC.
-- Group members are removed with `left_at` (soft) rather than DELETE, so
-- realtime never broadcasts unfiltered DELETE events for memberships.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schema
-- -----------------------------------------------------------------------------
alter table public.conversations drop constraint conversations_kind_check;
alter table public.conversations
  add constraint conversations_kind_check check (kind in ('direct', 'group')),
  add column title text check (title is null or char_length(title) between 1 and 80),
  add constraint conversations_group_title check (kind <> 'group' or title is not null);

alter table public.conversation_members
  add column is_admin boolean not null default false,
  add column left_at  timestamptz;

create index conversation_members_current_idx
  on public.conversation_members (conversation_id) where left_at is null;

alter table public.messages
  add column reply_to_id  uuid,
  add column system_event jsonb,
  add constraint messages_reply_to_id_fkey
    foreign key (reply_to_id) references public.messages (id) on delete set null;

create index messages_reply_to_idx on public.messages (reply_to_id) where reply_to_id is not null;

alter table public.attachments
  add column thumb_path  text unique,
  add column width       integer check (width is null or width between 1 and 20000),
  add column height      integer check (height is null or height between 1 and 20000),
  add column duration_ms integer check (duration_ms is null or duration_ms between 0 and 3600000);

-- One reaction per person per message. "Removing" a reaction sets emoji to
-- NULL (an UPDATE, which realtime filters by RLS) instead of deleting.
create table public.message_reactions (
  message_id       uuid not null references public.messages (id) on delete cascade,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  emoji            text check (emoji is null or char_length(emoji) between 1 and 16),
  updated_at       timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index message_reactions_conversation_idx on public.message_reactions (conversation_id);

revoke all on table public.message_reactions from anon, authenticated;
grant select on table public.message_reactions to authenticated;
alter table public.message_reactions enable row level security;

create policy "members read reactions"
  on public.message_reactions for select to authenticated
  using ((select private.is_active_user()) and private.is_conversation_member(conversation_id));

-- -----------------------------------------------------------------------------
-- Membership now means "current" membership.
-- -----------------------------------------------------------------------------
create or replace function private.is_conversation_member(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id = p_conversation_id
      and m.user_id = (select auth.uid())
      and m.left_at is null
  );
$$;

create or replace function private.is_group_admin(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members m
    join public.conversations c on c.id = m.conversation_id and c.kind = 'group'
    where m.conversation_id = p_conversation_id
      and m.user_id = (select auth.uid())
      and m.left_at is null
      and m.is_admin
  );
$$;

revoke all on function private.is_group_admin(uuid) from public, anon;
grant execute on function private.is_group_admin(uuid) to authenticated;

-- Helper: active member of the app (by user id).
create or replace function private.user_is_active(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    join public.authorized_emails a on a.id = p.authorized_email_id
    where p.id = p_user_id and a.status = 'active'
  );
$$;

-- Helper: posts a system message ("Alex added Sam") into a conversation.
create or replace function private.post_system_message(p_conversation_id uuid, p_actor uuid, p_event jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  insert into public.messages (conversation_id, sender_id, client_id, body, system_event)
  values (p_conversation_id, p_actor, gen_random_uuid(), '', p_event)
  returning created_at into v_at;
  update public.conversations set last_message_at = v_at where id = p_conversation_id;
end;
$$;

revoke all on function private.user_is_active(uuid), private.post_system_message(uuid, uuid, jsonb)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Sending (now with replies, thumbnails, sizes and voice-note durations)
-- -----------------------------------------------------------------------------
drop function public.send_message(uuid, uuid, text, jsonb);

create or replace function public.send_message(
  p_conversation_id uuid,
  p_client_id       uuid,
  p_body            text,
  p_attachments     jsonb default '[]'::jsonb,
  p_reply_to        uuid default null
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := private.require_active_user();
  v_body      text := btrim(coalesce(p_body, ''), E' \t\r\n');
  v_atts      jsonb := coalesce(p_attachments, '[]'::jsonb);
  v_att_count integer;
  v_kind      text;
  v_msg       public.messages;
  v_item      jsonb;
  v_path      text;
  v_thumb     text;
  v_meta      jsonb;
  v_size      bigint;

  v_int_re  constant text := '^[0-9]{1,8}$';
begin
  if p_client_id is null then
    raise exception 'client_id is required' using errcode = '22023';
  end if;
  if jsonb_typeof(v_atts) <> 'array' then
    raise exception 'attachments must be an array' using errcode = '22023';
  end if;
  v_att_count := jsonb_array_length(v_atts);

  if not private.is_conversation_member(p_conversation_id) then
    raise exception 'You are not a member of this conversation' using errcode = '42501';
  end if;

  -- Idempotency: a retried request returns the message already stored.
  select * into v_msg from public.messages
    where sender_id = v_uid and client_id = p_client_id;
  if found then
    if v_msg.conversation_id <> p_conversation_id then
      raise exception 'client_id already used' using errcode = '23505';
    end if;
    return v_msg;
  end if;

  select kind into v_kind from public.conversations where id = p_conversation_id;
  if v_kind = 'direct' and (
    exists (
      select 1 from public.conversation_members m
      where m.conversation_id = p_conversation_id and m.user_id <> v_uid
        and not private.user_is_active(m.user_id)
    ) or not exists (
      select 1 from public.conversation_members m
      where m.conversation_id = p_conversation_id and m.user_id <> v_uid
    )
  ) then
    raise exception 'The other participant no longer has access' using errcode = '42501';
  end if;

  if char_length(v_body) > 4000 then
    raise exception 'Message is too long (max 4000 characters)' using errcode = '22001';
  end if;
  if v_body = '' and v_att_count = 0 then
    raise exception 'Message is empty' using errcode = '22023';
  end if;
  if v_att_count > 10 then
    raise exception 'At most 10 attachments per message' using errcode = '22023';
  end if;
  if v_att_count > 0 and not (select attachments_enabled from public.app_settings) then
    raise exception 'Attachments are disabled by the administrator' using errcode = '42501';
  end if;
  if p_reply_to is not null and not exists (
    select 1 from public.messages r
    where r.id = p_reply_to and r.conversation_id = p_conversation_id and r.system_event is null
  ) then
    raise exception 'The message you are replying to is not in this conversation' using errcode = '22023';
  end if;

  -- Flood protection: max 15 messages per 10 seconds per sender.
  if (
    select count(*) from public.messages
    where sender_id = v_uid and created_at > now() - interval '10 seconds'
  ) >= 15 then
    raise exception 'You are sending messages too quickly' using errcode = 'PT429';
  end if;

  insert into public.messages (conversation_id, sender_id, client_id, body, reply_to_id)
  values (p_conversation_id, v_uid, p_client_id, v_body, p_reply_to)
  on conflict on constraint messages_sender_client_unique do nothing
  returning * into v_msg;

  if v_msg.id is null then
    select * into v_msg from public.messages
      where sender_id = v_uid and client_id = p_client_id;
    return v_msg;
  end if;

  for v_item in select value from jsonb_array_elements(v_atts) loop
    v_path := v_item ->> 'path';
    v_thumb := nullif(v_item ->> 'thumb_path', '');
    if v_path is null
       or split_part(v_path, '/', 1) <> p_conversation_id::text
       or split_part(v_path, '/', 2) <> v_uid::text
       or split_part(v_path, '/', 3) = '' then
      raise exception 'Invalid attachment path' using errcode = '22023';
    end if;
    if v_thumb is not null and (
         split_part(v_thumb, '/', 1) <> p_conversation_id::text
      or split_part(v_thumb, '/', 2) <> v_uid::text
      or split_part(v_thumb, '/', 3) = ''
      or not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'attachments' and o.name = v_thumb and o.owner_id = v_uid::text
      )
    ) then
      raise exception 'Invalid thumbnail' using errcode = '22023';
    end if;

    -- Size and type come from Storage's own metadata, not from the client.
    select o.metadata into v_meta
      from storage.objects o
      where o.bucket_id = 'attachments'
        and o.name = v_path
        and o.owner_id = v_uid::text;
    if not found then
      raise exception 'Attachment upload not found' using errcode = '22023';
    end if;

    v_size := nullif(v_meta ->> 'size', '')::bigint;
    if v_size is null or v_size <= 0 or v_size > 10485760 then
      raise exception 'Attachment exceeds the 10 MB limit' using errcode = '22023';
    end if;

    insert into public.attachments
      (message_id, conversation_id, uploader_id, storage_path, thumb_path, file_name, mime_type, size_bytes,
       width, height, duration_ms)
    values (
      v_msg.id, p_conversation_id, v_uid, v_path, v_thumb,
      left(coalesce(nullif(btrim(v_item ->> 'name'), ''), 'file'), 200),
      left(coalesce(v_meta ->> 'mimetype', 'application/octet-stream'), 120),
      v_size,
      case when v_item ->> 'width' ~ v_int_re then least((v_item ->> 'width')::integer, 20000) end,
      case when v_item ->> 'height' ~ v_int_re then least((v_item ->> 'height')::integer, 20000) end,
      case when v_item ->> 'duration_ms' ~ v_int_re then least((v_item ->> 'duration_ms')::integer, 3600000) end
    );
  end loop;

  update public.conversations
    set last_message_at = v_msg.created_at
    where id = p_conversation_id;

  update public.conversation_members
    set last_read_at = greatest(coalesce(last_read_at, '-infinity'::timestamptz), v_msg.created_at),
        last_delivered_at = greatest(coalesce(last_delivered_at, '-infinity'::timestamptz), v_msg.created_at)
    where conversation_id = p_conversation_id and user_id = v_uid;

  return v_msg;
end;
$$;

revoke execute on function public.send_message(uuid, uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.send_message(uuid, uuid, text, jsonb, uuid) to authenticated;

-- System messages can't be edited or deleted by anyone.
create or replace function public.edit_message(p_message_id uuid, p_body text)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_active_user();
  v_body   text := btrim(coalesce(p_body, ''), E' \t\r\n');
  v_msg    public.messages;
  v_window integer;
begin
  select * into v_msg from public.messages where id = p_message_id for update;
  if not found or v_msg.sender_id is distinct from v_uid or v_msg.system_event is not null
     or not private.is_conversation_member(v_msg.conversation_id) then
    raise exception 'Message not found' using errcode = '42501';
  end if;
  if v_msg.deleted_at is not null then
    raise exception 'Deleted messages cannot be edited' using errcode = '22023';
  end if;

  select edit_window_minutes into v_window from public.app_settings;
  if v_window = 0 or now() - v_msg.created_at > make_interval(mins => v_window) then
    raise exception 'This message can no longer be edited' using errcode = '22023';
  end if;

  if char_length(v_body) > 4000 then
    raise exception 'Message is too long (max 4000 characters)' using errcode = '22001';
  end if;
  if v_body = '' and not exists (select 1 from public.attachments where message_id = v_msg.id) then
    raise exception 'Message is empty' using errcode = '22023';
  end if;
  if v_body = v_msg.body then
    return v_msg;
  end if;

  update public.messages
    set body = v_body, edited_at = now()
    where id = v_msg.id
    returning * into v_msg;
  return v_msg;
end;
$$;

create or replace function public.delete_message(p_message_id uuid)
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_user();
  v_msg public.messages;
begin
  select * into v_msg from public.messages where id = p_message_id for update;
  if not found or v_msg.sender_id is distinct from v_uid or v_msg.system_event is not null
     or not private.is_conversation_member(v_msg.conversation_id) then
    raise exception 'Message not found' using errcode = '42501';
  end if;
  if v_msg.deleted_at is not null then
    return;
  end if;

  update public.messages
    set body = '', deleted_at = now()
    where id = v_msg.id;

  update public.message_reactions set emoji = null, updated_at = now()
    where message_id = v_msg.id and emoji is not null;

  return query
    with removed as (
      delete from public.attachments where message_id = v_msg.id
      returning storage_path, thumb_path
    )
    select storage_path from removed
    union all
    select thumb_path from removed where thumb_path is not null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reactions
-- -----------------------------------------------------------------------------
create or replace function public.toggle_reaction(p_message_id uuid, p_emoji text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := private.require_active_user();
  v_msg     public.messages;
  v_emoji   text := nullif(btrim(coalesce(p_emoji, '')), '');
  v_current text;
begin
  select * into v_msg from public.messages where id = p_message_id;
  if not found or not private.is_conversation_member(v_msg.conversation_id) then
    raise exception 'Message not found' using errcode = '42501';
  end if;
  if v_msg.deleted_at is not null or v_msg.system_event is not null then
    raise exception 'You can''t react to this message' using errcode = '22023';
  end if;
  if v_emoji is not null and char_length(v_emoji) > 16 then
    raise exception 'Invalid reaction' using errcode = '22023';
  end if;

  select emoji into v_current from public.message_reactions
    where message_id = p_message_id and user_id = v_uid;
  if v_current is not distinct from v_emoji then
    v_emoji := null; -- tapping your current reaction removes it
  end if;

  insert into public.message_reactions (message_id, conversation_id, user_id, emoji)
  values (p_message_id, v_msg.conversation_id, v_uid, v_emoji)
  on conflict (message_id, user_id) do update
    set emoji = excluded.emoji, updated_at = now();
  return v_emoji;
end;
$$;

-- -----------------------------------------------------------------------------
-- Online / last seen
-- -----------------------------------------------------------------------------
create or replace function public.heartbeat()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_user();
begin
  update public.profiles set last_seen_at = now()
    where id = v_uid and (last_seen_at is null or last_seen_at < now() - interval '30 seconds');
end;
$$;

-- -----------------------------------------------------------------------------
-- Groups
-- -----------------------------------------------------------------------------
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

-- Removing someone else needs group-admin rights; anyone may remove themselves (leave).
create or replace function public.remove_group_member(p_conversation_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_user();
  v_next uuid;
begin
  if not exists (select 1 from public.conversations where id = p_conversation_id and kind = 'group') then
    raise exception 'Not a group' using errcode = '22023';
  end if;
  if p_user_id <> v_uid and not private.is_group_admin(p_conversation_id) then
    raise exception 'Only group admins can remove people' using errcode = '42501';
  end if;
  if p_user_id = v_uid and not private.is_conversation_member(p_conversation_id) then
    raise exception 'You are not a member of this group' using errcode = '42501';
  end if;

  update public.conversation_members
    set left_at = now(), is_admin = false
    where conversation_id = p_conversation_id and user_id = p_user_id and left_at is null;
  if not found then
    return;
  end if;

  perform private.post_system_message(p_conversation_id, v_uid, jsonb_build_object(
    'type', case when p_user_id = v_uid then 'member_left' else 'member_removed' end,
    'user_id', p_user_id));

  -- A group always keeps an admin: promote the longest-standing member.
  if not exists (select 1 from public.conversation_members
                 where conversation_id = p_conversation_id and left_at is null and is_admin) then
    select user_id into v_next from public.conversation_members
      where conversation_id = p_conversation_id and left_at is null
      order by joined_at limit 1;
    if v_next is not null then
      update public.conversation_members set is_admin = true
        where conversation_id = p_conversation_id and user_id = v_next;
    end if;
  end if;
end;
$$;

create or replace function public.rename_group(p_conversation_id uuid, p_title text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_active_user();
  v_title text := btrim(coalesce(p_title, ''));
begin
  if not private.is_group_admin(p_conversation_id) then
    raise exception 'Only group admins can rename the group' using errcode = '42501';
  end if;
  if char_length(v_title) not between 1 and 80 then
    raise exception 'Group name must be 1–80 characters' using errcode = '22023';
  end if;
  update public.conversations set title = v_title where id = p_conversation_id and title is distinct from v_title;
  if found then
    perform private.post_system_message(p_conversation_id, v_uid,
      jsonb_build_object('type', 'renamed', 'title', v_title));
  end if;
end;
$$;

create or replace function public.set_group_admin(p_conversation_id uuid, p_user_id uuid, p_is_admin boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_user();
begin
  if not private.is_group_admin(p_conversation_id) then
    raise exception 'Only group admins can change admins' using errcode = '42501';
  end if;
  if p_user_id = v_uid and not p_is_admin and not exists (
    select 1 from public.conversation_members
    where conversation_id = p_conversation_id and left_at is null and is_admin and user_id <> v_uid
  ) then
    raise exception 'A group needs at least one admin' using errcode = '22023';
  end if;
  update public.conversation_members set is_admin = coalesce(p_is_admin, false)
    where conversation_id = p_conversation_id and user_id = p_user_id and left_at is null;
  if not found then
    raise exception 'That person is not in this group' using errcode = 'P0002';
  end if;
end;
$$;

-- Members of a conversation, for the header, group info and names in the
-- history. Includes former members (left_at set) so old messages and
-- "X removed Y" notes keep showing the right names.
create or replace function public.list_conversation_members(p_conversation_id uuid)
returns table (
  user_id       uuid,
  display_name  text,
  email         text,
  is_admin      boolean,
  is_active     boolean,
  last_seen_at  timestamptz,
  joined_at     timestamptz,
  left_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_active_user();
  if not private.is_conversation_member(p_conversation_id) then
    raise exception 'You are not a member of this conversation' using errcode = '42501';
  end if;
  return query
    select p.id, p.display_name, p.email, m.is_admin, private.user_is_active(p.id), p.last_seen_at, m.joined_at, m.left_at
    from public.conversation_members m
    join public.profiles p on p.id = m.user_id
    where m.conversation_id = p_conversation_id
    order by (m.left_at is null) desc, m.is_admin desc, lower(nullif(p.display_name, '')) nulls last, p.email;
end;
$$;

-- -----------------------------------------------------------------------------
-- Inbox (direct + group)
-- -----------------------------------------------------------------------------
drop function public.list_conversations();

create or replace function public.list_conversations()
returns table (
  id                            uuid,
  kind                          text,
  title                         text,
  created_at                    timestamptz,
  member_count                  integer,
  is_group_admin                boolean,
  other_user_id                 uuid,
  other_display_name            text,
  other_email                   text,
  other_is_active               boolean,
  other_last_seen_at            timestamptz,
  other_last_read_at            timestamptz,
  other_last_delivered_at       timestamptz,
  my_last_read_at               timestamptz,
  last_message_id               uuid,
  last_message_body             text,
  last_message_sender_id        uuid,
  last_message_sender_name      text,
  last_message_created_at       timestamptz,
  last_message_deleted          boolean,
  last_message_has_attachments  boolean,
  last_message_attachment_kind  text,
  last_message_system_event     jsonb,
  unread_count                  integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_user();
begin
  return query
    select
      c.id,
      c.kind,
      c.title,
      c.created_at,
      (select count(*)::integer from public.conversation_members x
         where x.conversation_id = c.id and x.left_at is null),
      me.is_admin,
      o.user_id,
      op.display_name,
      op.email,
      case when o.user_id is null then false else private.user_is_active(o.user_id) end,
      op.last_seen_at,
      -- "Read"/"delivered" for my messages = the minimum over everyone else.
      nullif((select min(coalesce(x.last_read_at, '-infinity'::timestamptz)) from public.conversation_members x
               where x.conversation_id = c.id and x.user_id <> v_uid and x.left_at is null), '-infinity'::timestamptz),
      nullif((select min(coalesce(x.last_delivered_at, '-infinity'::timestamptz)) from public.conversation_members x
               where x.conversation_id = c.id and x.user_id <> v_uid and x.left_at is null), '-infinity'::timestamptz),
      me.last_read_at,
      lm.id,
      case when lm.deleted_at is null then left(lm.body, 200) else '' end,
      lm.sender_id,
      coalesce(nullif(sp.display_name, ''), sp.email),
      lm.created_at,
      lm.deleted_at is not null,
      coalesce(exists (select 1 from public.attachments at where at.message_id = lm.id), false),
      (select case
                when at.mime_type like 'image/%' then 'image'
                when at.mime_type like 'audio/%' then 'audio'
                else 'file' end
         from public.attachments at where at.message_id = lm.id order by at.created_at limit 1),
      lm.system_event,
      (
        select count(*)::integer from public.messages m2
        where m2.conversation_id = c.id
          and m2.sender_id is distinct from v_uid
          and m2.deleted_at is null
          and m2.system_event is null
          and m2.created_at > coalesce(me.last_read_at, '-infinity'::timestamptz)
      )
    from public.conversation_members me
    join public.conversations c on c.id = me.conversation_id
    left join public.conversation_members o
      on c.kind = 'direct' and o.conversation_id = c.id and o.user_id <> v_uid
    left join public.profiles op on op.id = o.user_id
    left join lateral (
      select m.* from public.messages m
      where m.conversation_id = c.id
      order by m.created_at desc, m.id desc
      limit 1
    ) lm on true
    left join public.profiles sp on sp.id = lm.sender_id
    where me.user_id = v_uid
      and me.left_at is null
      and (lm.id is not null or c.created_by = v_uid or c.kind = 'group')
    order by coalesce(c.last_message_at, c.created_at) desc;
end;
$$;

revoke execute on function public.list_conversations() from public, anon;
grant execute on function public.list_conversations() to authenticated;

-- Search only in conversations the caller is CURRENTLY in.
create or replace function public.search_messages(p_query text, p_limit integer default 30)
returns table (
  message_id       uuid,
  conversation_id  uuid,
  sender_id        uuid,
  body             text,
  created_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_user();
  v_q   text := btrim(coalesce(p_query, ''));
  v_tsq text;
begin
  if char_length(v_q) > 100 then
    raise exception 'Search query is too long' using errcode = '22001';
  end if;

  select string_agg(t || ':*', ' & ')
    into v_tsq
    from regexp_split_to_table(lower(v_q), '[^[:alnum:]]+') as t
    where t <> '';

  if v_tsq is null then
    return;
  end if;

  return query
    select m.id, m.conversation_id, m.sender_id, left(m.body, 300), m.created_at
    from public.messages m
    join public.conversation_members cm
      on cm.conversation_id = m.conversation_id and cm.user_id = v_uid and cm.left_at is null
    where m.deleted_at is null
      and m.search_vector @@ to_tsquery('simple', v_tsq)
    order by m.created_at desc
    limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

-- -----------------------------------------------------------------------------
-- Push notifications: group-aware, never for system messages or former members.
-- -----------------------------------------------------------------------------
drop function public.server_push_targets(uuid, uuid);

create or replace function public.server_push_targets(p_message_id uuid, p_sender uuid)
returns table (
  endpoint            text,
  p256dh              text,
  auth                text,
  show_preview        boolean,
  conversation_id     uuid,
  conversation_kind   text,
  conversation_title  text,
  sender_name         text,
  body                text,
  has_attachments     boolean,
  attachment_kind     text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg public.messages;
begin
  delete from private.push_sent where created_at < now() - interval '2 days';

  select * into v_msg from public.messages m
    where m.id = p_message_id
      and m.sender_id = p_sender
      and m.deleted_at is null
      and m.system_event is null
      and m.created_at > now() - interval '10 minutes';
  if not found or not private.user_is_active(p_sender) then
    return;
  end if;

  insert into private.push_sent (message_id) values (p_message_id)
  on conflict do nothing;
  if not found then
    return; -- already notified
  end if;

  return query
    select s.endpoint, s.p256dh, s.auth, s.show_preview, v_msg.conversation_id, c.kind, c.title,
           coalesce(nullif(sp.display_name, ''), sp.email),
           left(v_msg.body, 200),
           exists (select 1 from public.attachments at where at.message_id = v_msg.id),
           (select case
                     when at.mime_type like 'image/%' then 'image'
                     when at.mime_type like 'audio/%' then 'audio'
                     else 'file' end
              from public.attachments at where at.message_id = v_msg.id order by at.created_at limit 1)
    from public.conversation_members cm
    join public.conversations c on c.id = cm.conversation_id
    join public.push_subscriptions s on s.user_id = cm.user_id
    join public.profiles sp on sp.id = p_sender
    where cm.conversation_id = v_msg.conversation_id
      and cm.user_id <> p_sender
      and cm.left_at is null
      and private.user_is_active(cm.user_id);
end;
$$;

revoke execute on function public.server_push_targets(uuid, uuid) from public, anon, authenticated;
grant execute on function public.server_push_targets(uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Admin conversation list: groups + current members only
-- -----------------------------------------------------------------------------
drop function public.admin_list_conversations();

create or replace function public.admin_list_conversations()
returns table (
  id                uuid,
  kind              text,
  title             text,
  created_at        timestamptz,
  last_message_at   timestamptz,
  message_count     bigint,
  attachment_count  bigint,
  members           jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
    select
      c.id, c.kind, c.title, c.created_at, c.last_message_at,
      (select count(*) from public.messages m
         where m.conversation_id = c.id and m.deleted_at is null and m.system_event is null),
      (select count(*) from public.attachments a where a.conversation_id = c.id),
      coalesce((
        select jsonb_agg(jsonb_build_object(
                 'user_id', p.id,
                 'display_name', p.display_name,
                 'email', p.email) order by p.email)
        from public.conversation_members cm
        join public.profiles p on p.id = cm.user_id
        where cm.conversation_id = c.id and cm.left_at is null
      ), '[]'::jsonb)
    from public.conversations c
    order by coalesce(c.last_message_at, c.created_at) desc;
end;
$$;

revoke execute on function public.admin_list_conversations() from public, anon, authenticated;
grant execute on function public.admin_list_conversations() to authenticated;

-- -----------------------------------------------------------------------------
-- Retention: thumbnails are part of their attachment, not orphans.
-- -----------------------------------------------------------------------------
create or replace function private.run_retention_purge(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.app_settings;
  v_paths    text[];
  v_messages integer := 0;
  v_audit    integer := 0;
begin
  select * into v_settings from public.app_settings;

  if v_settings.message_retention_days is not null then
    select coalesce(array_agg(p), '{}') into v_paths
      from (
        select a.storage_path as p from public.attachments a
        join public.messages m on m.id = a.message_id
        where m.created_at < now() - make_interval(days => v_settings.message_retention_days)
        union all
        select a.thumb_path from public.attachments a
        join public.messages m on m.id = a.message_id
        where a.thumb_path is not null
          and m.created_at < now() - make_interval(days => v_settings.message_retention_days)
      ) paths;

    with deleted as (
      delete from public.messages
      where created_at < now() - make_interval(days => v_settings.message_retention_days)
      returning 1
    ) select count(*) into v_messages from deleted;
  else
    v_paths := '{}';
  end if;

  -- Orphaned uploads: files whose message was deleted or never sent.
  v_paths := v_paths || coalesce((
    select array_agg(o.name) from (
      select o2.name from storage.objects o2
      where o2.bucket_id = 'attachments'
        and o2.created_at < now() - interval '24 hours'
        and not exists (
          select 1 from public.attachments a
          where a.storage_path = o2.name or a.thumb_path = o2.name
        )
      limit 1000
    ) o
  ), '{}');

  with deleted as (
    delete from public.audit_logs
    where created_at < now() - make_interval(days => v_settings.audit_retention_days)
    returning 1
  ) select count(*) into v_audit from deleted;

  perform private.write_audit(p_actor, 'system.retention_purge', null, null,
    jsonb_build_object('messages_deleted', v_messages, 'audit_deleted', v_audit,
                       'files_to_remove', coalesce(array_length(v_paths, 1), 0)));

  return jsonb_build_object(
    'messages_deleted', v_messages,
    'audit_deleted', v_audit,
    'storage_paths', to_jsonb(v_paths)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Storage: thumbnails readable like their attachment; voice-note formats.
-- -----------------------------------------------------------------------------
drop policy "attachments: members read" on storage.objects;
create policy "attachments: members read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and (select private.is_active_user())
    and private.is_conversation_member(private.try_uuid(split_part(name, '/', 1)))
    and (
      exists (
        select 1 from public.attachments a
        where a.storage_path = objects.name or a.thumb_path = objects.name
      )
      or split_part(name, '/', 2) = (select auth.uid())::text
    )
  );

update storage.buckets
  set allowed_mime_types = array[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic',
    'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/x-m4a', 'audio/wav',
    'application/pdf', 'text/plain',
    'application/zip',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
  where id = 'attachments';

-- -----------------------------------------------------------------------------
-- Realtime
--  * Postgres Changes for reactions (RLS-filtered per subscriber).
--  * Private Broadcast/Presence channels for typing ("conv:<id>") and online
--    status ("online"): only active members may join. Requires clients to use
--    { config: { private: true } }.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.message_reactions;
  end if;

  if to_regclass('realtime.messages') is not null then
    execute $p$
      create policy "members join chat channels"
        on realtime.messages for select to authenticated
        using (
          (select private.is_active_user())
          and (
            realtime.topic() = 'online'
            or (realtime.topic() like 'conv:%'
                and private.is_conversation_member(private.try_uuid(substr(realtime.topic(), 6))))
          )
        )
    $p$;
    execute $p$
      create policy "members send on chat channels"
        on realtime.messages for insert to authenticated
        with check (
          (select private.is_active_user())
          and (
            realtime.topic() = 'online'
            or (realtime.topic() like 'conv:%'
                and private.is_conversation_member(private.try_uuid(substr(realtime.topic(), 6))))
          )
        )
    $p$;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants for new client RPCs
-- -----------------------------------------------------------------------------
revoke execute on function
  public.toggle_reaction(uuid, text),
  public.heartbeat(),
  public.create_group(text, uuid[]),
  public.add_group_members(uuid, uuid[]),
  public.remove_group_member(uuid, uuid),
  public.rename_group(uuid, text),
  public.set_group_admin(uuid, uuid, boolean),
  public.list_conversation_members(uuid)
from public, anon;

grant execute on function
  public.toggle_reaction(uuid, text),
  public.heartbeat(),
  public.create_group(text, uuid[]),
  public.add_group_members(uuid, uuid[]),
  public.remove_group_member(uuid, uuid),
  public.rename_group(uuid, text),
  public.set_group_admin(uuid, uuid, boolean),
  public.list_conversation_members(uuid)
to authenticated;
