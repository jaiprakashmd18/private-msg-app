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
