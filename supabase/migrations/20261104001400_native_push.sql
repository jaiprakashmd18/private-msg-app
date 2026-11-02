-- =============================================================================
-- 1400 — Notifications for the Android / iOS app
--
-- The phone apps can't use Web Push; they get a token from Firebase Cloud
-- Messaging (Android) or Apple Push Notification service (iPhone). Those
-- tokens live in the same push_subscriptions table as browsers, with the
-- endpoint written as 'fcm:<token>' or 'apns:<token>', so who-gets-notified
-- (server_push_targets) works unchanged. The server sends to each kind
-- (src/lib/push.server.ts).
-- =============================================================================

alter table public.push_subscriptions drop constraint push_subscriptions_endpoint_check;
alter table public.push_subscriptions
  add constraint push_subscriptions_endpoint_check check (
    char_length(endpoint) <= 1000
    and (
      endpoint like 'https://%'
      or (endpoint ~ '^fcm:[A-Za-z0-9_:.-]+$' and char_length(endpoint) >= 24)
      or (endpoint ~ '^apns:[0-9a-f]+$' and char_length(endpoint) between 37 and 205)
    )
  );

-- Saves this phone's token for the signed-in member. Like browsers, a token
-- that was used by another account on the same phone moves to this one.
create or replace function public.save_native_push_token(
  p_provider     text,
  p_token        text,
  p_show_preview boolean default true,
  p_user_agent   text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_user();
  v_token text := trim(coalesce(p_token, ''));
  v_endpoint text;
begin
  if p_provider = 'apns' then
    v_token := lower(v_token);
    if v_token !~ '^[0-9a-f]+$' or char_length(v_token) not between 32 and 200 then
      raise exception 'Invalid push token' using errcode = '22023';
    end if;
  elsif p_provider = 'fcm' then
    if v_token !~ '^[A-Za-z0-9_:.-]+$' or char_length(v_token) not between 20 and 900 then
      raise exception 'Invalid push token' using errcode = '22023';
    end if;
  else
    raise exception 'Invalid push provider' using errcode = '22023';
  end if;
  v_endpoint := p_provider || ':' || v_token;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, show_preview, user_agent)
  values (v_uid, v_endpoint, p_provider, p_provider, coalesce(p_show_preview, true), left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id      = excluded.user_id,
        show_preview = excluded.show_preview,
        user_agent   = excluded.user_agent;
end;
$$;

revoke all on function public.save_native_push_token(text, text, boolean, text) from public, anon;
grant execute on function public.save_native_push_token(text, text, boolean, text) to authenticated;
