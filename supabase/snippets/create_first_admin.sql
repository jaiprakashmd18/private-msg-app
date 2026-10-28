-- =============================================================================
-- Create (or promote) an administrator.
--
-- Run this in the Supabase Dashboard → SQL Editor (which runs as the database
-- owner). There is intentionally NO way to do this from the app or the API:
-- the `role` column can only be changed by the database owner.
--
-- 1. Replace +10000000000 with your own number in international (E.164) format.
-- 2. Run the script.
-- 3. Sign in to the app with that number.
-- =============================================================================
insert into public.authorized_phone_numbers (phone_e164, label, role, status)
values ('+10000000000', 'Administrator', 'admin', 'active')
on conflict (phone_e164) do update
  set role = 'admin', status = 'active', disabled_at = null;

insert into public.audit_logs (actor_id, action, target_type, metadata)
values (null, 'system.admin_granted', 'authorized_phone_number',
        jsonb_build_object('phone', left('+10000000000', 3) || '…', 'via', 'sql_editor'));

-- To REMOVE administrator rights later:
--   update public.authorized_phone_numbers set role = 'member' where phone_e164 = '+10000000000';
