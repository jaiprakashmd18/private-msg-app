-- Turns on the every-minute delivery of love notes and date reminders.
-- Safe to run more than once. Use it if love notes only arrive when someone
-- opens the app (see DEPLOYMENT.md → Troubleshooting).
create extension if not exists pg_net;
create extension if not exists pg_cron;
select cron.schedule('ghostline-timed-messages', '* * * * *', 'select private.run_scheduled_jobs()');
