-- =============================================================================
-- Repair: creates the app profile for anyone who signed in with Google BEFORE
-- the database setup was run (symptom: "redirected you too many times", or
-- "this account isn't set up in the app yet"). Safe to run more than once.
-- Run in Supabase → SQL Editor, then sign out and sign in again.
-- =============================================================================
insert into public.profiles (id, email, authorized_email_id, display_name)
select u.id, lower(u.email), a.id,
       left(coalesce(nullif(btrim(a.label), ''), u.raw_user_meta_data ->> 'full_name', ''), 60)
from auth.users u
join public.authorized_emails a on a.email = lower(u.email)
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict do nothing;
