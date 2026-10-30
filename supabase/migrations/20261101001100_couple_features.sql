-- =============================================================================
-- 1100 — Features for two: view-once photos, chat wallpaper & colours,
-- "thinking of you" taps, special dates with reminders, love notes for later
-- (scheduled messages) and a shared list. (The app lock is on the device only.)
--
-- Timed work (delivering love notes, date reminders) runs every minute with
-- pg_cron when available. It also runs whenever a member has the app open
-- (deliver_due_items), so nothing is lost without pg_cron. Notifications for
-- that timed work reach the app's /api/push/hook through pg_net, using a URL
-- and secret the app registers itself (server_register_app).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Columns
-- -----------------------------------------------------------------------------
alter table public.attachments
  add column view_once  boolean not null default false,
  add column viewed_at  timestamptz,
  add column viewed_by  uuid references public.profiles (id) on delete set null;

alter table public.conversation_members
  add column wallpaper_path text check (wallpaper_path is null or char_length(wallpaper_path) <= 300),
  add column bubble_color   text check (bubble_color is null or bubble_color in
                                        ('blue', 'rose', 'purple', 'green', 'orange', 'teal', 'graphite'));

-- Messages delivered by the scheduler (love notes, date reminders).
alter table public.messages
  add column was_scheduled boolean not null default false;

-- -----------------------------------------------------------------------------
-- Special dates (shared by the members of a conversation)
-- -----------------------------------------------------------------------------
create table public.special_dates (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references public.conversations (id) on delete cascade,
  created_by        uuid references public.profiles (id) on delete set null,
  kind              text not null check (kind in ('together', 'birthday', 'anniversary', 'other')),
  title             text not null check (char_length(title) between 1 and 60),
  on_date           date not null check (on_date between date '1900-01-01' and date '2200-12-31'),
  yearly            boolean not null default true,
  remind            boolean not null default true,
  tz                text not null default 'UTC' check (char_length(tz) <= 64),
  last_reminded_on  date,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index special_dates_conversation_idx on public.special_dates (conversation_id) where deleted_at is null;
create unique index special_dates_one_together_idx
  on public.special_dates (conversation_id) where kind = 'together' and deleted_at is null;

create trigger special_dates_updated_at
  before update on public.special_dates
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Love notes for later (only the author can see them until they're delivered)
-- -----------------------------------------------------------------------------
create table public.scheduled_messages (
  id                    uuid primary key default gen_random_uuid(),
  conversation_id       uuid not null references public.conversations (id) on delete cascade,
  sender_id             uuid not null references public.profiles (id) on delete cascade,
  body                  text not null check (char_length(body) between 1 and 4000),
  send_at               timestamptz not null,
  delivered_message_id  uuid references public.messages (id) on delete set null,
  delivered_at          timestamptz,
  canceled_at           timestamptz,
  created_at            timestamptz not null default now()
);

create index scheduled_messages_due_idx
  on public.scheduled_messages (send_at) where delivered_at is null and canceled_at is null;
create index scheduled_messages_sender_idx on public.scheduled_messages (sender_id, conversation_id);

-- -----------------------------------------------------------------------------
-- Shared list
-- -----------------------------------------------------------------------------
create table public.shared_list_items (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  created_by       uuid references public.profiles (id) on delete set null,
  text             text not null check (char_length(text) between 1 and 200),
  done             boolean not null default false,
  done_by          uuid references public.profiles (id) on delete set null,
  done_at          timestamptz,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index shared_list_items_conversation_idx
  on public.shared_list_items (conversation_id, created_at) where deleted_at is null;

create trigger shared_list_items_updated_at
  before update on public.shared_list_items
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Where the app lives, for notifications about timed work (private schema).
-- -----------------------------------------------------------------------------
create table private.app_hook (
  id          boolean primary key default true check (id),
  url         text not null,
  secret      text not null,
  updated_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Privileges and RLS. Reads only; every write goes through the RPCs below.
-- Deletions are soft (deleted_at) so Realtime never broadcasts unfiltered
-- DELETE events.
-- -----------------------------------------------------------------------------
revoke all on table public.special_dates, public.scheduled_messages, public.shared_list_items
  from anon, authenticated;
grant select on table public.special_dates, public.scheduled_messages, public.shared_list_items
  to authenticated;

alter table public.special_dates enable row level security;
alter table public.scheduled_messages enable row level security;
alter table public.shared_list_items enable row level security;

create policy "members read special dates"
  on public.special_dates for select to authenticated
  using ((select private.is_active_user()) and private.is_conversation_member(conversation_id));

create policy "authors read their scheduled messages"
  on public.scheduled_messages for select to authenticated
  using (
    sender_id = (select auth.uid())
    and (select private.is_active_user())
    and private.is_conversation_member(conversation_id)
  );

create policy "members read the shared list"
  on public.shared_list_items for select to authenticated
  using ((select private.is_active_user()) and private.is_conversation_member(conversation_id));

-- -----------------------------------------------------------------------------
-- Sending: adds view-once photos (direct chats, one photo, no caption, no
-- thumbnail — so nothing of it can be seen before it is opened).
-- -----------------------------------------------------------------------------
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
  v_view_once boolean := false;

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

  v_view_once := exists (
    select 1 from jsonb_array_elements(v_atts) e
    where jsonb_typeof(e -> 'view_once') = 'boolean' and (e ->> 'view_once')::boolean
  );
  if v_view_once and (v_kind <> 'direct' or v_att_count <> 1 or v_body <> '' or p_reply_to is not null) then
    raise exception 'A view-once photo is sent on its own in a one-to-one chat' using errcode = '22023';
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
    if v_view_once and v_thumb is not null then
      raise exception 'View-once photos have no thumbnail' using errcode = '22023';
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
    if v_view_once and coalesce(v_meta ->> 'mimetype', '') not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif') then
      raise exception 'Only photos can be sent as view-once' using errcode = '22023';
    end if;

    insert into public.attachments
      (message_id, conversation_id, uploader_id, storage_path, thumb_path, file_name, mime_type, size_bytes,
       width, height, duration_ms, view_once)
    values (
      v_msg.id, p_conversation_id, v_uid, v_path, v_thumb,
      left(coalesce(nullif(btrim(v_item ->> 'name'), ''), 'file'), 200),
      left(coalesce(v_meta ->> 'mimetype', 'application/octet-stream'), 120),
      v_size,
      case when v_item ->> 'width' ~ v_int_re then least((v_item ->> 'width')::integer, 20000) end,
      case when v_item ->> 'height' ~ v_int_re then least((v_item ->> 'height')::integer, 20000) end,
      case when v_item ->> 'duration_ms' ~ v_int_re then least((v_item ->> 'duration_ms')::integer, 3600000) end,
      v_view_once
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

-- -----------------------------------------------------------------------------
-- View-once: the recipient opens it once. The file is readable by them for
-- one minute after opening (long enough to load it), never by anyone else,
-- and is then deleted (/api/view-once/[id], with the retention job as backup).
-- -----------------------------------------------------------------------------
create or replace function public.open_view_once(p_attachment_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_user();
  v_att public.attachments;
begin
  select * into v_att from public.attachments a where a.id = p_attachment_id for update;
  if not found or not v_att.view_once or not private.is_conversation_member(v_att.conversation_id) then
    raise exception 'Photo not found' using errcode = 'P0002';
  end if;
  if v_att.uploader_id = v_uid then
    raise exception 'Only the person you sent it to can open a view-once photo' using errcode = '42501';
  end if;
  if v_att.viewed_at is not null
     and not (v_att.viewed_by = v_uid and v_att.viewed_at > now() - interval '1 minute') then
    raise exception 'This photo was already opened' using errcode = '22023';
  end if;
  if v_att.viewed_at is null then
    update public.attachments set viewed_at = now(), viewed_by = v_uid where id = v_att.id;
  end if;
  return v_att.storage_path;
end;
$$;

-- Server (service role): path of a view-once photo the user has opened, so the
-- file can be deleted right after they close it.
create or replace function public.server_view_once_opened_path(p_attachment_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.storage_path from public.attachments a
  where a.id = p_attachment_id and a.view_once and a.viewed_by = p_user_id and a.viewed_at is not null;
$$;

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
        where (a.storage_path = objects.name or a.thumb_path = objects.name)
          and (
            not a.view_once
            or (a.viewed_by = (select auth.uid()) and a.viewed_at > now() - interval '1 minute')
          )
      )
      or (
        split_part(name, '/', 2) = (select auth.uid())::text
        and not exists (select 1 from public.attachments a where a.storage_path = objects.name)
      )
    )
  );

-- -----------------------------------------------------------------------------
-- Chat wallpaper & bubble colour (each member chooses their own).
-- -----------------------------------------------------------------------------
create or replace function public.get_chat_appearance(p_conversation_id uuid)
returns table (wallpaper_path text, bubble_color text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.wallpaper_path, m.bubble_color
  from public.conversation_members m
  where m.conversation_id = p_conversation_id
    and m.user_id = (select auth.uid())
    and m.left_at is null
    and private.is_active_user();
$$;

create or replace function public.set_chat_appearance(p_conversation_id uuid, p_wallpaper_path text, p_bubble_color text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_active_user();
  v_path text := nullif(btrim(coalesce(p_wallpaper_path, '')), '');
begin
  if not private.is_conversation_member(p_conversation_id) then
    raise exception 'You are not a member of this conversation' using errcode = '42501';
  end if;
  if v_path is not null and (
       split_part(v_path, '/', 1) <> 'users'
    or split_part(v_path, '/', 2) <> v_uid::text
    or not exists (select 1 from storage.objects o where o.bucket_id = 'avatars' and o.name = v_path)
  ) then
    raise exception 'Invalid wallpaper' using errcode = '22023';
  end if;
  if p_bubble_color is not null
     and p_bubble_color not in ('blue', 'rose', 'purple', 'green', 'orange', 'teal', 'graphite') then
    raise exception 'Unknown colour' using errcode = '22023';
  end if;
  update public.conversation_members
    set wallpaper_path = v_path, bubble_color = p_bubble_color
    where conversation_id = p_conversation_id and user_id = v_uid;
end;
$$;

-- -----------------------------------------------------------------------------
-- "Thinking of you": a heart that makes the other phone buzz.
-- -----------------------------------------------------------------------------
create or replace function public.send_nudge(p_conversation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_user();
  v_id  uuid;
  v_at  timestamptz;
begin
  if not private.is_conversation_member(p_conversation_id) then
    raise exception 'You are not a member of this conversation' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.conversation_members m
    where m.conversation_id = p_conversation_id and m.user_id <> v_uid and m.left_at is null
      and not private.user_is_active(m.user_id)
  ) then
    raise exception 'The other participant no longer has access' using errcode = '42501';
  end if;
  if (select count(*) from public.messages
      where sender_id = v_uid and system_event ->> 'type' = 'nudge' and created_at > now() - interval '10 seconds') >= 3
     or (select count(*) from public.messages
      where sender_id = v_uid and system_event ->> 'type' = 'nudge' and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'That''s a lot of love! Try again in a moment.' using errcode = 'PT429';
  end if;

  insert into public.messages (conversation_id, sender_id, client_id, body, system_event)
  values (p_conversation_id, v_uid, gen_random_uuid(), '', jsonb_build_object('type', 'nudge'))
  returning id, created_at into v_id, v_at;
  update public.conversations set last_message_at = v_at where id = p_conversation_id;
  update public.conversation_members
    set last_read_at = greatest(coalesce(last_read_at, '-infinity'::timestamptz), v_at),
        last_delivered_at = greatest(coalesce(last_delivered_at, '-infinity'::timestamptz), v_at)
    where conversation_id = p_conversation_id and user_id = v_uid;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Special dates
-- -----------------------------------------------------------------------------
create or replace function public.save_special_date(
  p_id              uuid,
  p_conversation_id uuid,
  p_kind            text,
  p_title           text,
  p_on_date         date,
  p_yearly          boolean default true,
  p_remind          boolean default true,
  p_tz              text default 'UTC'
)
returns public.special_dates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_active_user();
  v_title text := left(btrim(coalesce(p_title, '')), 60);
  v_tz    text := coalesce(nullif(btrim(p_tz), ''), 'UTC');
  v_row   public.special_dates;
begin
  if not private.is_conversation_member(p_conversation_id) then
    raise exception 'You are not a member of this conversation' using errcode = '42501';
  end if;
  if p_kind not in ('together', 'birthday', 'anniversary', 'other') then
    raise exception 'Unknown kind of date' using errcode = '22023';
  end if;
  if v_title = '' then
    v_title := case p_kind when 'together' then 'Together' when 'anniversary' then 'Anniversary'
                           when 'birthday' then 'Birthday' else 'Special day' end;
  end if;
  if p_on_date is null or p_on_date < date '1900-01-01' or p_on_date > date '2200-12-31' then
    raise exception 'Choose a valid date' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_tz) then
    v_tz := 'UTC';
  end if;

  if p_id is null then
    if (select count(*) from public.special_dates
        where conversation_id = p_conversation_id and deleted_at is null) >= 50 then
      raise exception 'You can save up to 50 dates per chat' using errcode = '22023';
    end if;
    if p_kind = 'together' and exists (
      select 1 from public.special_dates
      where conversation_id = p_conversation_id and kind = 'together' and deleted_at is null
    ) then
      raise exception 'You already have a "together since" date — edit that one instead' using errcode = '23505';
    end if;
    insert into public.special_dates (conversation_id, created_by, kind, title, on_date, yearly, remind, tz)
    values (p_conversation_id, v_uid, p_kind, v_title, p_on_date,
            p_kind <> 'other' or coalesce(p_yearly, true), coalesce(p_remind, true), v_tz)
    returning * into v_row;
  else
    update public.special_dates d
      set kind = p_kind, title = v_title, on_date = p_on_date,
          yearly = p_kind <> 'other' or coalesce(p_yearly, true),
          remind = coalesce(p_remind, true), tz = v_tz,
          -- A changed date may be today: allow its reminder again.
          last_reminded_on = case when d.on_date is distinct from p_on_date then null else d.last_reminded_on end
      where d.id = p_id and d.conversation_id = p_conversation_id and d.deleted_at is null
      returning * into v_row;
    if not found then
      raise exception 'Date not found' using errcode = 'P0002';
    end if;
  end if;
  return v_row;
exception
  when unique_violation then
    raise exception 'You already have a "together since" date — edit that one instead' using errcode = '23505';
end;
$$;

create or replace function public.delete_special_date(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv uuid;
begin
  perform private.require_active_user();
  select conversation_id into v_conv from public.special_dates where id = p_id and deleted_at is null;
  if v_conv is null or not private.is_conversation_member(v_conv) then
    raise exception 'Date not found' using errcode = 'P0002';
  end if;
  update public.special_dates set deleted_at = now() where id = p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Love notes for later
-- -----------------------------------------------------------------------------
create or replace function public.schedule_message(p_conversation_id uuid, p_body text, p_send_at timestamptz)
returns public.scheduled_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_active_user();
  v_body text := btrim(coalesce(p_body, ''), E' \t\r\n');
  v_row  public.scheduled_messages;
begin
  if not private.is_conversation_member(p_conversation_id) then
    raise exception 'You are not a member of this conversation' using errcode = '42501';
  end if;
  if v_body = '' then
    raise exception 'Write a message first' using errcode = '22023';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'Message is too long (max 4000 characters)' using errcode = '22001';
  end if;
  if p_send_at is null or p_send_at < now() + interval '30 seconds' then
    raise exception 'Pick a time in the future' using errcode = '22023';
  end if;
  if p_send_at > now() + interval '366 days' then
    raise exception 'Pick a time within the next year' using errcode = '22023';
  end if;
  if (select count(*) from public.scheduled_messages
      where sender_id = v_uid and delivered_at is null and canceled_at is null) >= 50 then
    raise exception 'You can have up to 50 notes waiting' using errcode = '22023';
  end if;
  insert into public.scheduled_messages (conversation_id, sender_id, body, send_at)
  values (p_conversation_id, v_uid, v_body, p_send_at)
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.cancel_scheduled_message(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_user();
begin
  update public.scheduled_messages
    set canceled_at = now()
    where id = p_id and sender_id = v_uid and delivered_at is null and canceled_at is null;
  if not found then
    raise exception 'This note was already sent or cancelled' using errcode = 'P0002';
  end if;
end;
$$;

-- Delivers due notes (all of them, or only those in p_user's conversations).
-- FOR UPDATE SKIP LOCKED + the (sender, client_id) unique key make concurrent
-- runs (pg_cron and an open app) deliver each note exactly once.
create or replace function private.deliver_due_scheduled(p_user uuid default null)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note public.scheduled_messages;
  v_msg  public.messages;
  v_ids  uuid[] := '{}';
begin
  for v_note in
    select s.* from public.scheduled_messages s
    where s.delivered_at is null and s.canceled_at is null and s.send_at <= now()
      and (p_user is null or exists (
        select 1 from public.conversation_members m
        where m.conversation_id = s.conversation_id and m.user_id = p_user and m.left_at is null
      ))
    order by s.send_at
    limit 200
    for update skip locked
  loop
    -- Only if the author and the others still have access.
    if not private.user_is_active(v_note.sender_id)
       or not exists (
         select 1 from public.conversation_members m
         where m.conversation_id = v_note.conversation_id and m.user_id = v_note.sender_id and m.left_at is null
       )
       or exists (
         select 1 from public.conversation_members m
         join public.conversations c on c.id = m.conversation_id and c.kind = 'direct'
         where m.conversation_id = v_note.conversation_id and m.user_id <> v_note.sender_id
           and not private.user_is_active(m.user_id)
       ) then
      update public.scheduled_messages set canceled_at = now() where id = v_note.id;
      continue;
    end if;

    insert into public.messages (conversation_id, sender_id, client_id, body, was_scheduled)
    values (v_note.conversation_id, v_note.sender_id, v_note.id, v_note.body, true)
    on conflict on constraint messages_sender_client_unique do nothing
    returning * into v_msg;
    if v_msg.id is null then
      select * into v_msg from public.messages where sender_id = v_note.sender_id and client_id = v_note.id;
    else
      update public.conversations set last_message_at = v_msg.created_at where id = v_note.conversation_id;
      update public.conversation_members
        set last_read_at = greatest(coalesce(last_read_at, '-infinity'::timestamptz), v_msg.created_at),
            last_delivered_at = greatest(coalesce(last_delivered_at, '-infinity'::timestamptz), v_msg.created_at)
        where conversation_id = v_note.conversation_id and user_id = v_note.sender_id;
      v_ids := v_ids || v_msg.id;
    end if;
    update public.scheduled_messages
      set delivered_at = now(), delivered_message_id = v_msg.id
      where id = v_note.id;
  end loop;
  return v_ids;
end;
$$;

-- Posts "today is …" into the chat for each date whose day it is (from 08:00
-- in the time zone it was saved in). Feb 29 dates are celebrated on Feb 28 in
-- other years.
create or replace function private.deliver_due_reminders(p_user uuid default null)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date  public.special_dates;
  v_local timestamp;
  v_today date;
  v_years integer;
  v_match boolean;
  v_id    uuid;
  v_at    timestamptz;
  v_ids   uuid[] := '{}';
begin
  for v_date in
    select d.* from public.special_dates d
    where d.remind and d.deleted_at is null
      and (p_user is null or exists (
        select 1 from public.conversation_members m
        where m.conversation_id = d.conversation_id and m.user_id = p_user and m.left_at is null
      ))
    for update skip locked
  loop
    v_local := now() at time zone v_date.tz;
    v_today := v_local::date;
    continue when extract(hour from v_local) < 8;
    continue when v_date.last_reminded_on is not null and v_date.last_reminded_on >= v_today;

    if v_date.yearly then
      v_years := extract(year from v_today)::integer - extract(year from v_date.on_date)::integer;
      v_match := v_years >= 0 and (
        (extract(month from v_today) = extract(month from v_date.on_date)
          and extract(day from v_today) = extract(day from v_date.on_date))
        or (extract(month from v_date.on_date) = 2 and extract(day from v_date.on_date) = 29
          and extract(month from v_today) = 2 and extract(day from v_today) = 28
          and extract(day from (make_date(extract(year from v_today)::integer, 3, 1) - 1)) = 28)
      );
    else
      v_years := 0;
      v_match := v_date.on_date = v_today;
    end if;
    continue when not v_match;
    -- Nothing to celebrate on the very first "together" day.
    if v_date.kind = 'together' and v_years = 0 then
      update public.special_dates set last_reminded_on = v_today where id = v_date.id;
      continue;
    end if;

    insert into public.messages (conversation_id, sender_id, client_id, body, system_event, was_scheduled)
    values (v_date.conversation_id, null, gen_random_uuid(), '',
            jsonb_build_object('type', 'date_reminder', 'date_id', v_date.id, 'kind', v_date.kind,
                               'title', v_date.title, 'years', v_years),
            true)
    returning id, created_at into v_id, v_at;
    update public.conversations set last_message_at = v_at where id = v_date.conversation_id;
    update public.special_dates set last_reminded_on = v_today where id = v_date.id;
    v_ids := v_ids || v_id;
  end loop;
  return v_ids;
end;
$$;

-- Called by an open app every minute or so: delivers what's due in the
-- caller's chats and returns the new message ids (the app then asks the
-- server to send their notifications).
create or replace function public.deliver_due_items()
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_user();
begin
  return private.deliver_due_scheduled(v_uid) || private.deliver_due_reminders(v_uid);
end;
$$;

-- pg_cron entry point: deliver everything due, then ask the app to notify.
create or replace function private.run_scheduled_jobs()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids  uuid[];
  v_hook private.app_hook;
begin
  v_ids := private.deliver_due_scheduled(null) || private.deliver_due_reminders(null);
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return;
  end if;
  select * into v_hook from private.app_hook;
  if found and to_regnamespace('net') is not null then
    execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 8000)'
      using v_hook.url || '/api/push/hook',
            jsonb_build_object('message_ids', to_jsonb(v_ids)),
            jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_hook.secret);
  end if;
end;
$$;

-- Server (service role): the app tells the database its address; returns the
-- secret that /api/push/hook expects. The secret is created once.
create or replace function public.server_register_app(p_url text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text := rtrim(btrim(coalesce(p_url, '')), '/');
  v_secret text;
begin
  if v_url !~ '^https?://[^/\s]+$' then
    raise exception 'Invalid app URL' using errcode = '22023';
  end if;
  insert into private.app_hook as h (url, secret)
  values (v_url, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (id) do update
    set url = excluded.url,
        updated_at = case when h.url = excluded.url then h.updated_at else now() end
  returning h.secret into v_secret;
  return v_secret;
end;
$$;

create or replace function public.server_app_hook_secret()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select secret from private.app_hook;
$$;

-- -----------------------------------------------------------------------------
-- Shared list
-- -----------------------------------------------------------------------------
create or replace function public.add_list_item(p_conversation_id uuid, p_text text)
returns public.shared_list_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_active_user();
  v_text text := btrim(coalesce(p_text, ''));
  v_row  public.shared_list_items;
begin
  if not private.is_conversation_member(p_conversation_id) then
    raise exception 'You are not a member of this conversation' using errcode = '42501';
  end if;
  if v_text = '' then
    raise exception 'Write something first' using errcode = '22023';
  end if;
  if char_length(v_text) > 200 then
    raise exception 'Keep it under 200 characters' using errcode = '22001';
  end if;
  if (select count(*) from public.shared_list_items
      where conversation_id = p_conversation_id and deleted_at is null) >= 300 then
    raise exception 'The list is full (300 items) — clear some done items' using errcode = '22023';
  end if;
  insert into public.shared_list_items (conversation_id, created_by, text)
  values (p_conversation_id, v_uid, v_text)
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.set_list_item_done(p_id uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_active_user();
  v_conv uuid;
begin
  select conversation_id into v_conv from public.shared_list_items where id = p_id and deleted_at is null;
  if v_conv is null or not private.is_conversation_member(v_conv) then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;
  update public.shared_list_items
    set done = coalesce(p_done, false),
        done_by = case when coalesce(p_done, false) then v_uid end,
        done_at = case when coalesce(p_done, false) then now() end
    where id = p_id;
end;
$$;

create or replace function public.delete_list_item(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv uuid;
begin
  perform private.require_active_user();
  select conversation_id into v_conv from public.shared_list_items where id = p_id and deleted_at is null;
  if v_conv is null or not private.is_conversation_member(v_conv) then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;
  update public.shared_list_items set deleted_at = now() where id = p_id;
end;
$$;

create or replace function public.clear_done_list_items(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.require_active_user();
  if not private.is_conversation_member(p_conversation_id) then
    raise exception 'You are not a member of this conversation' using errcode = '42501';
  end if;
  with cleared as (
    update public.shared_list_items set deleted_at = now()
    where conversation_id = p_conversation_id and done and deleted_at is null
    returning 1
  ) select count(*) into v_count from cleared;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Notifications: also for "thinking of you", delivered love notes and date
-- reminders. p_caller is the signed-in user asking (null = the database's own
-- hook). Ordinary messages and taps: only their sender may ask. Timed
-- messages: any member (the open app that delivered it) or the hook.
-- -----------------------------------------------------------------------------
drop function public.server_push_targets(uuid, uuid);
create or replace function public.server_push_targets(p_message_id uuid, p_caller uuid)
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
  attachment_kind     text,
  event               jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg  public.messages;
  v_type text;
begin
  delete from private.push_sent where created_at < now() - interval '2 days';

  select * into v_msg from public.messages m
    where m.id = p_message_id
      and m.deleted_at is null
      and m.created_at > now() - interval '10 minutes';
  if not found then
    return;
  end if;
  v_type := v_msg.system_event ->> 'type';
  if v_msg.system_event is not null and coalesce(v_type, '') not in ('nudge', 'date_reminder') then
    return;
  end if;

  if v_msg.was_scheduled then
    if p_caller is not null and not exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = v_msg.conversation_id and cm.user_id = p_caller and cm.left_at is null
    ) then
      return;
    end if;
  elsif p_caller is null or v_msg.sender_id is distinct from p_caller then
    return;
  end if;
  if v_msg.sender_id is not null and not private.user_is_active(v_msg.sender_id) then
    return;
  end if;

  insert into private.push_sent (message_id) values (p_message_id)
  on conflict do nothing;
  if not found then
    return; -- already notified
  end if;

  return query
    select s.endpoint, s.p256dh, s.auth, s.show_preview, v_msg.conversation_id, c.kind, c.title,
           coalesce(nullif(sp.display_name, ''), sp.email, ''),
           left(v_msg.body, 200),
           exists (select 1 from public.attachments at where at.message_id = v_msg.id),
           (select case
                     when at.view_once then 'view_once'
                     when at.mime_type like 'image/%' then 'image'
                     when at.mime_type like 'audio/%' then 'audio'
                     else 'file' end
              from public.attachments at where at.message_id = v_msg.id order by at.created_at limit 1),
           v_msg.system_event
    from public.conversation_members cm
    join public.conversations c on c.id = cm.conversation_id
    join public.push_subscriptions s on s.user_id = cm.user_id
    left join public.profiles sp on sp.id = v_msg.sender_id
    where cm.conversation_id = v_msg.conversation_id
      and cm.user_id is distinct from v_msg.sender_id
      and cm.left_at is null
      and private.user_is_active(cm.user_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Retention: also removes opened view-once files, and old soft-deleted list
-- items, dates and finished notes.
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

  -- View-once photos that were opened more than 10 minutes ago.
  v_paths := v_paths || coalesce((
    select array_agg(a.storage_path) from (
      select a2.storage_path from public.attachments a2
      where a2.view_once and a2.viewed_at < now() - interval '10 minutes'
        and exists (select 1 from storage.objects o where o.bucket_id = 'attachments' and o.name = a2.storage_path)
      limit 1000
    ) a
  ), '{}');

  delete from public.access_requests
    where status <> 'pending' and decided_at < now() - interval '90 days';
  delete from public.shared_list_items where deleted_at < now() - interval '7 days';
  delete from public.special_dates where deleted_at < now() - interval '7 days';
  delete from public.scheduled_messages
    where coalesce(delivered_at, canceled_at) < now() - interval '30 days';
  delete from private.password_account_grants where expires_at < now() - interval '1 day';

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
-- Realtime: the list and the dates update live for both people.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.special_dates, public.shared_list_items;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Every minute: pg_cron runs the timed work (if the extension can be enabled;
-- otherwise the open app does it, see deliver_due_items). pg_net lets the
-- database ask the app to send notifications.
-- -----------------------------------------------------------------------------
do $$
begin
  begin
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_net not available: notifications for timed messages need the app to be open';
  end;
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron not available: timed messages are delivered while someone has the app open';
  end;
  if to_regnamespace('cron') is not null then
    perform cron.schedule('ghostline-timed-messages', '* * * * *', 'select private.run_scheduled_jobs()');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke execute on function
  public.send_message(uuid, uuid, text, jsonb, uuid),
  public.open_view_once(uuid),
  public.get_chat_appearance(uuid),
  public.set_chat_appearance(uuid, text, text),
  public.send_nudge(uuid),
  public.save_special_date(uuid, uuid, text, text, date, boolean, boolean, text),
  public.delete_special_date(uuid),
  public.schedule_message(uuid, text, timestamptz),
  public.cancel_scheduled_message(uuid),
  public.deliver_due_items(),
  public.add_list_item(uuid, text),
  public.set_list_item_done(uuid, boolean),
  public.delete_list_item(uuid),
  public.clear_done_list_items(uuid)
from public, anon;

grant execute on function
  public.send_message(uuid, uuid, text, jsonb, uuid),
  public.open_view_once(uuid),
  public.get_chat_appearance(uuid),
  public.set_chat_appearance(uuid, text, text),
  public.send_nudge(uuid),
  public.save_special_date(uuid, uuid, text, text, date, boolean, boolean, text),
  public.delete_special_date(uuid),
  public.schedule_message(uuid, text, timestamptz),
  public.cancel_scheduled_message(uuid),
  public.deliver_due_items(),
  public.add_list_item(uuid, text),
  public.set_list_item_done(uuid, boolean),
  public.delete_list_item(uuid),
  public.clear_done_list_items(uuid)
to authenticated;

revoke execute on function
  public.server_view_once_opened_path(uuid, uuid),
  public.server_register_app(text),
  public.server_app_hook_secret(),
  public.server_push_targets(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.server_view_once_opened_path(uuid, uuid),
  public.server_register_app(text),
  public.server_app_hook_secret(),
  public.server_push_targets(uuid, uuid)
to service_role;

revoke all on function
  private.deliver_due_scheduled(uuid),
  private.deliver_due_reminders(uuid),
  private.run_scheduled_jobs()
from public, anon, authenticated;
