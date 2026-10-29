-- =============================================================================
-- 0700 — Push notifications (Web Push)
--
-- Each device that turns on notifications stores its Web Push subscription
-- here. When someone sends a message, the sender's app asks the server to
-- notify; the server (service role) uses server_push_targets() to get the
-- other members' devices. Each message can trigger notifications only once,
-- only by its own sender, and only shortly after it was sent.
--
-- The VAPID key pair that signs pushes is generated automatically on first
-- use and kept in the non-exposed `private` schema (no configuration needed).
-- =============================================================================

create table public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  endpoint      text not null unique
                  check (char_length(endpoint) <= 1000 and endpoint like 'https://%'),
  p256dh        text not null check (char_length(p256dh) <= 200),
  auth          text not null check (char_length(auth) <= 100),
  show_preview  boolean not null default true,
  user_agent    text check (user_agent is null or char_length(user_agent) <= 300),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table private.push_config (
  id             boolean primary key default true check (id),
  vapid_public   text not null,
  vapid_private  text not null,
  created_at     timestamptz not null default now()
);

create table private.push_sent (
  message_id  uuid primary key references public.messages (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index push_sent_created_idx on private.push_sent (created_at);

revoke all on table public.push_subscriptions from anon, authenticated;
grant select on table public.push_subscriptions to authenticated;
revoke all on table private.push_config, private.push_sent from public, anon, authenticated;

alter table public.push_subscriptions enable row level security;
alter table private.push_config enable row level security;
alter table private.push_sent enable row level security;

create policy "users read own push subscriptions"
  on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Client RPCs
-- -----------------------------------------------------------------------------
create or replace function public.save_push_subscription(
  p_endpoint     text,
  p_p256dh       text,
  p_auth         text,
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
begin
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000
     or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Invalid push subscription' using errcode = '22023';
  end if;

  -- The endpoint is a secret only this browser knows; if the same browser
  -- signs in as another member, the subscription moves to that member.
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, show_preview, user_agent)
  values (v_uid, p_endpoint, left(p_p256dh, 200), left(p_auth, 100), coalesce(p_show_preview, true),
          left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id      = excluded.user_id,
        p256dh       = excluded.p256dh,
        auth         = excluded.auth,
        show_preview = excluded.show_preview,
        user_agent   = excluded.user_agent;
end;
$$;

-- Allowed even after access was revoked, so a device can always clean up.
create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  delete from public.push_subscriptions
    where endpoint = p_endpoint and user_id = (select auth.uid());
end;
$$;

-- -----------------------------------------------------------------------------
-- Server-only RPCs (service_role)
-- -----------------------------------------------------------------------------
create or replace function public.server_get_or_create_vapid(p_public text, p_private text)
returns table (vapid_public text, vapid_private text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.push_config (vapid_public, vapid_private)
  values (p_public, p_private)
  on conflict (id) do nothing;
  return query select c.vapid_public, c.vapid_private from private.push_config c;
end;
$$;

-- Returns the devices to notify about a message, at most once per message.
-- Empty unless p_sender really sent the (undeleted) message in the last 10
-- minutes and is still active. Only active members other than the sender.
create or replace function public.server_push_targets(p_message_id uuid, p_sender uuid)
returns table (
  endpoint         text,
  p256dh           text,
  auth             text,
  show_preview     boolean,
  conversation_id  uuid,
  sender_name      text,
  body             text,
  has_attachments  boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg public.messages;
begin
  delete from private.push_sent where created_at < now() - interval '2 days';

  select * into v_msg from public.messages m
    where m.id = p_message_id
      and m.sender_id = p_sender
      and m.deleted_at is null
      and m.created_at > now() - interval '10 minutes';
  if not found then
    return;
  end if;

  if not exists (
    select 1 from public.profiles p
    join public.authorized_emails a on a.id = p.authorized_email_id
    where p.id = p_sender and a.status = 'active'
  ) then
    return;
  end if;

  insert into private.push_sent (message_id) values (p_message_id)
  on conflict do nothing;
  if not found then
    return; -- already notified
  end if;

  return query
    select s.endpoint, s.p256dh, s.auth, s.show_preview, v_msg.conversation_id,
           coalesce(nullif(sp.display_name, ''), sp.email),
           left(v_msg.body, 200),
           exists (select 1 from public.attachments at where at.message_id = v_msg.id)
    from public.conversation_members cm
    join public.profiles rp on rp.id = cm.user_id
    join public.authorized_emails ra on ra.id = rp.authorized_email_id and ra.status = 'active'
    join public.push_subscriptions s on s.user_id = cm.user_id
    join public.profiles sp on sp.id = p_sender
    where cm.conversation_id = v_msg.conversation_id
      and cm.user_id <> p_sender;
end;
$$;

revoke execute on function
  public.save_push_subscription(text, text, text, boolean, text),
  public.delete_push_subscription(text),
  public.server_get_or_create_vapid(text, text),
  public.server_push_targets(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.save_push_subscription(text, text, text, boolean, text),
  public.delete_push_subscription(text)
to authenticated;

grant execute on function
  public.server_get_or_create_vapid(text, text),
  public.server_push_targets(uuid, uuid)
to service_role;
