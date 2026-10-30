-- =============================================================================
-- UPDATE: sign in with email + password.
--
-- Run ONCE on a project that was set up before this update, AFTER the
-- earlier update files (update_push_notifications.sql, update_chat_features.sql,
-- then update_photos_and_requests.sql) if you haven't run those yet.
-- New projects don't need it (setup_all.sql has everything).
-- Paste into Supabase → SQL Editor → New query → Run.
-- =============================================================================

-- =============================================================================
-- 1000 — Email + password sign-in.
--
-- Password accounts are created (or reset) only by an administrator, through
-- the server with the service role. Public "sign up with a password" stays
-- impossible: the auth.users trigger accepts a new `email` account only when
-- admin_prepare_password() left a one-time grant for that exact email less
-- than a minute earlier (the server creates the account immediately after).
-- The email must still be on the allowlist and active.
--
-- An administrator-set password is temporary: until the member picks their
-- own (the stored hash changes), my_access() reports must_change_password and
-- the app sends them to /set-password.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Which new auth.users rows are acceptable.
-- -----------------------------------------------------------------------------
create table private.password_account_grants (
  email       text primary key,
  expires_at  timestamptz not null
);

-- Existing rows only ever got in through the trigger below.
create or replace function private.is_allowed_signup(p_app_meta jsonb, p_is_anonymous boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not coalesce(p_is_anonymous, false)
     and coalesce(p_app_meta ->> 'provider', 'google') in ('google', 'email');
$$;

create or replace function private.enforce_allowlist_on_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email    text := private.normalize_email(new.email);
  v_provider text := coalesce(new.raw_app_meta_data ->> 'provider', 'google');
begin
  if v_email is null
     or coalesce(new.is_anonymous, false)
     or v_provider not in ('google', 'email') then
    raise exception 'Only Google sign-in or an administrator-created password account is permitted'
      using errcode = '42501';
  end if;

  if v_provider = 'email' then
    delete from private.password_account_grants g
      where g.email = v_email and g.expires_at > now();
    if not found then
      raise exception 'Only Google sign-in or an administrator-created password account is permitted'
        using errcode = '42501';
    end if;
  end if;

  -- FOR SHARE blocks a concurrent disable/remove of this entry until the
  -- sign-up transaction commits, so approval cannot be raced.
  perform 1 from public.authorized_emails
    where email = v_email and status = 'active'
    for share;

  if not found then
    raise exception 'This account is not authorized' using errcode = '42501';
  end if;

  return new;
end;
$$;

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
      and private.is_allowed_signup(u.raw_app_meta_data, u.is_anonymous)
      and not exists (select 1 from public.profiles p where p.id = u.id or p.email = new.email)
    limit 1;
  return new;
end;
$$;

-- The sign-up hook lets an approved email through for Google or email
-- accounts; the trigger above makes the final call on email accounts (only
-- administrator-created ones). Unapproved Google sign-ins still become
-- access requests.
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
     and coalesce(v_provider, 'google') in ('google', 'email')
     and not coalesce((event -> 'user' ->> 'is_anonymous')::boolean, false)
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
        'message', 'This account does not currently have access to this app.'
      )
    );
  end if;

  return jsonb_build_object('claims', event -> 'claims');
end;
$$;

-- -----------------------------------------------------------------------------
-- Passwords set by an administrator (temporary until the member changes it).
-- -----------------------------------------------------------------------------
create table private.admin_set_passwords (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  password_hash  text not null,
  set_by         uuid references auth.users (id) on delete set null,
  set_at         timestamptz not null default now()
);

create or replace function private.must_change_password(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.admin_set_passwords t
    join auth.users u on u.id = t.user_id
    where t.user_id = p_user_id and t.password_hash = u.encrypted_password
  );
$$;

-- Step 1 (as the admin): checks the entry and returns the existing account,
-- if any. Administrator entries can't be changed from the dashboard.
create or replace function public.admin_prepare_password(p_entry_id uuid)
returns table (user_id uuid, email text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.authorized_emails;
begin
  perform private.require_admin();
  select * into v_entry from public.authorized_emails a where a.id = p_entry_id;
  if not found then
    raise exception 'Email not found' using errcode = 'P0002';
  end if;
  if v_entry.role = 'admin' then
    raise exception 'Administrator entries can only be changed by the database owner' using errcode = '42501';
  end if;
  if v_entry.status <> 'active' then
    raise exception 'Re-enable this email before setting a password' using errcode = '22023';
  end if;
  return query
    select u.id, v_entry.email
    from auth.users u
    where private.normalize_email(u.email) = v_entry.email
    order by u.created_at
    limit 1;
  if not found then
    -- Lets the server create this one password account in the next minute.
    insert into private.password_account_grants (email, expires_at)
    values (v_entry.email, now() + interval '1 minute')
    on conflict on constraint password_account_grants_pkey do update set expires_at = excluded.expires_at;
    delete from private.password_account_grants g where g.expires_at < now() - interval '1 day';
    return query select null::uuid, v_entry.email;
  end if;
end;
$$;

-- Step 2 (server, service role, after Supabase Auth stored the password):
-- remembers the hash so the member must replace it, signs the account out
-- everywhere, and audits the change.
create or replace function public.server_record_admin_password(p_user_id uuid, p_admin_id uuid, p_created boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash  text;
  v_email text;
begin
  select u.encrypted_password, private.normalize_email(u.email) into v_hash, v_email
    from auth.users u where u.id = p_user_id;
  if v_hash is null or v_hash = '' then
    raise exception 'No password stored for this account' using errcode = '22023';
  end if;

  insert into private.admin_set_passwords (user_id, password_hash, set_by, set_at)
  values (p_user_id, v_hash, p_admin_id, now())
  on conflict (user_id) do update
    set password_hash = excluded.password_hash, set_by = excluded.set_by, set_at = excluded.set_at;

  if not p_created then
    perform private.revoke_user_sessions(p_user_id);
  end if;

  perform private.write_audit(p_admin_id, case when p_created then 'admin.password_account_created' else 'admin.password_reset' end,
    'user', p_user_id::text, jsonb_build_object('email', private.mask_email(v_email)));
end;
$$;

-- -----------------------------------------------------------------------------
-- my_access(): sign-in methods and the "choose your own password" flag.
-- -----------------------------------------------------------------------------
drop function public.my_access();
create or replace function public.my_access()
returns table (
  user_id               uuid,
  email                 text,
  display_name          text,
  bio                   text,
  avatar_path           text,
  is_active             boolean,
  role                  public.app_role,
  has_password          boolean,
  has_google            boolean,
  must_change_password  boolean
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
    case when a.status = 'active' then a.role end,
    coalesce(u.encrypted_password, '') <> '',
    coalesce(u.raw_app_meta_data -> 'providers', jsonb_build_array(u.raw_app_meta_data ->> 'provider')) ? 'google',
    private.must_change_password(p.id)
  from public.profiles p
  left join public.authorized_emails a on a.id = p.authorized_email_id
  left join auth.users u on u.id = p.id
  where p.id = (select auth.uid());
$$;

drop function public.admin_list_allowlist();
create or replace function public.admin_list_allowlist()
returns table (
  id               uuid,
  email            text,
  label            text,
  role             public.app_role,
  status           public.access_status,
  created_at       timestamptz,
  disabled_at      timestamptz,
  user_id          uuid,
  display_name     text,
  registered_at    timestamptz,
  last_seen_at     timestamptz,
  has_password     boolean,
  password_pending boolean
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
           p.id, p.display_name, p.created_at, p.last_seen_at,
           coalesce(u.encrypted_password, '') <> '',
           coalesce(private.must_change_password(p.id), false)
    from public.authorized_emails a
    left join public.profiles p on p.authorized_email_id = a.id
    left join auth.users u on u.id = p.id
    order by a.created_at desc;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke execute on function
  public.my_access(),
  public.admin_list_allowlist(),
  public.admin_prepare_password(uuid),
  public.server_record_admin_password(uuid, uuid, boolean)
from public, anon;
revoke execute on function public.server_record_admin_password(uuid, uuid, boolean) from authenticated;

grant execute on function
  public.my_access(),
  public.admin_list_allowlist(),
  public.admin_prepare_password(uuid)
to authenticated;

grant execute on function public.server_record_admin_password(uuid, uuid, boolean) to service_role;

revoke execute on function public.before_user_created_hook(jsonb) from public, anon, authenticated;
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant execute on function public.before_user_created_hook(jsonb) to supabase_auth_admin';
    execute 'grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin';
  end if;
end;
$$;
