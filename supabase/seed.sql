-- LOCAL DEVELOPMENT SEED ONLY (applied by `supabase db reset` / first `supabase start`).
-- Replace these with the Google accounts you use for local testing, then run
-- `npx supabase db reset`. Do not run this against production.
insert into public.authorized_emails (email, label, role)
values
  ('local-admin@example.com', 'Local Admin', 'admin'),
  ('local-alice@example.com', 'Local Alice', 'member'),
  ('local-bob@example.com',   'Local Bob',   'member')
on conflict (email) do nothing;
