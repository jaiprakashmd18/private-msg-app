-- =============================================================================
-- 0900 — Profile & group photos, and access requests.
--
-- Access requests: when someone whose Google account is NOT approved tries to
-- sign in, the before-user-created hook (which receives the Google-verified
-- email) records a request instead of creating an account. Administrators
-- accept (adds the email to the allowlist) or decline it in the dashboard.
-- No account, session or token is ever created for a requester.
--
-- Photos live in a private `avatars` bucket:
--   users/<user_id>/<file>        — written only by that user
--   groups/<conversation_id>/<file> — written only by that group's admins
-- and are readable by active users (shown via short-lived signed URLs).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schema
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column avatar_path text check (avatar_path is null or char_length(avatar_path) <= 300);
alter table public.conversations
  add column avatar_path text check (avatar_path is null or char_length(avatar_path) <= 300);

create type public.request_status as enum ('pending', 'accepted', 'declined');

create table public.access_requests (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null unique check (char_length(email) <= 254 and email = lower(email)),
  display_name       text check (display_name is null or char_length(display_name) <= 120),
  picture_url        text check (picture_url is null or (char_length(picture_url) <= 500 and picture_url like 'https://%')),
  status             public.request_status not null default 'pending',
  attempts           integer not null default 1,
  first_requested_at timestamptz not null default now(),
  last_requested_at  timestamptz not null default now(),
  decided_by         uuid references auth.users (id) on delete set null,
  decided_at         timestamptz
);

create index access_requests_pending_idx on public.access_requests (last_requested_at desc) where status = 'pending';

revoke all on table public.access_requests from anon, authenticated;
grant select on table public.access_requests to authenticated;
alter table public.access_requests enable row level security;

create policy "admins read access requests"
  on public.access_requests for select to authenticated
  using ((select private.is_admin()));

-- -----------------------------------------------------------------------------
-- Sign-up hook: record a request for unapproved Google accounts.
-- -----------------------------------------------------------------------------
create or replace function public.before_user_created_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email    text := private.normalize_email(event -> 'user' ->> 'email');
  v_provider text := event -> 'user' -> 'app_metadata' ->> 'provider';
  v_meta     jsonb := coalesce(event -> 'user' -> 'user_metadata', '{}'::jsonb);
  v_name     text;
  v_picture  text;
begin
  if v_email is not null
     and private.is_allowed_provider(v_provider, (event -> 'user' ->> 'is_anonymous')::boolean)
     and exists (
       select 1 from public.authorized_emails
       where email = v_email and status = 'active'
     ) then
    return '{}'::jsonb;
  end if;

  -- Only Google sign-ins (verified email) can create a request. Requests are
  -- capped so a flood of throwaway accounts can't fill the table.
  if v_email is not null and coalesce(v_provider, '') = 'google' and char_length(v_email) <= 254 then
    v_name := left(nullif(btrim(coalesce(v_meta ->> 'full_name', v_meta ->> 'name', '')), ''), 120);
    v_picture := nullif(v_meta ->> 'avatar_url', '');
    if v_picture is null or v_picture not like 'https://%' or char_length(v_picture) > 500 then
      v_picture := nullif(v_meta ->> 'picture', '');
      if v_picture is not null and (v_picture not like 'https://%' or char_length(v_picture) > 500) then
        v_picture := null;
      end if;
    end if;

    if exists (select 1 from public.access_requests where email = v_email) then
      update public.access_requests
        set attempts = attempts + 1,
            last_requested_at = now(),
            display_name = coalesce(v_name, display_name),
            picture_url = coalesce(v_picture, picture_url)
        where email = v_email;
    elsif (select count(*) from public.access_requests where status = 'pending') < 500 then
      insert into public.access_requests (email, display_name, picture_url)
      values (v_email, v_name, v_picture)
      on conflict (email) do nothing;
    end if;
  end if;

  perform private.write_audit(null, 'auth.signup_rejected', 'email', null,
    jsonb_build_object('email', private.mask_email(v_email), 'provider', v_provider, 'source', 'hook'));

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'This Google account is not authorized to use this app. An access request was sent to the administrator.'
    )
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Admin: requests
-- -----------------------------------------------------------------------------
create or replace function public.admin_accept_request(p_request_id uuid, p_label text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_admin();
  v_req public.access_requests;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
begin
  select * into v_req from public.access_requests where id = p_request_id for update;
  if not found then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if v_label is not null and char_length(v_label) > 80 then
    raise exception 'Label is too long (max 80 characters)' using errcode = '22001';
  end if;

  insert into public.authorized_emails (email, label, role, status, added_by)
  values (v_req.email, coalesce(v_label, left(v_req.display_name, 80)), 'member', 'active', v_uid)
  on conflict (email) do update
    set status = 'active', disabled_at = null
    where public.authorized_emails.role = 'member';

  update public.access_requests
    set status = 'accepted', decided_by = v_uid, decided_at = now()
    where id = p_request_id;

  perform private.write_audit(v_uid, 'admin.request_accepted', 'access_request', p_request_id::text,
    jsonb_build_object('email', private.mask_email(v_req.email)));
end;
$$;

create or replace function public.admin_decline_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_admin();
  v_req public.access_requests;
begin
  update public.access_requests
    set status = 'declined', decided_by = v_uid, decided_at = now()
    where id = p_request_id
    returning * into v_req;
  if v_req.id is null then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  perform private.write_audit(v_uid, 'admin.request_declined', 'access_request', p_request_id::text,
    jsonb_build_object('email', private.mask_email(v_req.email)));
end;
$$;

create or replace function public.admin_pending_request_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.is_admin()
    then (select count(*)::integer from public.access_requests where status = 'pending')
    else 0 end;
$$;

-- -----------------------------------------------------------------------------
-- Photos
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "avatars: active users read"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (select private.is_active_user()));

create policy "avatars: own photo or group admin upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (select private.is_active_user())
    and (
      (split_part(name, '/', 1) = 'users' and split_part(name, '/', 2) = (select auth.uid())::text)
      or (split_part(name, '/', 1) = 'groups'
          and private.is_group_admin(private.try_uuid(split_part(name, '/', 2))))
    )
    and split_part(name, '/', 3) <> ''
  );

create policy "avatars: own photo or group admin delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (select private.is_active_user())
    and (
      (split_part(name, '/', 1) = 'users' and split_part(name, '/', 2) = (select auth.uid())::text)
      or (split_part(name, '/', 1) = 'groups'
          and private.is_group_admin(private.try_uuid(split_part(name, '/', 2))))
    )
  );

-- Sets (or clears, with NULL) the caller's profile photo.
create or replace function public.set_avatar(p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_user();
begin
  if p_path is not null and (
       split_part(p_path, '/', 1) <> 'users'
    or split_part(p_path, '/', 2) <> v_uid::text
    or not exists (select 1 from storage.objects o where o.bucket_id = 'avatars' and o.name = p_path)
  ) then
    raise exception 'Invalid photo' using errcode = '22023';
  end if;
  update public.profiles set avatar_path = p_path where id = v_uid;
end;
$$;

-- Sets (or clears) a group's photo. Group admins only.
create or replace function public.set_group_avatar(p_conversation_id uuid, p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_user();
begin
  if not private.is_group_admin(p_conversation_id) then
    raise exception 'Only group admins can change the group photo' using errcode = '42501';
  end if;
  if p_path is not null and (
       split_part(p_path, '/', 1) <> 'groups'
    or split_part(p_path, '/', 2) <> p_conversation_id::text
    or not exists (select 1 from storage.objects o where o.bucket_id = 'avatars' and o.name = p_path)
  ) then
    raise exception 'Invalid photo' using errcode = '22023';
  end if;
  update public.conversations set avatar_path = p_path where id = p_conversation_id;
  perform private.post_system_message(p_conversation_id, v_uid,
    jsonb_build_object('type', case when p_path is null then 'photo_removed' else 'photo_changed' end));
end;
$$;

-- -----------------------------------------------------------------------------
-- Functions that now also return photos
-- -----------------------------------------------------------------------------
drop function public.my_access();
create or replace function public.my_access()
returns table (
  user_id       uuid,
  email         text,
  display_name  text,
  bio           text,
  avatar_path   text,
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
    p.avatar_path,
    coalesce(a.status = 'active', false),
    case when a.status = 'active' then a.role end
  from public.profiles p
  left join public.authorized_emails a on a.id = p.authorized_email_id
  where p.id = (select auth.uid());
$$;

drop function public.list_directory();
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
    from public.profiles p
    join public.authorized_emails a on a.id = p.authorized_email_id
    where a.status = 'active' and p.id <> v_uid
    order by lower(nullif(p.display_name, '')) nulls last, p.email;
end;
$$;

drop function public.list_conversations();
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


drop function public.list_conversation_members(uuid);
create or replace function public.list_conversation_members(p_conversation_id uuid)
returns table (
  user_id       uuid,
  display_name  text,
  email         text,
  avatar_path   text,
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
    select p.id, p.display_name, p.email, p.avatar_path, m.is_admin, private.user_is_active(p.id), p.last_seen_at, m.joined_at, m.left_at
    from public.conversation_members m
    join public.profiles p on p.id = m.user_id
    where m.conversation_id = p_conversation_id
    order by (m.left_at is null) desc, m.is_admin desc, lower(nullif(p.display_name, '')) nulls last, p.email;
end;
$$;


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

  delete from public.access_requests
    where status <> 'pending' and decided_at < now() - interval '90 days';

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
-- Grants
-- -----------------------------------------------------------------------------
revoke execute on function
  public.my_access(),
  public.list_directory(),
  public.list_conversations(),
  public.list_conversation_members(uuid),
  public.set_avatar(text),
  public.set_group_avatar(uuid, text),
  public.admin_accept_request(uuid, text),
  public.admin_decline_request(uuid),
  public.admin_pending_request_count()
from public, anon;

grant execute on function
  public.my_access(),
  public.list_directory(),
  public.list_conversations(),
  public.list_conversation_members(uuid),
  public.set_avatar(text),
  public.set_group_avatar(uuid, text),
  public.admin_accept_request(uuid, text),
  public.admin_decline_request(uuid),
  public.admin_pending_request_count()
to authenticated;

revoke execute on function public.before_user_created_hook(jsonb) from public, anon, authenticated;
