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
