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

-- Adding an email to the allowlist (re-)links the matching account:
--  * a previously removed email re-links the existing profile;
--  * a Google login that exists without a profile (e.g. the person signed in
--    before the database setup was run) gets its profile created now.
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

  insert into public.profiles (id, email, authorized_email_id, display_name)
  select u.id, new.email, new.id,
         left(coalesce(nullif(btrim(new.label), ''),
                       nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
                       nullif(btrim(u.raw_user_meta_data ->> 'name'), ''), ''), 60)
    from auth.users u
    where private.normalize_email(u.email) = new.email
      and private.is_allowed_provider(u.raw_app_meta_data ->> 'provider', u.is_anonymous)
      and not exists (select 1 from public.profiles p where p.id = u.id or p.email = new.email)
    limit 1;
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
