-- LOCAL DEVELOPMENT SEED ONLY (applied by `supabase db reset`).
-- These numbers match [auth.sms.test_otp] in supabase/config.toml, so you can
-- sign in locally with code 123456 without an SMS provider.
-- Do not run this against production.
insert into public.authorized_phone_numbers (phone_e164, label, role)
values
  ('+15550000001', 'Local Admin', 'admin'),
  ('+15550000002', 'Local Alice', 'member'),
  ('+15550000003', 'Local Bob',   'member')
on conflict (phone_e164) do nothing;
