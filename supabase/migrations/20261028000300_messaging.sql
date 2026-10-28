-- =============================================================================
-- 0300 — Messaging RPCs
--
-- All writes to conversations, members, messages and attachments go through
-- these SECURITY DEFINER functions. Each one starts with
-- private.require_active_user(), checks membership explicitly, validates input
-- and only then writes. Ordinary users have no INSERT/UPDATE/DELETE privilege
-- on these tables at all (see 0200), so the RPCs are the only write path.
-- =============================================================================

alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Session / directory
-- -----------------------------------------------------------------------------

-- Who am I, and do I currently have access? Works for revoked users too, so the
-- app can route them to the "unauthorized" screen.
create or replace function public.my_access()
returns table (
  user_id       uuid,
  email    text,
  display_name  text,
  bio           text,
  is_active     boolean,
  role          public.app_role
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.email,
    p.display_name,
    p.bio,
    coalesce(a.status = 'active', false),
    case when a.status = 'active' then a.role end
  from public.profiles p
  left join public.authorized_emails a on a.id = p.authorized_email_id
  where p.id = (select auth.uid());
$$;

-- Active users the caller can start a conversation with.
create or replace function public.list_directory()
returns table (id uuid, display_name text, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_user();
begin
  return query
    select p.id, p.display_name, p.email
    from public.profiles p
    join public.authorized_emails a on a.id = p.authorized_email_id
    where a.status = 'active' and p.id <> v_uid
    order by lower(nullif(p.display_name, '')) nulls last, p.email;
end;
$$;

-- -----------------------------------------------------------------------------
-- Conversations
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

  return v_id;
end;
$$;

-- Inbox: one row per conversation with the other participant, last message
-- preview, unread count and receipt watermarks.
create or replace function public.list_conversations()
returns table (
  id                            uuid,
  created_at                    timestamptz,
  other_user_id                 uuid,
  other_display_name            text,
  other_email              text,
  other_is_active               boolean,
  other_last_read_at            timestamptz,
  other_last_delivered_at       timestamptz,
  my_last_read_at               timestamptz,
  last_message_id               uuid,
  last_message_body             text,
  last_message_sender_id        uuid,
  last_message_created_at       timestamptz,
  last_message_deleted          boolean,
  last_message_has_attachments  boolean,
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
      c.created_at,
      o.user_id,
      op.display_name,
      op.email,
      coalesce(oa.status = 'active', false),
      o.last_read_at,
      o.last_delivered_at,
      me.last_read_at,
      lm.id,
      case when lm.deleted_at is null then left(lm.body, 200) else '' end,
      lm.sender_id,
      lm.created_at,
      lm.deleted_at is not null,
      coalesce(exists (select 1 from public.attachments at where at.message_id = lm.id), false),
      (
        select count(*)::integer from public.messages m2
        where m2.conversation_id = c.id
          and m2.sender_id is distinct from v_uid
          and m2.deleted_at is null
          and m2.created_at > coalesce(me.last_read_at, '-infinity'::timestamptz)
      )
    from public.conversation_members me
    join public.conversations c on c.id = me.conversation_id
    left join public.conversation_members o
      on o.conversation_id = c.id and o.user_id <> v_uid
    left join public.profiles op on op.id = o.user_id
    left join public.authorized_emails oa on oa.id = op.authorized_email_id
    left join lateral (
      select m.* from public.messages m
      where m.conversation_id = c.id
      order by m.created_at desc, m.id desc
      limit 1
    ) lm on true
    where me.user_id = v_uid
      and (lm.id is not null or c.created_by = v_uid)
    order by coalesce(c.last_message_at, c.created_at) desc;
end;
$$;

-- -----------------------------------------------------------------------------
-- Messages
-- -----------------------------------------------------------------------------
create or replace function public.send_message(
  p_conversation_id uuid,
  p_client_id       uuid,
  p_body            text,
  p_attachments     jsonb default '[]'::jsonb
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
  v_msg       public.messages;
  v_item      jsonb;
  v_path      text;
  v_meta      jsonb;
  v_size      bigint;
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

  if exists (
    select 1 from public.conversation_members m
    left join public.profiles p on p.id = m.user_id
    left join public.authorized_emails a on a.id = p.authorized_email_id
    where m.conversation_id = p_conversation_id
      and m.user_id <> v_uid
      and a.status is distinct from 'active'
  ) or not exists (
    select 1 from public.conversation_members m
    where m.conversation_id = p_conversation_id and m.user_id <> v_uid
  ) then
    raise exception 'The other participant no longer has access' using errcode = '42501';
  end if;

  if char_length(v_body) > 4000 then
    raise exception 'Message is too long (max 4000 characters)' using errcode = '22001';
  end if;
  if v_body = '' and v_att_count = 0 then
    raise exception 'Message is empty' using errcode = '22023';
  end if;
  if v_att_count > 5 then
    raise exception 'At most 5 attachments per message' using errcode = '22023';
  end if;
  if v_att_count > 0 and not (select attachments_enabled from public.app_settings) then
    raise exception 'Attachments are disabled by the administrator' using errcode = '42501';
  end if;

  -- Flood protection: max 15 messages per 10 seconds per sender.
  if (
    select count(*) from public.messages
    where sender_id = v_uid and created_at > now() - interval '10 seconds'
  ) >= 15 then
    raise exception 'You are sending messages too quickly' using errcode = 'PT429';
  end if;

  insert into public.messages (conversation_id, sender_id, client_id, body)
  values (p_conversation_id, v_uid, p_client_id, v_body)
  on conflict on constraint messages_sender_client_unique do nothing
  returning * into v_msg;

  if v_msg.id is null then
    -- A concurrent retry won the race; return its row.
    select * into v_msg from public.messages
      where sender_id = v_uid and client_id = p_client_id;
    return v_msg;
  end if;

  for v_item in select value from jsonb_array_elements(v_atts) loop
    v_path := v_item ->> 'path';
    if v_path is null
       or split_part(v_path, '/', 1) <> p_conversation_id::text
       or split_part(v_path, '/', 2) <> v_uid::text
       or split_part(v_path, '/', 3) = '' then
      raise exception 'Invalid attachment path' using errcode = '22023';
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
      (message_id, conversation_id, uploader_id, storage_path, file_name, mime_type, size_bytes)
    values (
      v_msg.id, p_conversation_id, v_uid, v_path,
      left(coalesce(nullif(btrim(v_item ->> 'name'), ''), 'file'), 200),
      left(coalesce(v_meta ->> 'mimetype', 'application/octet-stream'), 120),
      v_size
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

-- Edit: sender only, within the configured window, not after deletion.
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
  if not found or v_msg.sender_id is distinct from v_uid
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

-- Delete (for everyone): sender only, any time. Body is wiped, attachment rows
-- removed; returns the storage paths so the client can remove the files.
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
  if not found or v_msg.sender_id is distinct from v_uid
     or not private.is_conversation_member(v_msg.conversation_id) then
    raise exception 'Message not found' using errcode = '42501';
  end if;
  if v_msg.deleted_at is not null then
    return;
  end if;

  update public.messages
    set body = '', deleted_at = now()
    where id = v_msg.id;

  return query
    delete from public.attachments where message_id = v_msg.id
    returning storage_path;
end;
$$;

-- -----------------------------------------------------------------------------
-- Receipts
-- -----------------------------------------------------------------------------
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_user();
begin
  -- Only write when something is actually unread, so repeated calls from an
  -- open conversation don't generate needless updates/realtime events.
  update public.conversation_members cm
    set last_read_at = now(),
        last_delivered_at = now()
    where cm.conversation_id = p_conversation_id
      and cm.user_id = v_uid
      and exists (
        select 1 from public.messages m
        where m.conversation_id = p_conversation_id
          and m.sender_id is distinct from v_uid
          and m.created_at > coalesce(cm.last_read_at, '-infinity'::timestamptz)
      );
end;
$$;

-- Called when the app is open: everything that reached this device is delivered.
create or replace function public.mark_all_delivered()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_user();
begin
  update public.conversation_members cm
    set last_delivered_at = now()
    where cm.user_id = v_uid
      and exists (
        select 1 from public.messages m
        where m.conversation_id = cm.conversation_id
          and m.sender_id is distinct from v_uid
          and m.created_at > coalesce(cm.last_delivered_at, '-infinity'::timestamptz)
      );

  update public.profiles set last_seen_at = now() where id = v_uid;
end;
$$;

-- -----------------------------------------------------------------------------
-- Search (prefix full-text over the caller's own conversations)
-- -----------------------------------------------------------------------------
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
      on cm.conversation_id = m.conversation_id and cm.user_id = v_uid
    where m.deleted_at is null
      and m.search_vector @@ to_tsquery('simple', v_tsq)
    order by m.created_at desc
    limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

-- -----------------------------------------------------------------------------
-- Client-reported audit events (restricted vocabulary).
-- -----------------------------------------------------------------------------
create or replace function public.log_auth_event(p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_action not in ('auth.sign_in', 'auth.sign_out') then
    raise exception 'Unsupported event' using errcode = '22023';
  end if;
  -- One sign-in/out entry per user per minute is plenty; ignore spam.
  if exists (
    select 1 from public.audit_logs
    where actor_id = v_uid and action = p_action and created_at > now() - interval '1 minute'
  ) then
    return;
  end if;
  perform private.write_audit(v_uid, p_action, 'user', v_uid::text, '{}'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke execute on function
  public.my_access(),
  public.list_directory(),
  public.get_or_create_direct_conversation(uuid),
  public.list_conversations(),
  public.send_message(uuid, uuid, text, jsonb),
  public.edit_message(uuid, text),
  public.delete_message(uuid),
  public.mark_conversation_read(uuid),
  public.mark_all_delivered(),
  public.search_messages(text, integer),
  public.log_auth_event(text)
from public, anon;

grant execute on function
  public.my_access(),
  public.list_directory(),
  public.get_or_create_direct_conversation(uuid),
  public.list_conversations(),
  public.send_message(uuid, uuid, text, jsonb),
  public.edit_message(uuid, text),
  public.delete_message(uuid),
  public.mark_conversation_read(uuid),
  public.mark_all_delivered(),
  public.search_messages(text, integer),
  public.log_auth_event(text)
to authenticated;
