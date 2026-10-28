-- =============================================================================
-- 0200 — Access control: allowlist enforcement at sign-up, access helper
-- functions, table privileges and Row Level Security.
--
-- Defence in depth for "only approved numbers":
--   1. public.before_user_created_hook  — Supabase Auth hook. Rejects sign-up
--      of unapproved numbers before any user row exists or SMS is sent.
--   2. private.enforce_allowlist_on_signup — BEFORE INSERT trigger on
--      auth.users. Same check inside the insert transaction, so even if the
--      hook is not configured, no account can exist for an unapproved number.
--   3. RLS on every table calls private.is_active_user(), which re-checks the
--      allowlist on EVERY query. Disabling or removing a number therefore cuts
--      off existing sessions immediately, regardless of JWT lifetime.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- Supabase Auth stores phone numbers as digits without '+'. Normalize to E.164.
create or replace function private.normalize_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_phone is null or regexp_replace(p_phone, '[^0-9]', '', 'g') = '' then null
    else '+' || regexp_replace(p_phone, '[^0-9]', '', 'g')
  end;
$$;

-- Masked phone for audit logs: keeps country prefix hint and last 2 digits.
create or replace function private.mask_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_phone is null then null
    when char_length(p_phone) <= 5 then '***'
    else left(p_phone, 3) || repeat('*', char_length(p_phone) - 5) || right(p_phone, 2)
  end;
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
    join public.authorized_phone_numbers a on a.id = p.authorized_phone_id
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
    join public.authorized_phone_numbers a on a.id = p.authorized_phone_id
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
  v_phone text := private.normalize_phone(event -> 'user' ->> 'phone');
begin
  if v_phone is not null and exists (
    select 1 from public.authorized_phone_numbers
    where phone_e164 = v_phone and status = 'active'
  ) then
    return '{}'::jsonb;
  end if;

  perform private.write_audit(null, 'auth.signup_rejected', 'phone', null,
    jsonb_build_object('phone', private.mask_phone(v_phone), 'source', 'hook'));

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'This phone number is not authorized to use this app.'
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
  v_phone text := private.normalize_phone(new.phone);
begin
  if v_phone is null then
    raise exception 'Only phone sign-up is permitted' using errcode = '42501';
  end if;

  -- FOR SHARE blocks a concurrent disable/remove of this entry until the
  -- sign-up transaction commits, so approval cannot be raced.
  perform 1 from public.authorized_phone_numbers
    where phone_e164 = v_phone and status = 'active'
    for share;

  if not found then
    raise exception 'Phone number is not authorized' using errcode = '42501';
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
  v_phone text := private.normalize_phone(new.phone);
  v_entry public.authorized_phone_numbers;
begin
  select * into v_entry from public.authorized_phone_numbers where phone_e164 = v_phone;

  insert into public.profiles (id, phone_e164, authorized_phone_id, display_name)
  values (new.id, v_phone, v_entry.id, coalesce(v_entry.label, ''));

  perform private.write_audit(new.id, 'auth.account_created', 'user', new.id::text,
    jsonb_build_object('phone', private.mask_phone(v_phone)));
  return new;
end;
$$;

-- Users may not change the phone number on their account: the number IS the
-- identity that the administrator approved.
create or replace function private.prevent_phone_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.phone is not null and old.phone <> ''
     and new.phone is distinct from old.phone then
    raise exception 'Changing the phone number of an account is not permitted' using errcode = '42501';
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

create trigger prevent_phone_change
  before update of phone on auth.users
  for each row execute function private.prevent_phone_change();

-- Re-adding a previously removed number re-links the existing account.
create or replace function private.link_profile_to_allowlist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
    set authorized_phone_id = new.id
    where phone_e164 = new.phone_e164
      and authorized_phone_id is null;
  return new;
end;
$$;

create trigger link_profile_to_allowlist
  after insert on public.authorized_phone_numbers
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
  public.authorized_phone_numbers,
  public.profiles,
  public.conversations,
  public.conversation_members,
  public.messages,
  public.attachments,
  public.app_settings,
  public.audit_logs
from anon, authenticated;

revoke all on table private.rate_limits from public, anon, authenticated;

grant select on table
  public.authorized_phone_numbers,
  public.profiles,
  public.conversations,
  public.conversation_members,
  public.messages,
  public.attachments,
  public.app_settings,
  public.audit_logs
to authenticated;

-- The only direct write an ordinary user can make: their own profile text.
-- Column-level grant — `id`, `phone_e164`, `authorized_phone_id` are not
-- updatable, so a user cannot attach themselves to another allowlist entry.
grant update (display_name, bio) on table public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security — enabled (and forced) on every exposed table.
-- -----------------------------------------------------------------------------
alter table public.authorized_phone_numbers enable row level security;
alter table public.profiles                 enable row level security;
alter table public.conversations            enable row level security;
alter table public.conversation_members     enable row level security;
alter table public.messages                 enable row level security;
alter table public.attachments              enable row level security;
alter table public.app_settings             enable row level security;
alter table public.audit_logs               enable row level security;
alter table private.rate_limits             enable row level security;

-- Allowlist: administrators only (read). Writes only via admin RPCs.
create policy "admins read allowlist"
  on public.authorized_phone_numbers for select to authenticated
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

-- private.rate_limits has RLS enabled and no policies: only service_role
-- (which bypasses RLS) and SECURITY DEFINER functions can touch it.
