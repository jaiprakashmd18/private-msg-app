begin;

create table public.shared_chat_style (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  theme text check (theme in ('midnight-rose', 'moonlight', 'ember')),
  pinned_message_id uuid references public.messages(id) on delete set null
);
alter table public.shared_chat_style enable row level security;
revoke all on public.shared_chat_style from public, anon, authenticated;
grant select on public.shared_chat_style to authenticated;
create policy "Members see shared chat style" on public.shared_chat_style for select to authenticated
  using ((select private.is_active_user()) and private.is_conversation_member(conversation_id));

create function public.set_shared_chat_theme(p_chat uuid, p_theme text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_active_user();
  if not private.is_conversation_member(p_chat)
    or not exists (select 1 from public.conversations where id = p_chat and kind = 'direct') then
    raise exception 'Shared themes are available in your one-to-one chats' using errcode = '42501';
  end if;
  if p_theme is not null and p_theme not in ('midnight-rose', 'moonlight', 'ember') then
    raise exception 'Choose a supported theme' using errcode = '22023';
  end if;
  insert into public.shared_chat_style (conversation_id, theme) values (p_chat, p_theme)
  on conflict (conversation_id) do update set theme = excluded.theme;
end;
$$;

create function public.pin_chat_message(p_chat uuid, p_message uuid, p_pin boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_active_user();
  if not private.is_conversation_member(p_chat) then
    raise exception 'You are not a member of this conversation' using errcode = '42501';
  end if;

  if p_pin then
    if not exists (
      select 1 from public.messages m where m.id = p_message and m.conversation_id = p_chat
        and m.deleted_at is null and m.system_event is null
        and m.created_at > coalesce(private.my_cleared_at(p_chat), '-infinity'::timestamptz)
        and not exists (select 1 from public.attachments a where a.message_id = m.id and a.view_once)
    ) then raise exception 'This message cannot be pinned' using errcode = '42501'; end if;
    insert into public.shared_chat_style (conversation_id, pinned_message_id) values (p_chat, p_message)
    on conflict (conversation_id) do update set pinned_message_id = excluded.pinned_message_id;
  else
    update public.shared_chat_style set pinned_message_id = null
    where conversation_id = p_chat and pinned_message_id = p_message;
  end if;
end;
$$;

create table public.direct_message_requests (
  id uuid primary key default gen_random_uuid(),
  pair_key text not null unique,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  conversation_id uuid references public.conversations(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create index on public.direct_message_requests (recipient_id) where status = 'pending';
create index on public.direct_message_requests (conversation_id) where conversation_id is not null;
alter table public.direct_message_requests enable row level security;
revoke all on public.direct_message_requests from public, anon, authenticated;
grant select on public.direct_message_requests to authenticated;
create policy "Participants see their message requests" on public.direct_message_requests for select to authenticated
  using ((select private.is_active_user()) and (select auth.uid()) in (sender_id, recipient_id));

create function public.request_direct_chat(p_other uuid)
returns table (chat_id uuid, request_status text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.require_active_user();
  v_key text;
  v_chat uuid;
  v_request public.direct_message_requests;
begin
  if p_other is null or p_other = v_user then
    raise exception 'Choose another person to message' using errcode = '22023';
  end if;
  if not private.user_is_active(p_other) then
    raise exception 'That person does not have access to this app' using errcode = '42501';
  end if;
  v_key := least(v_user::text, p_other::text) || ':' || greatest(v_user::text, p_other::text);
  select c.id into v_chat from public.conversations c where c.direct_key = v_key;
  if v_chat is not null and private.is_conversation_member(v_chat) then
    return query select v_chat, 'accepted'::text;
    return;
  end if;

  if not private.is_synced_chat_contact(v_user, p_other) then
    raise exception 'Sync this person from your contacts to send a request' using errcode = '42501';
  end if;

  insert into public.direct_message_requests (pair_key, sender_id, recipient_id)
  values (v_key, v_user, p_other) on conflict (pair_key) do nothing;

  select * into v_request from public.direct_message_requests where pair_key = v_key;
  return query select v_request.conversation_id,
    case when v_request.status = 'pending' and v_request.recipient_id = v_user then 'incoming' else v_request.status end;
end;
$$;

create function public.incoming_direct_requests()
returns table (id uuid, sender_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare v_user uuid := private.require_active_user();
begin
  return query select r.id, coalesce(nullif(p.display_name, ''), p.email), r.created_at
  from public.direct_message_requests r join public.profiles p on p.id = r.sender_id
  where r.recipient_id = v_user and r.status = 'pending' and private.user_is_active(r.sender_id)
  order by r.created_at desc;
end;
$$;

create function public.respond_to_direct_request(p_request uuid, p_accept boolean)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.require_active_user();
  v_request public.direct_message_requests;
  v_chat uuid;
begin
  select * into v_request from public.direct_message_requests
  where id = p_request and recipient_id = v_user for update;
  if not found then raise exception 'Request unavailable' using errcode = '42501'; end if;
  if v_request.status <> 'pending' then return v_request.conversation_id; end if;
  if not coalesce(p_accept, false) then
    update public.direct_message_requests set status = 'declined' where id = p_request;
    return null;
  end if;
  if not private.user_is_active(v_request.sender_id)
    or not private.is_synced_chat_contact(v_request.sender_id, v_user) then
    raise exception 'The sender is no longer eligible to start this chat' using errcode = '42501';
  end if;

  insert into public.conversations (kind, direct_key, created_by)
  values ('direct', v_request.pair_key, v_user)
  on conflict (direct_key) do nothing returning id into v_chat;
  if v_chat is null then
    select id into v_chat from public.conversations where direct_key = v_request.pair_key;
  end if;
  insert into public.conversation_members (conversation_id, user_id)
  values (v_chat, v_user), (v_chat, v_request.sender_id) on conflict do nothing;
  perform private.link_contacts(v_user, v_request.sender_id);
  update public.direct_message_requests set status = 'accepted', conversation_id = v_chat where id = p_request;
  return v_chat;
end;
$$;

-- Older clients can open existing DMs, but cannot create a DM without consent.
create or replace function public.get_or_create_direct_conversation(p_other_user_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.require_active_user();
  v_chat uuid;
begin
  if p_other_user_id is null or p_other_user_id = v_user then
    raise exception 'Choose another person to message' using errcode = '22023';
  end if;
  select id into v_chat from public.conversations
  where direct_key = least(v_user::text, p_other_user_id::text) || ':' || greatest(v_user::text, p_other_user_id::text);
  if v_chat is null or not private.is_conversation_member(v_chat) then
    raise exception 'Send a message request from New chat and wait for it to be accepted' using errcode = '42501';
  end if;
  return v_chat;
end;
$$;

revoke execute on function public.set_shared_chat_theme(uuid,text), public.pin_chat_message(uuid,uuid,boolean),
  public.request_direct_chat(uuid), public.incoming_direct_requests(), public.respond_to_direct_request(uuid,boolean)
  from public, anon;
grant execute on function public.set_shared_chat_theme(uuid,text), public.pin_chat_message(uuid,uuid,boolean),
  public.request_direct_chat(uuid), public.incoming_direct_requests(), public.respond_to_direct_request(uuid,boolean)
  to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.shared_chat_style, public.direct_message_requests;
  end if;
end $$;

create or replace function public.list_conversations()
returns table (
  id                            uuid,
  kind                          text,
  title                         text,
  avatar_path                   text,
  created_at                    timestamptz,
  member_count                  integer,
  is_group_admin                boolean,
  other_user_id                 uuid,
  other_display_name            text,
  other_email                   text,
  other_avatar_path             text,
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
      c.avatar_path,
      c.created_at,
      (select count(*)::integer from public.conversation_members x
         where x.conversation_id = c.id and x.left_at is null),
      me.is_admin,
      o.user_id,
      op.display_name,
      op.email,
      op.avatar_path,
      case when o.user_id is null then false else private.user_is_active(o.user_id) end,
      op.last_seen_at,
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
                when at.mime_type like 'video/%' then 'video'
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
        and m.created_at > coalesce(me.cleared_at, '-infinity'::timestamptz)
      order by m.created_at desc, m.id desc
      limit 1
    ) lm on true
    left join public.profiles sp on sp.id = lm.sender_id
    where me.user_id = v_uid
      and me.left_at is null
      and (lm.id is not null or (me.cleared_at is null and (c.created_by = v_uid or c.kind = 'group'
        or exists (select 1 from public.direct_message_requests r
          where r.conversation_id = c.id and r.status = 'accepted'))))
    order by coalesce(c.last_message_at, c.created_at) desc;
end;
$$;

commit;
