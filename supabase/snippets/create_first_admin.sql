-- =============================================================================
-- Create (or promote) an administrator.
--
-- Run this in the Supabase Dashboard → SQL Editor (which runs as the database
-- owner). There is intentionally NO way to do this from the app or the API:
-- the `role` column can only be changed by the database owner.
--
-- 1. Replace you@gmail.com (both places) with YOUR Google/Gmail address,
--    in lower case.
-- 2. Run the script.
-- 3. Open the app and click "Continue with Google" with that account.
-- =============================================================================
insert into public.authorized_emails (email, label, role, status)
values (lower('you@gmail.com'), 'Administrator', 'admin', 'active')
on conflict (email) do update
  set role = 'admin', status = 'active', disabled_at = null;

insert into public.audit_logs (actor_id, action, target_type, metadata)
values (null, 'system.admin_granted', 'authorized_email',
        jsonb_build_object('email', private.mask_email(lower('you@gmail.com')), 'via', 'sql_editor'));

-- To REMOVE administrator rights later:
--   update public.authorized_emails set role = 'member' where email = 'you@gmail.com';
