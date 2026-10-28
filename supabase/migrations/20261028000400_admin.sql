-- =============================================================================
-- 0400 — Administrator RPCs, server-only functions and retention.
--
-- Every admin_* function begins with private.require_admin(), which re-checks
-- the caller's allowlist entry (role = 'admin', status = 'active') on each call.
-- Every state-changing admin action writes an audit log entry.
--
-- Entries with role = 'admin' cannot be modified from the dashboard. Granting
-- or removing administrator rights is done only by the database owner with SQL
-- (supabase/snippets/create_first_admin.sql).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Allowlist management
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_numbers()
returns table (
  id             uuid,
  phone_e164     text,
  label          text,
  role           public.app_role,
  status         public.access_status,
  created_at     timestamptz,
  disabled_at    timestamptz,
  user_id        uuid,
  display_name   text,
  registered_at  timestamptz,
  last_seen_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
    select a.id, a.phone_e164, a.label, a.role, a.status, a.created_at, a.disabled_at,
           p.id, p.display_name, p.created_at, p.last_seen_at
    from public.authorized_phone_numbers a
    left join public.profiles p on p.authorized_phone_id = a.id
    order by a.created_at desc;
end;
$$;

create or replace function public.admin_add_number(p_phone text, p_label text default null)
returns public.authorized_phone_numbers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_admin();
  v_phone text := btrim(coalesce(p_phone, ''));
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_row   public.authorized_phone_numbers;
begin
  if v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'Phone number must be in international format, e.g. +14155550123' using errcode = '22023';
  end if;
  if v_label is not null and char_length(v_label) > 80 then
    raise exception 'Label is too long (max 80 characters)' using errcode = '22001';
  end if;

  insert into public.authorized_phone_numbers (phone_e164, label, role, status, added_by)
  values (v_phone, v_label, 'member', 'active', v_uid)
  on conflict (phone_e164) do nothing
  returning * into v_row;

  if v_row.id is null then
    raise exception 'This number is already on the allowlist' using errcode = '23505';
  end if;

  perform private.write_audit(v_uid, 'admin.number_added', 'authorized_phone_number', v_row.id::text,
    jsonb_build_object('phone', private.mask_phone(v_phone)));
  return v_row;
end;
$$;

create or replace function public.admin_set_number_status(p_id uuid, p_status public.access_status)
returns public.authorized_phone_numbers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_admin();
  v_row  public.authorized_phone_numbers;
  v_user uuid;
begin
  select * into v_row from public.authorized_phone_numbers where id = p_id for update;
  if not found then
    raise exception 'Allowlist entry not found' using errcode = 'P0002';
  end if;
  if v_row.role = 'admin' then
    raise exception 'Administrator entries can only be changed by the database owner' using errcode = '42501';
  end if;
  if v_row.status = p_status then
    return v_row;
  end if;

  update public.authorized_phone_numbers
    set status = p_status,
        disabled_at = case when p_status = 'disabled' then now() else null end
    where id = p_id
    returning * into v_row;

  select id into v_user from public.profiles where authorized_phone_id = p_id;
  if p_status = 'disabled' and v_user is not null then
    perform private.revoke_user_sessions(v_user);
  end if;

  perform private.write_audit(v_uid,
    case when p_status = 'disabled' then 'admin.number_disabled' else 'admin.number_enabled' end,
    'authorized_phone_number', p_id::text,
    jsonb_build_object('phone', private.mask_phone(v_row.phone_e164), 'user_id', v_user));
  return v_row;
end;
$$;

create or replace function public.admin_remove_number(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_admin();
  v_row  public.authorized_phone_numbers;
  v_user uuid;
begin
  select * into v_row from public.authorized_phone_numbers where id = p_id for update;
  if not found then
    raise exception 'Allowlist entry not found' using errcode = 'P0002';
  end if;
  if v_row.role = 'admin' then
    raise exception 'Administrator entries can only be changed by the database owner' using errcode = '42501';
  end if;

  select id into v_user from public.profiles where authorized_phone_id = p_id;
  delete from public.authorized_phone_numbers where id = p_id;
  if v_user is not null then
    perform private.revoke_user_sessions(v_user);
  end if;

  perform private.write_audit(v_uid, 'admin.number_removed', 'authorized_phone_number', p_id::text,
    jsonb_build_object('phone', private.mask_phone(v_row.phone_e164), 'user_id', v_user));
end;
$$;

create or replace function public.admin_revoke_sessions(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_admin();
begin
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  perform private.revoke_user_sessions(p_user_id);
  perform private.write_audit(v_uid, 'admin.sessions_revoked', 'user', p_user_id::text, '{}'::jsonb);
end;
$$;

-- Step 1 of deleting an account (step 2 — deleting the auth user and the
-- storage files — needs the service role and runs in the server route
-- /api/admin/users/[id]). Hard-deletes every message the user sent and returns
-- the storage paths of their uploads.
create or replace function public.admin_prepare_user_deletion(p_user_id uuid)
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_admin();
  v_role public.app_role;
begin
  if p_user_id = v_uid then
    raise exception 'You cannot delete your own account from the dashboard' using errcode = '42501';
  end if;
  select a.role into v_role
    from public.profiles p
    left join public.authorized_phone_numbers a on a.id = p.authorized_phone_id
    where p.id = p_user_id;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  if v_role = 'admin' then
    raise exception 'Administrator accounts can only be removed by the database owner' using errcode = '42501';
  end if;

  perform private.revoke_user_sessions(p_user_id);
  perform private.write_audit(v_uid, 'admin.user_deleted', 'user', p_user_id::text, '{}'::jsonb);

  return query
    select a.storage_path from public.attachments a where a.uploader_id = p_user_id
    union
    select o.name from storage.objects o
      where o.bucket_id = 'attachments' and o.owner_id = p_user_id::text;

  delete from public.messages where sender_id = p_user_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Dashboard data (metadata only — never message content)
-- -----------------------------------------------------------------------------
create or replace function public.admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'numbers_total',        (select count(*) from public.authorized_phone_numbers),
    'numbers_active',       (select count(*) from public.authorized_phone_numbers where status = 'active'),
    'numbers_disabled',     (select count(*) from public.authorized_phone_numbers where status = 'disabled'),
    'users_registered',     (select count(*) from public.profiles),
    'users_without_access', (select count(*) from public.profiles p
                               left join public.authorized_phone_numbers a on a.id = p.authorized_phone_id
                               where a.id is null or a.status <> 'active'),
    'conversations',        (select count(*) from public.conversations),
    'messages',             (select count(*) from public.messages where deleted_at is null),
    'messages_24h',         (select count(*) from public.messages where created_at > now() - interval '24 hours'),
    'attachments',          (select count(*) from public.attachments),
    'storage_bytes',        (select coalesce(sum(nullif(o.metadata ->> 'size', '')::bigint), 0)
                               from storage.objects o where o.bucket_id = 'attachments'),
    'oldest_message_at',    (select min(created_at) from public.messages)
  );
end;
$$;

create or replace function public.admin_list_conversations()
returns table (
  id                uuid,
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
      c.id, c.created_at, c.last_message_at,
      (select count(*) from public.messages m where m.conversation_id = c.id and m.deleted_at is null),
      (select count(*) from public.attachments a where a.conversation_id = c.id),
      coalesce((
        select jsonb_agg(jsonb_build_object(
                 'user_id', p.id,
                 'display_name', p.display_name,
                 'phone_e164', p.phone_e164) order by p.phone_e164)
        from public.conversation_members cm
        join public.profiles p on p.id = cm.user_id
        where cm.conversation_id = c.id
      ), '[]'::jsonb)
    from public.conversations c
    order by coalesce(c.last_message_at, c.created_at) desc;
end;
$$;

-- Deletes a conversation (messages and attachment rows cascade) and returns
-- storage paths for the server route to remove from Storage.
create or replace function public.admin_delete_conversation(p_conversation_id uuid)
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_admin();
begin
  if not exists (select 1 from public.conversations where id = p_conversation_id) then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;

  perform private.write_audit(v_uid, 'admin.conversation_deleted', 'conversation', p_conversation_id::text,
    jsonb_build_object('message_count',
      (select count(*) from public.messages where conversation_id = p_conversation_id)));

  return query
    select o.name from storage.objects o
    where o.bucket_id = 'attachments'
      and split_part(o.name, '/', 1) = p_conversation_id::text;

  delete from public.conversations where id = p_conversation_id;
end;
$$;

-- Administrator access to message CONTENT. Disabled by default; only works
-- when app_settings.admin_can_read_messages is TRUE, and every use is audited.
-- Members see a notice in the app whenever this policy is enabled.
create or replace function public.admin_read_conversation_messages(
  p_conversation_id uuid,
  p_limit integer default 200
)
returns setof public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_admin();
begin
  if not (select admin_can_read_messages from public.app_settings) then
    raise exception 'Administrator access to message content is disabled by policy' using errcode = '42501';
  end if;

  perform private.write_audit(v_uid, 'admin.messages_viewed', 'conversation', p_conversation_id::text,
    jsonb_build_object('limit', p_limit));

  return query
    select * from public.messages
    where conversation_id = p_conversation_id
    order by created_at desc
    limit least(greatest(coalesce(p_limit, 200), 1), 500);
end;
$$;

create or replace function public.admin_update_settings(
  p_message_retention_days  integer,
  p_audit_retention_days    integer,
  p_admin_can_read_messages boolean,
  p_attachments_enabled     boolean,
  p_edit_window_minutes     integer
)
returns public.app_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_admin();
  v_old public.app_settings;
  v_new public.app_settings;
begin
  select * into v_old from public.app_settings for update;

  update public.app_settings
    set message_retention_days  = p_message_retention_days,
        audit_retention_days    = p_audit_retention_days,
        admin_can_read_messages = p_admin_can_read_messages,
        attachments_enabled     = p_attachments_enabled,
        edit_window_minutes     = p_edit_window_minutes,
        updated_by              = v_uid
    where id
    returning * into v_new;

  perform private.write_audit(v_uid, 'admin.settings_updated', 'app_settings', null,
    jsonb_build_object(
      'before', to_jsonb(v_old) - 'updated_at' - 'updated_by' - 'id',
      'after',  to_jsonb(v_new) - 'updated_at' - 'updated_by' - 'id'));
  return v_new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Retention
-- -----------------------------------------------------------------------------
-- Hard-deletes messages older than the retention period (only when one is
-- configured), old audit entries and stale rate-limit counters. Returns the
-- storage paths that must be removed through the Storage API (expired
-- attachments plus orphaned uploads older than 24 hours).
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
    select coalesce(array_agg(a.storage_path), '{}') into v_paths
      from public.attachments a
      join public.messages m on m.id = a.message_id
      where m.created_at < now() - make_interval(days => v_settings.message_retention_days);

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
        and not exists (select 1 from public.attachments a where a.storage_path = o2.name)
      limit 1000
    ) o
  ), '{}');

  with deleted as (
    delete from public.audit_logs
    where created_at < now() - make_interval(days => v_settings.audit_retention_days)
    returning 1
  ) select count(*) into v_audit from deleted;

  delete from private.rate_limits where window_start < now() - interval '1 day';

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

create or replace function public.admin_run_retention_purge()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_admin();
begin
  return private.run_retention_purge(v_uid);
end;
$$;

-- -----------------------------------------------------------------------------
-- Server-only functions (service_role). Called by Next.js route handlers.
-- -----------------------------------------------------------------------------
create or replace function public.server_run_retention_purge()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.run_retention_purge(null);
$$;

create or replace function public.server_phone_is_authorized(p_phone text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.authorized_phone_numbers
    where phone_e164 = private.normalize_phone(p_phone) and status = 'active'
  );
$$;

-- Fixed-window rate limiter. Returns TRUE if the hit is allowed.
create or replace function public.server_consume_rate_limit(
  p_key text,
  p_window_seconds integer,
  p_max integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into private.rate_limits (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = private.rate_limits.hits + 1
  returning hits into v_hits;
  return v_hits <= p_max;
end;
$$;

create or replace function public.server_log_event(
  p_action text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_action not in ('auth.otp_requested', 'auth.otp_denied', 'auth.otp_rate_limited',
                      'auth.verify_failed', 'auth.verify_rate_limited') then
    raise exception 'Unsupported event' using errcode = '22023';
  end if;
  perform private.write_audit(null, p_action, 'phone', null, p_metadata);
end;
$$;

create or replace function public.server_mask_phone(p_phone text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select private.mask_phone(p_phone);
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke execute on function
  public.admin_list_numbers(),
  public.admin_add_number(text, text),
  public.admin_set_number_status(uuid, public.access_status),
  public.admin_remove_number(uuid),
  public.admin_revoke_sessions(uuid),
  public.admin_prepare_user_deletion(uuid),
  public.admin_stats(),
  public.admin_list_conversations(),
  public.admin_delete_conversation(uuid),
  public.admin_read_conversation_messages(uuid, integer),
  public.admin_update_settings(integer, integer, boolean, boolean, integer),
  public.admin_run_retention_purge(),
  public.server_run_retention_purge(),
  public.server_phone_is_authorized(text),
  public.server_consume_rate_limit(text, integer, integer),
  public.server_log_event(text, jsonb),
  public.server_mask_phone(text)
from public, anon, authenticated;

-- Admin RPCs are callable by signed-in users; the functions themselves reject
-- anyone who is not an active administrator.
grant execute on function
  public.admin_list_numbers(),
  public.admin_add_number(text, text),
  public.admin_set_number_status(uuid, public.access_status),
  public.admin_remove_number(uuid),
  public.admin_revoke_sessions(uuid),
  public.admin_prepare_user_deletion(uuid),
  public.admin_stats(),
  public.admin_list_conversations(),
  public.admin_delete_conversation(uuid),
  public.admin_read_conversation_messages(uuid, integer),
  public.admin_update_settings(integer, integer, boolean, boolean, integer),
  public.admin_run_retention_purge()
to authenticated;

grant execute on function
  public.server_run_retention_purge(),
  public.server_phone_is_authorized(text),
  public.server_consume_rate_limit(text, integer, integer),
  public.server_log_event(text, jsonb),
  public.server_mask_phone(text)
to service_role;
