-- =============================================================================
-- UPDATE: contacts, members invite their own people, "Delete chat" for me.
--
-- Run ONCE on a project that was set up before this update, AFTER the
-- earlier update files (… update_native_push.sql) if you haven't run those
-- yet. New projects don't need it (setup_all.sql has everything).
-- Paste into Supabase → SQL Editor → New query → Run.
-- =============================================================================

-- =============================================================================
-- 1500 — Contacts, members invite their own people, "Delete chat" for me
--
-- * Contacts: each person sees only their own contacts — people they invited,
--   people who invited them, and people they have a one-to-one chat with.
--   (Group members still see each other inside the group.) The administrator
--   still manages everyone in Admin.
-- * Invites: any active member can invite an email address. The person can
--   sign in straight away (Google) — no administrator approval. Emails the
--   administrator disabled cannot be invited again by members.
-- * Delete chat (for me): hides the chat and its history for that person only.
--   The other person keeps everything; a new message brings the chat back,
--   starting empty.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table public.contacts (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  contact_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, contact_id),
  check (user_id <> contact_id)
);

create index contacts_contact_idx on public.contacts (contact_id);

create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  inviter_id  uuid not null references public.profiles (id) on delete cascade,
  email       text not null
                check (char_length(email) <= 254 and email = lower(email)
                       and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at  timestamptz not null default now(),
  unique (inviter_id, email)
);

create index invitations_email_idx on public.invitations (email);

revoke all on table public.contacts, public.invitations from anon, authenticated;
grant select on table public.contacts, public.invitations to authenticated;
alter table public.contacts enable row level security;
alter table public.invitations enable row level security;

create policy "users read own contacts"
  on public.contacts for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_user()));

create policy "users read own invitations"
  on public.invitations for select to authenticated
  using (inviter_id = (select auth.uid()) and (select private.is_active_user()));

alter table public.conversation_members add column cleared_at timestamptz;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
create or replace function private.link_contacts(p_a uuid, p_b uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.contacts (user_id, contact_id)
  select x, y from (values (p_a, p_b), (p_b, p_a)) as v(x, y)
  where p_a is not null and p_b is not null and p_a <> p_b
  on conflict do nothing;
$$;

create or replace function private.are_contacts(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.contacts where user_id = p_a and contact_id = p_b);
$$;

-- Whose profile (name, photo, email) the signed-in person may read: their own,
-- their contacts, anyone they share a chat with (incl. groups), or everyone
-- for the administrator.
create or replace function private.can_see_profile(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_id = (select auth.uid())
    or private.is_admin()
    or private.are_contacts((select auth.uid()), p_id)
    or exists (
      select 1
      from public.conversation_members mine
      join public.conversation_members theirs
        on theirs.conversation_id = mine.conversation_id and theirs.user_id = p_id
      where mine.user_id = (select auth.uid())
    );
$$;

-- When the signed-in person deleted (cleared) a chat; messages up to then are hidden from them.
create or replace function private.my_cleared_at(p_conversation_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select m.cleared_at from public.conversation_members m
  where m.conversation_id = p_conversation_id and m.user_id = (select auth.uid()) and m.left_at is null;
$$;

revoke execute on function private.link_contacts(uuid, uuid), private.are_contacts(uuid, uuid),
  private.can_see_profile(uuid), private.my_cleared_at(uuid) from public, anon;
grant execute on function private.can_see_profile(uuid), private.my_cleared_at(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Existing people keep their connections: whoever added them, and everyone
-- they already have a one-to-one chat with.
-- -----------------------------------------------------------------------------
insert into public.invitations (inviter_id, email)
select a.added_by, a.email
from public.authorized_emails a
join public.profiles inviter on inviter.id = a.added_by
on conflict do nothing;

insert into public.contacts (user_id, contact_id)
select x, y from (
  select p.id as x, a.added_by as y
  from public.profiles p
  join public.authorized_emails a on a.id = p.authorized_email_id
  join public.profiles inviter on inviter.id = a.added_by
  union
  select a.added_by, p.id
  from public.profiles p
  join public.authorized_emails a on a.id = p.authorized_email_id
  join public.profiles inviter on inviter.id = a.added_by
  union
  select m1.user_id, m2.user_id
  from public.conversations c
  join public.conversation_members m1 on m1.conversation_id = c.id
  join public.conversation_members m2 on m2.conversation_id = c.id and m2.user_id <> m1.user_id
  where c.kind = 'direct'
) pairs
where x <> y
on conflict do nothing;

-- A new account is connected to everyone who invited that email.
create or replace function private.link_invited_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.link_contacts(new.id, i.inviter_id)
    from public.invitations i
    where i.email = lower(new.email);
  perform private.link_contacts(new.id, a.added_by)
    from public.authorized_emails a
    join public.profiles inviter on inviter.id = a.added_by
    where a.id = new.authorized_email_id;
  return new;
end;
$$;

revoke execute on function private.link_invited_profile() from public, anon, authenticated;

create trigger profiles_link_invited
  after insert on public.profiles
  for each row execute function private.link_invited_profile();

-- -----------------------------------------------------------------------------
-- Who can see whom
-- -----------------------------------------------------------------------------
drop policy "active users read profiles" on public.profiles;
create policy "people read their contacts' profiles"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or ((select private.is_active_user()) and private.can_see_profile(id))
  );

-- "New conversation" list: my contacts only.
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
    from public.contacts ct
    join public.profiles p on p.id = ct.contact_id
    join public.authorized_emails a on a.id = p.authorized_email_id
    where ct.user_id = v_uid and a.status = 'active'
    order by lower(nullif(p.display_name, '')) nulls last, p.email;
end;
$$;

-- -----------------------------------------------------------------------------
-- Invites
-- -----------------------------------------------------------------------------
create or replace function public.invite_contact(p_email text, p_name text default null)
returns table (status text, user_id uuid, display_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := private.require_active_user();
  v_email   text := private.normalize_email(p_email);
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_entry   public.authorized_emails;
  v_profile public.profiles;
begin
  if v_email is null or char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address, e.g. name@gmail.com' using errcode = '22023';
  end if;
  if v_name is not null and char_length(v_name) > 80 then
    raise exception 'Name is too long (max 80 characters)' using errcode = '22001';
  end if;
  if v_email = (select lower(p.email) from public.profiles p where p.id = v_uid) then
    raise exception 'That''s your own email' using errcode = '22023';
  end if;
  if (select count(*) from public.invitations i
      where i.inviter_id = v_uid and i.created_at > now() - interval '1 day') >= 20 then
    raise exception 'You can invite up to 20 people a day. Try again tomorrow.' using errcode = 'PT429';
  end if;

  select * into v_entry from public.authorized_emails a where a.email = v_email for update;
  if found and v_entry.status <> 'active' then
    raise exception 'This person can''t be invited. Ask the administrator.' using errcode = '42501';
  end if;
  if not found then
    insert into public.authorized_emails (email, label, role, status, added_by)
    values (v_email, v_name, 'member', 'active', v_uid)
    returning * into v_entry;
    -- Someone who already asked to join (Google sign-in) is now welcome.
    update public.access_requests r
      set status = 'accepted', decided_by = v_uid, decided_at = now()
      where r.email = v_email and r.status = 'pending';
  end if;

  insert into public.invitations (inviter_id, email) values (v_uid, v_email)
  on conflict (inviter_id, email) do nothing;

  select * into v_profile from public.profiles p where p.authorized_email_id = v_entry.id;
  if v_profile.id is not null then
    perform private.link_contacts(v_uid, v_profile.id);
  end if;

  perform private.write_audit(v_uid, 'member.invited', 'authorized_email', v_entry.id::text,
    jsonb_build_object('email', private.mask_email(v_email), 'already_member', v_profile.id is not null));

  return query select
    case when v_profile.id is null then 'invited' else 'connected' end,
    v_profile.id,
    coalesce(nullif(v_profile.display_name, ''), v_profile.email);
end;
$$;

-- My invites that haven't been used yet.
create or replace function public.list_my_invitations()
returns table (email text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_user();
begin
  return query
    select i.email, i.created_at
    from public.invitations i
    where i.inviter_id = v_uid
      and not exists (select 1 from public.profiles p where lower(p.email) = i.email)
    order by i.created_at desc;
end;
$$;

-- Withdraws my invite. If nobody else invited them and they never signed in,
-- the email loses access again.
create or replace function public.cancel_invitation(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_active_user();
  v_email text := private.normalize_email(p_email);
begin
  delete from public.invitations i where i.inviter_id = v_uid and i.email = v_email;
  if not found then
    raise exception 'Invite not found' using errcode = 'P0002';
  end if;
  delete from public.authorized_emails a
    where a.email = v_email
      and a.added_by = v_uid
      and a.role = 'member'
      and not exists (select 1 from public.profiles p where p.authorized_email_id = a.id)
      and not exists (select 1 from public.invitations i where i.email = v_email);
  perform private.write_audit(v_uid, 'member.invite_cancelled', 'authorized_email', null,
    jsonb_build_object('email', private.mask_email(v_email)));
end;
$$;

-- -----------------------------------------------------------------------------
-- Starting chats: only with contacts (the administrator can reach anyone).
-- -----------------------------------------------------------------------------
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

  if not private.are_contacts(v_uid, p_other_user_id)
     and not private.is_admin()
     and not exists (select 1 from public.conversations where direct_key = v_key) then
    raise exception 'You can only message your contacts. Invite them first.' using errcode = '42501';
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
    if not private.are_contacts(v_uid, v_member) and not private.is_admin() then
      raise exception 'You can only add your contacts to a group' using errcode = '42501';
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
    if not private.are_contacts(v_uid, v_member) and not private.is_admin() then
      raise exception 'You can only add your contacts to a group' using errcode = '42501';
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

-- -----------------------------------------------------------------------------
-- Delete chat (for me)
-- -----------------------------------------------------------------------------
create or replace function public.delete_chat_for_me(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_user();
begin
  update public.conversation_members
    set cleared_at = clock_timestamp(),
        last_read_at = greatest(coalesce(last_read_at, '-infinity'::timestamptz), clock_timestamp())
    where conversation_id = p_conversation_id and user_id = v_uid and left_at is null;
  if not found then
    raise exception 'You are not a member of this conversation' using errcode = '42501';
  end if;
end;
$$;

drop policy "members read messages" on public.messages;
create policy "members read messages"
  on public.messages for select to authenticated
  using (
    (select private.is_active_user())
    and private.is_conversation_member(conversation_id)
    and created_at > coalesce(private.my_cleared_at(conversation_id), '-infinity'::timestamptz)
  );

drop policy "members read attachments" on public.attachments;
create policy "members read attachments"
  on public.attachments for select to authenticated
  using (
    (select private.is_active_user())
    and private.is_conversation_member(conversation_id)
    and created_at > coalesce(private.my_cleared_at(conversation_id), '-infinity'::timestamptz)
  );

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
      and m.created_at > coalesce(cm.cleared_at, '-infinity'::timestamptz)
      and m.search_vector @@ to_tsquery('simple', v_tsq)
    order by m.created_at desc
    limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

-- Inbox: a deleted chat stays hidden until a newer message arrives.
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
      and (lm.id is not null or (me.cleared_at is null and (c.created_by = v_uid or c.kind = 'group')))
    order by coalesce(c.last_message_at, c.created_at) desc;
end;
$$;

revoke execute on function public.invite_contact(text, text), public.list_my_invitations(),
  public.cancel_invitation(text), public.delete_chat_for_me(uuid) from public, anon;
grant execute on function public.invite_contact(text, text), public.list_my_invitations(),
  public.cancel_invitation(text), public.delete_chat_for_me(uuid) to authenticated;
