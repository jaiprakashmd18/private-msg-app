-- =============================================================================
-- 1300 — Videos, countdown to the next meet, streaks, bucket list, date
-- planner and a shared journal. (Search in a chat and link previews need no
-- database changes.)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Videos: up to 50 MB (photos and files stay at 10 MB).
-- -----------------------------------------------------------------------------
alter table public.attachments drop constraint attachments_size_bytes_check;
alter table public.attachments
  add constraint attachments_size_bytes_check check (size_bytes > 0 and size_bytes <= 52428800);

update storage.buckets
  set file_size_limit = 52428800,
      allowed_mime_types = array[
        'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic',
        'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/x-m4a', 'audio/wav',
        'video/mp4', 'video/quicktime', 'video/webm',
        'application/pdf', 'text/plain',
        'application/zip',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ]
  where id = 'attachments';

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
    if v_size is null or v_size <= 0
       or v_size > (case when coalesce(v_meta ->> 'mimetype', '') like 'video/%' then 52428800 else 10485760 end) then
      raise exception 'Attachment is too large (photos and files up to 10 MB, videos up to 50 MB)' using errcode = '22023';
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

-- Inbox preview says "Video" for videos (same function, one more kind).
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

-- -----------------------------------------------------------------------------
-- Countdown to the next meet: a special date of kind "meet" (one-off).
-- -----------------------------------------------------------------------------
alter table public.special_dates drop constraint special_dates_kind_check;
alter table public.special_dates
  add constraint special_dates_kind_check check (kind in ('together', 'birthday', 'anniversary', 'other', 'meet'));

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
  if p_kind not in ('together', 'birthday', 'anniversary', 'other', 'meet') then
    raise exception 'Unknown kind of date' using errcode = '22023';
  end if;
  if v_title = '' then
    v_title := case p_kind when 'together' then 'Together' when 'anniversary' then 'Anniversary'
                           when 'birthday' then 'Birthday' when 'meet' then 'We meet' else 'Special day' end;
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
            p_kind not in ('other', 'meet') or (p_kind = 'other' and coalesce(p_yearly, true)), coalesce(p_remind, true), v_tz)
    returning * into v_row;
  else
    update public.special_dates d
      set kind = p_kind, title = v_title, on_date = p_on_date,
          yearly = p_kind not in ('other', 'meet') or (p_kind = 'other' and coalesce(p_yearly, true)),
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

-- -----------------------------------------------------------------------------
-- Streak: days in a row on which everyone in the chat sent a message, in the
-- caller's time zone. Today counts once everyone has written; until then the
-- streak is still alive from yesterday.
-- -----------------------------------------------------------------------------
create or replace function public.get_streak(p_conversation_id uuid, p_tz text default 'UTC')
returns table (days integer, today_done boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz    text := coalesce(nullif(btrim(p_tz), ''), 'UTC');
  v_need  integer;
  v_today date;
  v_day   date;
  v_done  date[];
  v_count integer := 0;
begin
  perform private.require_active_user();
  if not private.is_conversation_member(p_conversation_id) then
    raise exception 'You are not a member of this conversation' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_tz) then
    v_tz := 'UTC';
  end if;
  select greatest(count(*), 2) into v_need
    from public.conversation_members where conversation_id = p_conversation_id and left_at is null;
  v_today := (now() at time zone v_tz)::date;

  select coalesce(array_agg(d order by d desc), '{}') into v_done
    from (
      select (m.created_at at time zone v_tz)::date as d
      from public.messages m
      where m.conversation_id = p_conversation_id
        and m.sender_id is not null
        and m.system_event is null
        and m.deleted_at is null
        and m.created_at > now() - interval '400 days'
      group by 1
      having count(distinct m.sender_id) >= v_need
    ) full_days;

  today_done := v_today = any(v_done);
  v_day := case when today_done then v_today else v_today - 1 end;
  while v_day = any(v_done) loop
    v_count := v_count + 1;
    v_day := v_day - 1;
  end loop;
  days := v_count;
  return next;
end;
$$;

-- -----------------------------------------------------------------------------
-- Bucket list: a second list next to the to-do list, with a photo when done.
-- -----------------------------------------------------------------------------
alter table public.shared_list_items
  add column list_kind  text not null default 'todo' check (list_kind in ('todo', 'bucket')),
  add column photo_path text check (photo_path is null or char_length(photo_path) <= 300);

drop function public.add_list_item(uuid, text);
create or replace function public.add_list_item(p_conversation_id uuid, p_text text, p_kind text default 'todo')
returns public.shared_list_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_active_user();
  v_text text := btrim(coalesce(p_text, ''));
  v_kind text := coalesce(p_kind, 'todo');
  v_row  public.shared_list_items;
begin
  if not private.is_conversation_member(p_conversation_id) then
    raise exception 'You are not a member of this conversation' using errcode = '42501';
  end if;
  if v_kind not in ('todo', 'bucket') then
    raise exception 'Unknown list' using errcode = '22023';
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
  insert into public.shared_list_items (conversation_id, created_by, text, list_kind)
  values (p_conversation_id, v_uid, v_text, v_kind)
  returning * into v_row;
  return v_row;
end;
$$;

-- "Clear done" only tidies the to-do list; the bucket list keeps its memories.
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
    where conversation_id = p_conversation_id and done and deleted_at is null and list_kind = 'todo'
    returning 1
  ) select count(*) into v_count from cleared;
  return v_count;
end;
$$;

-- Photos for the bucket list and the journal live in the caller's own
-- folder of the private `avatars` bucket.
create or replace function private.own_photo_ok(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_path is null or (
    split_part(p_path, '/', 1) = 'users'
    and split_part(p_path, '/', 2) = (select auth.uid())::text
    and exists (select 1 from storage.objects o where o.bucket_id = 'avatars' and o.name = p_path)
  );
$$;

create or replace function public.set_list_item_photo(p_id uuid, p_path text)
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
  if not private.own_photo_ok(nullif(btrim(coalesce(p_path, '')), '')) then
    raise exception 'Invalid photo' using errcode = '22023';
  end if;
  update public.shared_list_items set photo_path = nullif(btrim(coalesce(p_path, '')), '') where id = p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Date planner
-- -----------------------------------------------------------------------------
create table public.date_plans (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  created_by       uuid references public.profiles (id) on delete set null,
  title            text not null check (char_length(title) between 1 and 80),
  starts_at        timestamptz not null,
  place            text check (place is null or char_length(place) <= 120),
  notes            text check (notes is null or char_length(notes) <= 500),
  remind_minutes   integer not null default 60 check (remind_minutes in (0, 15, 30, 60, 120, 1440)),
  reminded_at      timestamptz,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index date_plans_conversation_idx on public.date_plans (conversation_id, starts_at) where deleted_at is null;
create index date_plans_due_idx on public.date_plans (starts_at) where deleted_at is null and reminded_at is null;

create trigger date_plans_updated_at
  before update on public.date_plans
  for each row execute function private.set_updated_at();

create or replace function public.save_plan(
  p_id              uuid,
  p_conversation_id uuid,
  p_title           text,
  p_starts_at       timestamptz,
  p_place           text default null,
  p_notes           text default null,
  p_remind_minutes  integer default 60
)
returns public.date_plans
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_active_user();
  v_title text := left(btrim(coalesce(p_title, '')), 80);
  v_place text := nullif(left(btrim(coalesce(p_place, '')), 120), '');
  v_notes text := nullif(left(btrim(coalesce(p_notes, '')), 500), '');
  v_row   public.date_plans;
begin
  if not private.is_conversation_member(p_conversation_id) then
    raise exception 'You are not a member of this conversation' using errcode = '42501';
  end if;
  if v_title = '' then
    raise exception 'Give your plan a name' using errcode = '22023';
  end if;
  if p_starts_at is null or p_starts_at < now() - interval '1 day' or p_starts_at > now() + interval '3 years' then
    raise exception 'Pick a date from today on' using errcode = '22023';
  end if;
  if coalesce(p_remind_minutes, 60) not in (0, 15, 30, 60, 120, 1440) then
    raise exception 'Unknown reminder time' using errcode = '22023';
  end if;

  if p_id is null then
    if (select count(*) from public.date_plans
        where conversation_id = p_conversation_id and deleted_at is null and starts_at > now()) >= 100 then
      raise exception 'You have a lot of plans already!' using errcode = '22023';
    end if;
    insert into public.date_plans (conversation_id, created_by, title, starts_at, place, notes, remind_minutes)
    values (p_conversation_id, v_uid, v_title, p_starts_at, v_place, v_notes, coalesce(p_remind_minutes, 60))
    returning * into v_row;
    perform private.post_system_message(p_conversation_id, v_uid,
      jsonb_build_object('type', 'plan_added', 'plan_id', v_row.id, 'title', v_title,
                         'starts_at', p_starts_at, 'place', v_place));
  else
    update public.date_plans p
      set title = v_title, starts_at = p_starts_at, place = v_place, notes = v_notes,
          remind_minutes = coalesce(p_remind_minutes, 60),
          reminded_at = case when p.starts_at is distinct from p_starts_at
                               or p.remind_minutes is distinct from coalesce(p_remind_minutes, 60)
                             then null else p.reminded_at end
      where p.id = p_id and p.conversation_id = p_conversation_id and p.deleted_at is null
      returning * into v_row;
    if not found then
      raise exception 'Plan not found' using errcode = 'P0002';
    end if;
  end if;
  return v_row;
end;
$$;

create or replace function public.delete_plan(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv uuid;
begin
  perform private.require_active_user();
  select conversation_id into v_conv from public.date_plans where id = p_id and deleted_at is null;
  if v_conv is null or not private.is_conversation_member(v_conv) then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  update public.date_plans set deleted_at = now() where id = p_id;
end;
$$;

-- Posts "⏰ Dinner at Marina in 1 hour" into the chat when a plan's reminder is due.
create or replace function private.deliver_due_plans(p_user uuid default null)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.date_plans;
  v_id   uuid;
  v_at   timestamptz;
  v_ids  uuid[] := '{}';
begin
  for v_plan in
    select p.* from public.date_plans p
    where p.deleted_at is null and p.reminded_at is null and p.remind_minutes > 0
      and p.starts_at - make_interval(mins => p.remind_minutes) <= now()
      and p.starts_at > now() - interval '1 hour'
      and (p_user is null or exists (
        select 1 from public.conversation_members m
        where m.conversation_id = p.conversation_id and m.user_id = p_user and m.left_at is null
      ))
    for update skip locked
  loop
    insert into public.messages (conversation_id, sender_id, client_id, body, system_event, was_scheduled)
    values (v_plan.conversation_id, null, gen_random_uuid(), '',
            jsonb_build_object('type', 'plan_reminder', 'plan_id', v_plan.id, 'title', v_plan.title,
                               'starts_at', v_plan.starts_at, 'place', v_plan.place),
            true)
    returning id, created_at into v_id, v_at;
    update public.conversations set last_message_at = v_at where id = v_plan.conversation_id;
    update public.date_plans set reminded_at = now() where id = v_plan.id;
    v_ids := v_ids || v_id;
  end loop;
  return v_ids;
end;
$$;

create or replace function public.deliver_due_items()
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_user();
begin
  return private.deliver_due_scheduled(v_uid) || private.deliver_due_reminders(v_uid) || private.deliver_due_plans(v_uid);
end;
$$;

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
  v_ids := private.deliver_due_scheduled(null) || private.deliver_due_reminders(null) || private.deliver_due_plans(null);
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

-- -----------------------------------------------------------------------------
-- Our journal: each person's entry per day (text and/or a photo).
-- -----------------------------------------------------------------------------
create table public.journal_entries (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  day              date not null,
  body             text check (body is null or char_length(body) between 1 and 2000),
  photo_path       text check (photo_path is null or char_length(photo_path) <= 300),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (conversation_id, user_id, day),
  check (body is not null or photo_path is not null)
);

create index journal_entries_conversation_day_idx on public.journal_entries (conversation_id, day desc);

create trigger journal_entries_updated_at
  before update on public.journal_entries
  for each row execute function private.set_updated_at();

create or replace function public.save_journal_entry(
  p_conversation_id uuid,
  p_day             date,
  p_body            text,
  p_photo_path      text default null
)
returns public.journal_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_active_user();
  v_body  text := nullif(btrim(coalesce(p_body, '')), '');
  v_photo text := nullif(btrim(coalesce(p_photo_path, '')), '');
  v_new   boolean;
  v_row   public.journal_entries;
begin
  if not private.is_conversation_member(p_conversation_id) then
    raise exception 'You are not a member of this conversation' using errcode = '42501';
  end if;
  if p_day is null or p_day < current_date - 1 or p_day > current_date + 1 then
    raise exception 'You can only write today''s entry' using errcode = '22023';
  end if;
  if v_body is null and v_photo is null then
    raise exception 'Write something or add a photo' using errcode = '22023';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'Keep it under 2000 characters' using errcode = '22001';
  end if;
  if not private.own_photo_ok(v_photo) then
    raise exception 'Invalid photo' using errcode = '22023';
  end if;

  v_new := not exists (
    select 1 from public.journal_entries where conversation_id = p_conversation_id and user_id = v_uid and day = p_day
  );
  insert into public.journal_entries (conversation_id, user_id, day, body, photo_path)
  values (p_conversation_id, v_uid, p_day, v_body, v_photo)
  on conflict (conversation_id, user_id, day) do update set body = excluded.body, photo_path = excluded.photo_path
  returning * into v_row;
  if v_new then
    perform private.post_system_message(p_conversation_id, v_uid, jsonb_build_object('type', 'journal', 'day', p_day));
  end if;
  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges and RLS (reads only; writes through the functions above)
-- -----------------------------------------------------------------------------
revoke all on table public.date_plans, public.journal_entries from anon, authenticated;
grant select on table public.date_plans, public.journal_entries to authenticated;
alter table public.date_plans enable row level security;
alter table public.journal_entries enable row level security;

create policy "members read date plans"
  on public.date_plans for select to authenticated
  using ((select private.is_active_user()) and private.is_conversation_member(conversation_id));

create policy "members read the journal"
  on public.journal_entries for select to authenticated
  using ((select private.is_active_user()) and private.is_conversation_member(conversation_id));

-- -----------------------------------------------------------------------------
-- Notifications for plans and journal entries too.
-- -----------------------------------------------------------------------------
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
  if v_msg.system_event is not null and coalesce(v_type, '') not in ('nudge', 'date_reminder', 'daily_answered', 'mood', 'plan_added', 'plan_reminder', 'journal') then
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
                     when at.mime_type like 'video/%' then 'video'
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

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.date_plans, public.journal_entries;
  end if;
end;
$$;

revoke execute on function
  public.send_message(uuid, uuid, text, jsonb, uuid),
  public.save_special_date(uuid, uuid, text, text, date, boolean, boolean, text),
  public.get_streak(uuid, text),
  public.add_list_item(uuid, text, text),
  public.clear_done_list_items(uuid),
  public.set_list_item_photo(uuid, text),
  public.save_plan(uuid, uuid, text, timestamptz, text, text, integer),
  public.delete_plan(uuid),
  public.deliver_due_items(),
  public.save_journal_entry(uuid, date, text, text)
from public, anon;

grant execute on function
  public.send_message(uuid, uuid, text, jsonb, uuid),
  public.save_special_date(uuid, uuid, text, text, date, boolean, boolean, text),
  public.get_streak(uuid, text),
  public.add_list_item(uuid, text, text),
  public.clear_done_list_items(uuid),
  public.set_list_item_photo(uuid, text),
  public.save_plan(uuid, uuid, text, timestamptz, text, text, integer),
  public.delete_plan(uuid),
  public.deliver_due_items(),
  public.save_journal_entry(uuid, date, text, text)
to authenticated;

revoke all on function private.deliver_due_plans(uuid), private.run_scheduled_jobs(), private.own_photo_ok(text)
  from public, anon, authenticated;
revoke execute on function public.server_push_targets(uuid, uuid) from public, anon, authenticated;
grant execute on function public.server_push_targets(uuid, uuid) to service_role;
