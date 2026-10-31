-- =============================================================================
-- UPDATE: stickers & GIFs, love taps ("I miss you", hug, kiss), question of the
-- day and mood check-in.
--
-- Run ONCE on a project that was set up before this update, AFTER the
-- earlier update files (… update_couple_features.sql) if you haven't run those
-- yet. New projects don't need it (setup_all.sql has everything).
-- Paste into Supabase → SQL Editor → New query → Run.
-- =============================================================================

-- =============================================================================
-- 1200 — Stickers & GIFs, love taps ("I miss you", hugs, kisses), a daily
-- question for the two of you, and mood check-ins.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Stickers & GIFs: a message with a sticker id (from the app's own pack) or a
-- GIF (GIPHY). Its body keeps a short text version ("💖 Love you", "GIF: hug")
-- for previews, search and notifications.
-- -----------------------------------------------------------------------------
alter table public.messages
  add column sticker text check (sticker is null or sticker ~ '^[a-z0-9-]{1,40}$'),
  add column gif     jsonb;

create or replace function public.send_sticker(
  p_conversation_id uuid,
  p_client_id       uuid,
  p_sticker         text,
  p_gif             jsonb,
  p_body            text
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_active_user();
  v_msg  public.messages;
  v_gif  jsonb;
  v_url  text;
  v_w    text;
  v_h    text;
  v_body text := left(btrim(coalesce(p_body, ''), E' \t\r\n'), 120);
begin
  if p_client_id is null then
    raise exception 'client_id is required' using errcode = '22023';
  end if;
  if not private.is_conversation_member(p_conversation_id) then
    raise exception 'You are not a member of this conversation' using errcode = '42501';
  end if;

  select * into v_msg from public.messages where sender_id = v_uid and client_id = p_client_id;
  if found then
    return v_msg;
  end if;

  if exists (
    select 1 from public.conversation_members m
    join public.conversations c on c.id = m.conversation_id and c.kind = 'direct'
    where m.conversation_id = p_conversation_id and m.user_id <> v_uid
      and not private.user_is_active(m.user_id)
  ) then
    raise exception 'The other participant no longer has access' using errcode = '42501';
  end if;

  if (p_sticker is null) = (p_gif is null) then
    raise exception 'Send either a sticker or a GIF' using errcode = '22023';
  end if;
  if p_sticker is not null and p_sticker !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'Unknown sticker' using errcode = '22023';
  end if;
  if p_gif is not null then
    v_url := p_gif ->> 'url';
    v_w := p_gif ->> 'width';
    v_h := p_gif ->> 'height';
    if v_url is null or char_length(v_url) > 500
       or v_url !~ '^https://(media[0-9]?|i)\.giphy\.com/[A-Za-z0-9/_.%-]+(\?[A-Za-z0-9=&._%-]*)?$' then
      raise exception 'Only GIPHY GIFs can be sent' using errcode = '22023';
    end if;
    v_gif := jsonb_build_object(
      'url', v_url,
      'id', left(coalesce(p_gif ->> 'id', ''), 64),
      'title', left(coalesce(p_gif ->> 'title', ''), 140),
      'width', case when v_w ~ '^[0-9]{1,4}$' then least(v_w::integer, 2000) end,
      'height', case when v_h ~ '^[0-9]{1,4}$' then least(v_h::integer, 2000) end
    );
  end if;
  if v_body = '' then
    v_body := case when p_sticker is not null then 'Sticker' else 'GIF' end;
  end if;

  if (select count(*) from public.messages
      where sender_id = v_uid and created_at > now() - interval '10 seconds') >= 15 then
    raise exception 'You are sending messages too quickly' using errcode = 'PT429';
  end if;

  insert into public.messages (conversation_id, sender_id, client_id, body, sticker, gif)
  values (p_conversation_id, v_uid, p_client_id, v_body, p_sticker, v_gif)
  on conflict on constraint messages_sender_client_unique do nothing
  returning * into v_msg;
  if v_msg.id is null then
    select * into v_msg from public.messages where sender_id = v_uid and client_id = p_client_id;
    return v_msg;
  end if;

  update public.conversations set last_message_at = v_msg.created_at where id = p_conversation_id;
  update public.conversation_members
    set last_read_at = greatest(coalesce(last_read_at, '-infinity'::timestamptz), v_msg.created_at),
        last_delivered_at = greatest(coalesce(last_delivered_at, '-infinity'::timestamptz), v_msg.created_at)
    where conversation_id = p_conversation_id and user_id = v_uid;
  return v_msg;
end;
$$;

-- -----------------------------------------------------------------------------
-- Love taps: thinking of you (heart), I miss you, a hug, a kiss.
-- -----------------------------------------------------------------------------
drop function public.send_nudge(uuid);
create or replace function public.send_nudge(p_conversation_id uuid, p_kind text default 'heart')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_active_user();
  v_kind text := coalesce(p_kind, 'heart');
  v_id   uuid;
  v_at   timestamptz;
begin
  if v_kind not in ('heart', 'miss_you', 'hug', 'kiss') then
    raise exception 'Unknown kind of tap' using errcode = '22023';
  end if;
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
  values (p_conversation_id, v_uid, gen_random_uuid(), '', jsonb_build_object('type', 'nudge', 'kind', v_kind))
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
-- Daily question. Each person answers; you only see the other's answer once
-- you've answered yourself (enforced by RLS, so Realtime obeys it too).
-- -----------------------------------------------------------------------------
create table public.daily_answers (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  day              date not null,
  question_index   integer not null check (question_index between 0 and 9999),
  answer           text not null check (char_length(answer) between 1 and 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (conversation_id, user_id, day)
);

create index daily_answers_conversation_day_idx on public.daily_answers (conversation_id, day desc);

create trigger daily_answers_updated_at
  before update on public.daily_answers
  for each row execute function private.set_updated_at();

revoke all on table public.daily_answers from anon, authenticated;
grant select on table public.daily_answers to authenticated;
alter table public.daily_answers enable row level security;

create or replace function private.answered_daily(p_conversation_id uuid, p_day date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.daily_answers d
    where d.conversation_id = p_conversation_id and d.day = p_day and d.user_id = (select auth.uid())
  );
$$;
revoke all on function private.answered_daily(uuid, date) from public, anon;
grant execute on function private.answered_daily(uuid, date) to authenticated;

create policy "members read answers once they answered"
  on public.daily_answers for select to authenticated
  using (
    (select private.is_active_user())
    and private.is_conversation_member(conversation_id)
    and (user_id = (select auth.uid()) or private.answered_daily(conversation_id, day))
  );

create or replace function public.answer_daily_question(
  p_conversation_id uuid,
  p_day             date,
  p_question_index  integer,
  p_answer          text
)
returns public.daily_answers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_active_user();
  v_answer text := btrim(coalesce(p_answer, ''));
  v_row    public.daily_answers;
  v_new    boolean;
  v_both   boolean;
begin
  if not private.is_conversation_member(p_conversation_id) then
    raise exception 'You are not a member of this conversation' using errcode = '42501';
  end if;
  if p_day is null or p_day < current_date - 1 or p_day > current_date + 1 then
    raise exception 'You can only answer today''s question' using errcode = '22023';
  end if;
  if p_question_index is null or p_question_index < 0 or p_question_index > 9999 then
    raise exception 'Unknown question' using errcode = '22023';
  end if;
  if v_answer = '' then
    raise exception 'Write your answer first' using errcode = '22023';
  end if;
  if char_length(v_answer) > 500 then
    raise exception 'Keep it under 500 characters' using errcode = '22001';
  end if;

  v_new := not exists (
    select 1 from public.daily_answers
    where conversation_id = p_conversation_id and user_id = v_uid and day = p_day
  );
  insert into public.daily_answers (conversation_id, user_id, day, question_index, answer)
  values (p_conversation_id, v_uid, p_day, p_question_index, v_answer)
  on conflict (conversation_id, user_id, day) do update set answer = excluded.answer
  returning * into v_row;

  if v_new then
    v_both := (
      select count(distinct d.user_id) from public.daily_answers d
      join public.conversation_members m on m.conversation_id = d.conversation_id and m.user_id = d.user_id and m.left_at is null
      where d.conversation_id = p_conversation_id and d.day = p_day
    ) >= greatest((select count(*) from public.conversation_members
                   where conversation_id = p_conversation_id and left_at is null), 2);
    perform private.post_system_message(p_conversation_id, v_uid,
      jsonb_build_object('type', 'daily_answered', 'day', p_day, 'both', v_both));
  end if;
  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Mood check-in: how each person feels today (shown for 24 hours).
-- -----------------------------------------------------------------------------
alter table public.conversation_members
  add column mood      text check (mood is null or char_length(mood) between 1 and 16),
  add column mood_note text check (mood_note is null or char_length(mood_note) <= 80),
  add column mood_at   timestamptz;

create or replace function public.set_mood(p_conversation_id uuid, p_mood text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_active_user();
  v_mood text := nullif(btrim(coalesce(p_mood, '')), '');
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 80), '');
begin
  if not private.is_conversation_member(p_conversation_id) then
    raise exception 'You are not a member of this conversation' using errcode = '42501';
  end if;
  if v_mood is not null and char_length(v_mood) > 16 then
    raise exception 'Pick a mood from the list' using errcode = '22023';
  end if;
  if v_mood is not null and (
    select count(*) from public.messages
    where sender_id = v_uid and system_event ->> 'type' = 'mood' and created_at > now() - interval '1 hour'
  ) >= 20 then
    raise exception 'You''ve changed your mood a lot — try again later' using errcode = 'PT429';
  end if;

  update public.conversation_members
    set mood = v_mood, mood_note = case when v_mood is null then null else v_note end,
        mood_at = case when v_mood is null then null else now() end
    where conversation_id = p_conversation_id and user_id = v_uid;
  if v_mood is not null then
    perform private.post_system_message(p_conversation_id, v_uid,
      jsonb_build_object('type', 'mood', 'mood', v_mood, 'note', v_note));
  end if;
end;
$$;

create or replace function public.get_moods(p_conversation_id uuid)
returns table (user_id uuid, mood text, mood_note text, mood_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, m.mood, m.mood_note, m.mood_at
  from public.conversation_members m
  where m.conversation_id = p_conversation_id
    and m.left_at is null
    and m.mood is not null
    and m.mood_at > now() - interval '24 hours'
    and private.is_active_user()
    and private.is_conversation_member(p_conversation_id);
$$;

-- -----------------------------------------------------------------------------
-- Notifications also for daily answers and moods.
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
  if v_msg.system_event is not null and coalesce(v_type, '') not in ('nudge', 'date_reminder', 'daily_answered', 'mood') then
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
-- Realtime and grants
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.daily_answers;
  end if;
end;
$$;

revoke execute on function
  public.send_sticker(uuid, uuid, text, jsonb, text),
  public.send_nudge(uuid, text),
  public.answer_daily_question(uuid, date, integer, text),
  public.set_mood(uuid, text, text),
  public.get_moods(uuid)
from public, anon;

grant execute on function
  public.send_sticker(uuid, uuid, text, jsonb, text),
  public.send_nudge(uuid, text),
  public.answer_daily_question(uuid, date, integer, text),
  public.set_mood(uuid, text, text),
  public.get_moods(uuid)
to authenticated;

revoke execute on function public.server_push_targets(uuid, uuid) from public, anon, authenticated;
grant execute on function public.server_push_targets(uuid, uuid) to service_role;
