-- =============================================================================
-- ONE-TIME SETUP: creates all tables, security rules, functions and the
-- attachments bucket. This is the six files in supabase/migrations/ combined,
-- in order, so you can paste everything into the Supabase SQL Editor at once.
--
-- Run it ONCE on a NEW, EMPTY Supabase project. (If you see "already exists"
-- errors, it has already been run on this project.)
-- Then run supabase/snippets/create_first_admin.sql with your Gmail address.
-- =============================================================================


-- >>>>> 20261028000100_schema.sql
-- =============================================================================
-- 0100 — Core schema
--
-- Tables live in `public` (exposed through the Supabase Data API, protected by
-- RLS in 0200). Internal helpers and bookkeeping live in `private`, which is NOT
-- exposed through the Data API.
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.app_role as enum ('member', 'admin');
create type public.access_status as enum ('active', 'disabled');

-- -----------------------------------------------------------------------------
-- Shared trigger: maintain updated_at
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- authorized_emails — the allowlist. The single source of truth for
-- whether a Google account (by email address) may use the app and with which
-- role. Emails are stored lower-cased.
-- Roles can only be changed with SQL by the database owner (see
-- supabase/snippets/create_first_admin.sql); no API path changes `role`.
-- -----------------------------------------------------------------------------
create table public.authorized_emails (
  id           uuid primary key default gen_random_uuid(),
  email        text not null unique
                 check (char_length(email) <= 254
                        and email = lower(email)
                        and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  label        text check (label is null or char_length(label) <= 80),
  role         public.app_role not null default 'member',
  status       public.access_status not null default 'active',
  added_by     uuid references auth.users (id) on delete set null,
  disabled_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger authorized_emails_updated_at
  before update on public.authorized_emails
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- profiles — one per auth user. Created automatically by the auth trigger in
-- 0200. `authorized_email_id` links to the allowlist entry; when the entry is
-- removed the link becomes NULL and the user loses access everywhere.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  authorized_email_id  uuid unique references public.authorized_emails (id) on delete set null,
  email                text not null unique,
  display_name         text not null default ''
                         check (char_length(display_name) <= 60),
  bio                  text not null default ''
                         check (char_length(bio) <= 280),
  last_seen_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- conversations — currently one-to-one ("direct") only. `direct_key` is the two
-- member ids sorted and joined, so there is exactly one conversation per pair.
-- -----------------------------------------------------------------------------
create table public.conversations (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null default 'direct' check (kind in ('direct')),
  direct_key       text unique,
  created_by       uuid references public.profiles (id) on delete set null,
  last_message_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index conversations_last_message_at_idx
  on public.conversations (last_message_at desc nulls last);

create trigger conversations_updated_at
  before update on public.conversations
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- conversation_members — membership plus per-member read/delivery watermarks.
--
-- Receipts design: instead of one receipt row per message per recipient, each
-- member stores `last_delivered_at` and `last_read_at`. A message is
-- delivered/read for a member when its created_at <= that watermark. This is
-- O(1) per conversation, gives exact unread counts with one indexed range
-- count, and is what "message_receipts" would be used for in a 1:1 app.
-- -----------------------------------------------------------------------------
create table public.conversation_members (
  conversation_id    uuid not null references public.conversations (id) on delete cascade,
  user_id            uuid not null references public.profiles (id) on delete cascade,
  joined_at          timestamptz not null default now(),
  last_delivered_at  timestamptz,
  last_read_at       timestamptz,
  primary key (conversation_id, user_id)
);

create index conversation_members_user_idx
  on public.conversation_members (user_id, conversation_id);

-- -----------------------------------------------------------------------------
-- messages
--   client_id   — generated by the sender's device; unique per sender, so a
--                 retried request can never create a duplicate message.
--   deleted_at  — soft delete; body is wiped, row kept so the thread shows
--                 "message deleted" consistently on every device.
-- -----------------------------------------------------------------------------
create table public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  sender_id        uuid references public.profiles (id) on delete set null,
  client_id        uuid not null,
  body             text not null default '' check (char_length(body) <= 4000),
  created_at       timestamptz not null default now(),
  edited_at        timestamptz,
  deleted_at       timestamptz,
  search_vector    tsvector generated always as (to_tsvector('simple', body)) stored,
  constraint messages_sender_client_unique unique (sender_id, client_id)
);

create index messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc, id desc);
create index messages_sender_created_idx
  on public.messages (sender_id, created_at desc);
create index messages_created_idx
  on public.messages (created_at);
create index messages_search_idx
  on public.messages using gin (search_vector);

-- -----------------------------------------------------------------------------
-- attachments — metadata for files stored in the private `attachments`
-- Storage bucket under `<conversation_id>/<uploader_id>/<uuid>-<name>`.
-- -----------------------------------------------------------------------------
create table public.attachments (
  id               uuid primary key default gen_random_uuid(),
  message_id       uuid not null references public.messages (id) on delete cascade,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  uploader_id      uuid references public.profiles (id) on delete set null,
  storage_path     text not null unique,
  file_name        text not null check (char_length(file_name) between 1 and 200),
  mime_type        text not null check (char_length(mime_type) <= 120),
  size_bytes       bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  created_at       timestamptz not null default now()
);

create index attachments_message_idx on public.attachments (message_id);
create index attachments_conversation_idx on public.attachments (conversation_id);

-- -----------------------------------------------------------------------------
-- app_settings — single-row configuration managed from the admin dashboard.
--   message_retention_days   NULL = keep forever (default). Messages are only
--                            purged when an administrator sets this.
--   admin_can_read_messages  FALSE by default. When TRUE, administrators can
--                            read conversation content via an audited RPC.
-- -----------------------------------------------------------------------------
create table public.app_settings (
  id                       boolean primary key default true check (id),
  message_retention_days   integer check (message_retention_days is null
                                          or message_retention_days between 1 and 3650),
  audit_retention_days     integer not null default 365
                             check (audit_retention_days between 30 and 3650),
  admin_can_read_messages  boolean not null default false,
  attachments_enabled      boolean not null default true,
  edit_window_minutes      integer not null default 15
                             check (edit_window_minutes between 0 and 1440),
  updated_by               uuid references auth.users (id) on delete set null,
  updated_at               timestamptz not null default now()
);

insert into public.app_settings (id) values (true);

create trigger app_settings_updated_at
  before update on public.app_settings
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- audit_logs — append-only. Written exclusively by SECURITY DEFINER functions.
-- Email addresses are stored masked; message content is never written here.
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id           bigint generated always as identity primary key,
  actor_id     uuid references auth.users (id) on delete set null,
  action       text not null check (char_length(action) <= 64),
  target_type  text check (target_type is null or char_length(target_type) <= 64),
  target_id    text check (target_id is null or char_length(target_id) <= 128),
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_action_idx on public.audit_logs (action, created_at desc);

-- >>>>> 20261028000200_access_control.sql
-- =============================================================================
-- 0200 — Access control: allowlist enforcement at sign-up, access helper
-- functions, table privileges and Row Level Security.
--
-- Sign-in is "Sign in with Google" only. Defence in depth for "only approved
-- Google accounts":
--   1. public.before_user_created_hook  — Supabase Auth hook. Rejects sign-up
--      of non-Google or unapproved accounts before any user row exists.
--   2. private.enforce_allowlist_on_signup — BEFORE INSERT trigger on
--      auth.users. Same check inside the insert transaction, so even if the
--      hook is not configured, no account can exist for an unapproved email.
--   3. RLS on every table calls private.is_active_user(), which re-checks the
--      allowlist on EVERY query. Disabling or removing an email therefore cuts
--      off existing sessions immediately, regardless of JWT lifetime.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

create or replace function private.normalize_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(lower(btrim(coalesce(p_email, ''))), '');
$$;

-- Masked email for audit logs: first 2 characters of the name + domain.
create or replace function private.mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is null then null
    when position('@' in p_email) = 0 then '***'
    else left(split_part(p_email, '@', 1), 2) || '***@' || split_part(p_email, '@', 2)
  end;
$$;

-- Only Google accounts may sign up. Email/password, magic link, phone and
-- anonymous sign-ups are refused even if someone enables them by mistake.
create or replace function private.is_allowed_provider(p_provider text, p_is_anonymous boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_provider, 'google') = 'google' and not coalesce(p_is_anonymous, false);
$$;

create or replace function private.try_uuid(p_text text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end;
$$;

create or replace function private.write_audit(
  p_actor uuid,
  p_action text,
  p_target_type text default null,
  p_target_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (actor_id, action, target_type, target_id, metadata)
  values (p_actor, p_action, p_target_type, p_target_id, coalesce(p_metadata, '{}'::jsonb));
$$;

-- TRUE when the current JWT belongs to a user whose allowlist entry exists and
-- is active. Evaluated on every RLS check — this is what makes revocation
-- immediate for existing sessions.
create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.authorized_emails a on a.id = p.authorized_email_id
    where p.id = (select auth.uid())
      and a.status = 'active'
  );
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.authorized_emails a on a.id = p.authorized_email_id
    where p.id = (select auth.uid())
      and a.status = 'active'
      and a.role = 'admin'
  );
$$;

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
  );
$$;

-- Raises unless the caller is an active user. Used at the top of RPCs.
create or replace function private.require_active_user()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not private.is_active_user() then
    raise exception 'Access revoked or not authorized' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create or replace function private.require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_user();
begin
  if not private.is_admin() then
    raise exception 'Administrator privileges required' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

grant usage on schema private to authenticated, service_role;
revoke all on all functions in schema private from public, anon;
grant execute on function
  private.is_active_user(),
  private.is_admin(),
  private.is_conversation_member(uuid),
  private.try_uuid(text)
to authenticated;
grant execute on all functions in schema private to service_role;

-- -----------------------------------------------------------------------------
-- Auth hook: before user created (configured in Dashboard → Auth → Hooks, and
-- in supabase/config.toml for local development).
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
begin
  if v_email is not null
     and private.is_allowed_provider(v_provider, (event -> 'user' ->> 'is_anonymous')::boolean)
     and exists (
       select 1 from public.authorized_emails
       where email = v_email and status = 'active'
     ) then
    return '{}'::jsonb;
  end if;

  perform private.write_audit(null, 'auth.signup_rejected', 'email', null,
    jsonb_build_object('email', private.mask_email(v_email), 'provider', v_provider, 'source', 'hook'));

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'This Google account is not authorized to use this app.'
    )
  );
end;
$$;

revoke execute on function public.before_user_created_hook(jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant execute on function public.before_user_created_hook(jsonb) to supabase_auth_admin';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- auth.users triggers
-- -----------------------------------------------------------------------------
create or replace function private.enforce_allowlist_on_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := private.normalize_email(new.email);
begin
  if v_email is null
     or not private.is_allowed_provider(new.raw_app_meta_data ->> 'provider', new.is_anonymous) then
    raise exception 'Only Google sign-in is permitted' using errcode = '42501';
  end if;

  -- FOR SHARE blocks a concurrent disable/remove of this entry until the
  -- sign-up transaction commits, so approval cannot be raced.
  perform 1 from public.authorized_emails
    where email = v_email and status = 'active'
    for share;

  if not found then
    raise exception 'This Google account is not authorized' using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function private.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := private.normalize_email(new.email);
  v_entry public.authorized_emails;
  v_name  text;
begin
  select * into v_entry from public.authorized_emails where email = v_email;

  -- Prefer the admin's label, then the name from the Google profile.
  v_name := left(coalesce(
    nullif(btrim(v_entry.label), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    ''
  ), 60);

  insert into public.profiles (id, email, authorized_email_id, display_name)
  values (new.id, v_email, v_entry.id, v_name);

  perform private.write_audit(new.id, 'auth.account_created', 'user', new.id::text,
    jsonb_build_object('email', private.mask_email(v_email)));
  return new;
end;
$$;

-- Users may not change the email on their account: the Google address IS the
-- identity that the administrator approved.
create or replace function private.prevent_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.email is not null and old.email <> ''
     and private.normalize_email(new.email) is distinct from private.normalize_email(old.email) then
    raise exception 'Changing the email of an account is not permitted' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger enforce_allowlist_on_signup
  before insert on auth.users
  for each row execute function private.enforce_allowlist_on_signup();

create trigger create_profile_for_new_user
  after insert on auth.users
  for each row execute function private.create_profile_for_new_user();

create trigger prevent_email_change
  before update of email on auth.users
  for each row execute function private.prevent_email_change();

-- Re-adding a previously removed email re-links the existing account.
create or replace function private.link_profile_to_allowlist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
    set authorized_email_id = new.id
    where email = new.email
      and authorized_email_id is null;
  return new;
end;
$$;

create trigger link_profile_to_allowlist
  after insert on public.authorized_emails
  for each row execute function private.link_profile_to_allowlist();

-- Ends every session (and refresh token) for a user. Access tokens already
-- issued stay cryptographically valid until expiry, but RLS rejects them
-- because private.is_active_user() is false.
create or replace function private.revoke_user_sessions(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from auth.sessions where user_id = p_user_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Table privileges. Supabase grants broad default privileges to `anon` and
-- `authenticated`; remove them and grant only what each table needs.
-- Writes that need business rules go through SECURITY DEFINER RPCs (0300/0400).
-- -----------------------------------------------------------------------------
revoke all on table
  public.authorized_emails,
  public.profiles,
  public.conversations,
  public.conversation_members,
  public.messages,
  public.attachments,
  public.app_settings,
  public.audit_logs
from anon, authenticated;


grant select on table
  public.authorized_emails,
  public.profiles,
  public.conversations,
  public.conversation_members,
  public.messages,
  public.attachments,
  public.app_settings,
  public.audit_logs
to authenticated;

-- The only direct write an ordinary user can make: their own profile text.
-- Column-level grant — `id`, `email`, `authorized_email_id` are not
-- updatable, so a user cannot attach themselves to another allowlist entry.
grant update (display_name, bio) on table public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security — enabled (and forced) on every exposed table.
-- -----------------------------------------------------------------------------
alter table public.authorized_emails enable row level security;
alter table public.profiles                 enable row level security;
alter table public.conversations            enable row level security;
alter table public.conversation_members     enable row level security;
alter table public.messages                 enable row level security;
alter table public.attachments              enable row level security;
alter table public.app_settings             enable row level security;
alter table public.audit_logs               enable row level security;

-- Allowlist: administrators only (read). Writes only via admin RPCs.
create policy "admins read allowlist"
  on public.authorized_emails for select to authenticated
  using ((select private.is_admin()));

-- Profiles: active users can see profiles (names/numbers of the private group);
-- a user can always read their own row (needed to show the unauthorized
-- screen to a revoked user) and update only their own row while active.
create policy "active users read profiles"
  on public.profiles for select to authenticated
  using ((select private.is_active_user()) or id = (select auth.uid()));

create policy "users update own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()) and (select private.is_active_user()))
  with check (id = (select auth.uid()) and (select private.is_active_user()));

-- Conversations / members / messages / attachments: active members only.
create policy "members read conversations"
  on public.conversations for select to authenticated
  using ((select private.is_active_user()) and private.is_conversation_member(id));

create policy "members read memberships"
  on public.conversation_members for select to authenticated
  using ((select private.is_active_user()) and private.is_conversation_member(conversation_id));

create policy "members read messages"
  on public.messages for select to authenticated
  using ((select private.is_active_user()) and private.is_conversation_member(conversation_id));

create policy "members read attachments"
  on public.attachments for select to authenticated
  using ((select private.is_active_user()) and private.is_conversation_member(conversation_id));

-- Settings: readable by active users (edit window, attachments flag).
create policy "active users read settings"
  on public.app_settings for select to authenticated
  using ((select private.is_active_user()));

-- Audit logs: administrators read; nobody writes directly.
create policy "admins read audit logs"
  on public.audit_logs for select to authenticated
  using ((select private.is_admin()));

-- >>>>> 20261028000300_messaging.sql
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

-- >>>>> 20261028000400_admin.sql
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
create or replace function public.admin_list_allowlist()
returns table (
  id             uuid,
  email     text,
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
    select a.id, a.email, a.label, a.role, a.status, a.created_at, a.disabled_at,
           p.id, p.display_name, p.created_at, p.last_seen_at
    from public.authorized_emails a
    left join public.profiles p on p.authorized_email_id = a.id
    order by a.created_at desc;
end;
$$;

create or replace function public.admin_add_email(p_email text, p_label text default null)
returns public.authorized_emails
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_admin();
  v_email text := private.normalize_email(p_email);
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_row   public.authorized_emails;
begin
  if v_email is null or char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address, e.g. name@gmail.com' using errcode = '22023';
  end if;
  if v_label is not null and char_length(v_label) > 80 then
    raise exception 'Label is too long (max 80 characters)' using errcode = '22001';
  end if;

  insert into public.authorized_emails (email, label, role, status, added_by)
  values (v_email, v_label, 'member', 'active', v_uid)
  on conflict (email) do nothing
  returning * into v_row;

  if v_row.id is null then
    raise exception 'This email is already on the allowlist' using errcode = '23505';
  end if;

  perform private.write_audit(v_uid, 'admin.email_added', 'authorized_email', v_row.id::text,
    jsonb_build_object('email', private.mask_email(v_email)));
  return v_row;
end;
$$;

create or replace function public.admin_set_access_status(p_id uuid, p_status public.access_status)
returns public.authorized_emails
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_admin();
  v_row  public.authorized_emails;
  v_user uuid;
begin
  select * into v_row from public.authorized_emails where id = p_id for update;
  if not found then
    raise exception 'Allowlist entry not found' using errcode = 'P0002';
  end if;
  if v_row.role = 'admin' then
    raise exception 'Administrator entries can only be changed by the database owner' using errcode = '42501';
  end if;
  if v_row.status = p_status then
    return v_row;
  end if;

  update public.authorized_emails
    set status = p_status,
        disabled_at = case when p_status = 'disabled' then now() else null end
    where id = p_id
    returning * into v_row;

  select id into v_user from public.profiles where authorized_email_id = p_id;
  if p_status = 'disabled' and v_user is not null then
    perform private.revoke_user_sessions(v_user);
  end if;

  perform private.write_audit(v_uid,
    case when p_status = 'disabled' then 'admin.access_disabled' else 'admin.access_enabled' end,
    'authorized_email', p_id::text,
    jsonb_build_object('email', private.mask_email(v_row.email), 'user_id', v_user));
  return v_row;
end;
$$;

create or replace function public.admin_remove_email(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_admin();
  v_row  public.authorized_emails;
  v_user uuid;
begin
  select * into v_row from public.authorized_emails where id = p_id for update;
  if not found then
    raise exception 'Allowlist entry not found' using errcode = 'P0002';
  end if;
  if v_row.role = 'admin' then
    raise exception 'Administrator entries can only be changed by the database owner' using errcode = '42501';
  end if;

  select id into v_user from public.profiles where authorized_email_id = p_id;
  delete from public.authorized_emails where id = p_id;
  if v_user is not null then
    perform private.revoke_user_sessions(v_user);
  end if;

  perform private.write_audit(v_uid, 'admin.email_removed', 'authorized_email', p_id::text,
    jsonb_build_object('email', private.mask_email(v_row.email), 'user_id', v_user));
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
    left join public.authorized_emails a on a.id = p.authorized_email_id
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
    'allowlist_total',       (select count(*) from public.authorized_emails),
    'allowlist_active',      (select count(*) from public.authorized_emails where status = 'active'),
    'allowlist_disabled',    (select count(*) from public.authorized_emails where status = 'disabled'),
    'users_registered',     (select count(*) from public.profiles),
    'users_without_access', (select count(*) from public.profiles p
                               left join public.authorized_emails a on a.id = p.authorized_email_id
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
                 'email', p.email) order by p.email)
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
-- configured) and old audit entries. Returns the
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
-- Server-only functions (service_role). Called by the Vercel Cron route handler.
-- -----------------------------------------------------------------------------
create or replace function public.server_run_retention_purge()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.run_retention_purge(null);
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke execute on function
  public.admin_list_allowlist(),
  public.admin_add_email(text, text),
  public.admin_set_access_status(uuid, public.access_status),
  public.admin_remove_email(uuid),
  public.admin_revoke_sessions(uuid),
  public.admin_prepare_user_deletion(uuid),
  public.admin_stats(),
  public.admin_list_conversations(),
  public.admin_delete_conversation(uuid),
  public.admin_read_conversation_messages(uuid, integer),
  public.admin_update_settings(integer, integer, boolean, boolean, integer),
  public.admin_run_retention_purge(),
  public.server_run_retention_purge()
from public, anon, authenticated;

-- Admin RPCs are callable by signed-in users; the functions themselves reject
-- anyone who is not an active administrator.
grant execute on function
  public.admin_list_allowlist(),
  public.admin_add_email(text, text),
  public.admin_set_access_status(uuid, public.access_status),
  public.admin_remove_email(uuid),
  public.admin_revoke_sessions(uuid),
  public.admin_prepare_user_deletion(uuid),
  public.admin_stats(),
  public.admin_list_conversations(),
  public.admin_delete_conversation(uuid),
  public.admin_read_conversation_messages(uuid, integer),
  public.admin_update_settings(integer, integer, boolean, boolean, integer),
  public.admin_run_retention_purge()
to authenticated;

grant execute on function public.server_run_retention_purge() to service_role;

-- >>>>> 20261028000500_storage_realtime.sql
-- =============================================================================
-- 0500 — Attachment storage and Realtime
-- =============================================================================

-- Private bucket: files are never publicly addressable; the app requests
-- short-lived signed URLs, which Storage only issues if the SELECT policy
-- below passes for the requesting user. 10 MB hard limit per file.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  10485760,
  array[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic',
    'application/pdf', 'text/plain',
    'application/zip',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Object path layout: <conversation_id>/<uploader_user_id>/<random>-<filename>

-- Upload: active member of the conversation, into their own folder, while
-- attachments are enabled.
create policy "attachments: members upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (select private.is_active_user())
    and (select attachments_enabled from public.app_settings)
    and private.is_conversation_member(private.try_uuid(split_part(name, '/', 1)))
    and split_part(name, '/', 2) = (select auth.uid())::text
  );

-- Download: active member of the conversation, and either the file is attached
-- to a message, or it is the uploader's own pending upload.
create policy "attachments: members read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and (select private.is_active_user())
    and private.is_conversation_member(private.try_uuid(split_part(name, '/', 1)))
    and (
      exists (select 1 from public.attachments a where a.storage_path = name)
      or split_part(name, '/', 2) = (select auth.uid())::text
    )
  );

-- Delete: uploaders remove their own files (used after deleting a message).
create policy "attachments: uploader deletes own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (select private.is_active_user())
    and split_part(name, '/', 2) = (select auth.uid())::text
  );

-- No UPDATE policy: files cannot be overwritten after upload.

-- -----------------------------------------------------------------------------
-- Realtime (Postgres Changes). Realtime evaluates the table's SELECT RLS
-- policy for every subscriber on every change, so users only receive events
-- for conversations they belong to, and a revoked user stops receiving
-- events immediately.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.conversation_members;
  end if;
end;
$$;

-- >>>>> 20261028000600_access_token_hook.sql
-- =============================================================================
-- 0600 — Custom Access Token hook (Dashboard → Authentication → Hooks).
--
-- Supabase Auth calls this every time it issues or refreshes an access token.
-- Users whose allowlist entry is missing or disabled get no token at all, so a
-- revoked user can neither sign in again nor keep refreshing an old session.
-- (RLS independently denies access for any token that already exists.)
-- =============================================================================
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.try_uuid(event ->> 'user_id');
begin
  if v_user_id is null or not exists (
    select 1
    from public.profiles p
    join public.authorized_emails a on a.id = p.authorized_email_id
    where p.id = v_user_id and a.status = 'active'
  ) then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'This Google account does not currently have access to this app.'
      )
    );
  end if;

  return jsonb_build_object('claims', event -> 'claims');
end;
$$;

revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin';
  end if;
end;
$$;
