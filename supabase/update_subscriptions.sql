-- =============================================================================
-- UPDATE: Ghostline Plus (subscriptions).
--
-- Run ONCE on a project set up before this update, AFTER the earlier update
-- files (... update_contacts_invites.sql). New projects don't need it
-- (setup_all.sql has everything). Paste into Supabase -> SQL Editor -> Run.
-- =============================================================================

-- =============================================================================
-- 1600 — Ghostline Plus (subscriptions)
--
-- A paid tier that unlocks the "couple pack" (journal, bucket list, date
-- planner, special dates, love-notes scheduling). Entitlement lives here so
-- the web (Stripe) and the phone apps (Apple / Google, via RevenueCat) all
-- feed one truth. In a one-to-one chat, if EITHER partner has Plus the pack
-- is unlocked for both.
--
-- Payments are applied by the server (service role) from webhooks, or granted
-- by an administrator for free (source 'admin'). Nothing here trusts the
-- client with its own subscription state.
-- =============================================================================

create table public.subscriptions (
  user_id             uuid primary key references public.profiles (id) on delete cascade,
  plan                text not null default 'plus' check (plan in ('plus')),
  status              text not null default 'inactive'
                        check (status in ('active', 'trialing', 'past_due', 'canceled', 'inactive')),
  source              text check (source in ('stripe', 'apple', 'google', 'admin')),
  -- null = no end date (an admin grant that doesn't expire).
  current_period_end  timestamptz,
  -- Opaque ids from the billing provider, for reconciliation (never shown to clients).
  external_customer   text check (external_customer is null or char_length(external_customer) <= 255),
  external_sub        text check (external_sub is null or char_length(external_sub) <= 255),
  cancel_at_period_end boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index subscriptions_external_sub_idx on public.subscriptions (external_sub);

create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function private.set_updated_at();

revoke all on table public.subscriptions from anon, authenticated;
grant select on table public.subscriptions to authenticated;
alter table public.subscriptions enable row level security;

-- A member can read only their own subscription; the provider ids are not selectable.
create policy "users read own subscription"
  on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Entitlement helpers
-- -----------------------------------------------------------------------------
-- True when this user is a paying/active Plus member right now.
create or replace function private.is_plus(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = p_user_id
      and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now())
  );
$$;

revoke execute on function private.is_plus(uuid) from public, anon;
grant execute on function private.is_plus(uuid) to authenticated;

-- The caller's own Plus status and when it renews/ends.
create or replace function public.my_subscription()
returns table (is_plus boolean, status text, current_period_end timestamptz, cancel_at_period_end boolean, source text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.is_plus((select auth.uid())),
    coalesce(s.status, 'inactive'),
    s.current_period_end,
    coalesce(s.cancel_at_period_end, false),
    s.source
  from (select (select auth.uid()) as uid) me
  left join public.subscriptions s on s.user_id = me.uid;
$$;

-- Is the couple pack unlocked in this conversation? True if any active member has Plus.
create or replace function public.conversation_is_plus(p_conversation_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_user();
begin
  if not private.is_conversation_member(p_conversation_id) then
    raise exception 'You are not a member of this conversation' using errcode = '42501';
  end if;
  return exists (
    select 1
    from public.conversation_members m
    where m.conversation_id = p_conversation_id
      and m.left_at is null
      and private.is_plus(m.user_id)
  );
end;
$$;

revoke execute on function public.my_subscription() from public, anon;
grant execute on function public.my_subscription() to authenticated;
revoke execute on function public.conversation_is_plus(uuid) from public, anon;
grant execute on function public.conversation_is_plus(uuid) to authenticated;

-- my_access carries is_plus too, so the app knows on load (all other fields kept).
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
  must_change_password  boolean,
  is_plus               boolean
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
    private.must_change_password(p.id),
    private.is_plus(p.id)
  from public.profiles p
  left join public.authorized_emails a on a.id = p.authorized_email_id
  left join auth.users u on u.id = p.id
  where p.id = (select auth.uid());
$$;

-- -----------------------------------------------------------------------------
-- Administrator grant (free Plus, e.g. for the owners or testing)
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_plus(p_user_id uuid, p_on boolean, p_days integer default null)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.require_admin();
  v_row   public.subscriptions;
begin
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'No such member' using errcode = 'P0002';
  end if;

  if p_on then
    insert into public.subscriptions (user_id, plan, status, source, current_period_end)
    values (
      p_user_id, 'plus', 'active', 'admin',
      case when p_days is null then null else now() + make_interval(days => greatest(p_days, 1)) end
    )
    on conflict (user_id) do update
      set status = 'active',
          source = 'admin',
          current_period_end = case when p_days is null then null else now() + make_interval(days => greatest(p_days, 1)) end,
          cancel_at_period_end = false
    returning * into v_row;
  else
    update public.subscriptions
      set status = 'canceled', cancel_at_period_end = false
      where user_id = p_user_id
      returning * into v_row;
    if v_row.user_id is null then
      insert into public.subscriptions (user_id, status, source) values (p_user_id, 'inactive', 'admin')
      returning * into v_row;
    end if;
  end if;

  perform private.write_audit(v_admin, case when p_on then 'admin.plus_granted' else 'admin.plus_revoked' end,
    'subscription', p_user_id::text, jsonb_build_object('days', p_days));
  return v_row;
end;
$$;

revoke execute on function public.admin_set_plus(uuid, boolean, integer) from public, anon, authenticated;
grant execute on function public.admin_set_plus(uuid, boolean, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- Service-only: apply a subscription from a billing webhook (Stripe/RevenueCat)
-- -----------------------------------------------------------------------------
create or replace function public.server_apply_subscription(
  p_user_id            uuid,
  p_source             text,
  p_status             text,
  p_current_period_end timestamptz default null,
  p_external_customer  text default null,
  p_external_sub       text default null,
  p_cancel_at_period_end boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_source not in ('stripe', 'apple', 'google') then
    raise exception 'Invalid subscription source' using errcode = '22023';
  end if;
  if p_status not in ('active', 'trialing', 'past_due', 'canceled', 'inactive') then
    raise exception 'Invalid subscription status' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'No such member' using errcode = 'P0002';
  end if;

  insert into public.subscriptions (user_id, plan, status, source, current_period_end,
                                     external_customer, external_sub, cancel_at_period_end)
  values (p_user_id, 'plus', p_status, p_source, p_current_period_end,
          left(p_external_customer, 255), left(p_external_sub, 255), coalesce(p_cancel_at_period_end, false))
  on conflict (user_id) do update
    set status = excluded.status,
        source = excluded.source,
        current_period_end = excluded.current_period_end,
        external_customer = coalesce(excluded.external_customer, public.subscriptions.external_customer),
        external_sub = coalesce(excluded.external_sub, public.subscriptions.external_sub),
        cancel_at_period_end = excluded.cancel_at_period_end;
end;
$$;

revoke execute on function public.server_apply_subscription(uuid, text, text, timestamptz, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.server_apply_subscription(uuid, text, text, timestamptz, text, text, boolean)
  to service_role;

-- -----------------------------------------------------------------------------
-- The admin member list also shows each member's Plus status.
-- -----------------------------------------------------------------------------
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
  password_pending boolean,
  is_plus          boolean
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
           coalesce(private.must_change_password(p.id), false),
           coalesce(private.is_plus(p.id), false)
    from public.authorized_emails a
    left join public.profiles p on p.authorized_email_id = a.id
    left join auth.users u on u.id = p.id
    order by a.created_at desc;
end;
$$;

revoke execute on function public.admin_list_allowlist() from public, anon;
grant execute on function public.admin_list_allowlist() to authenticated;
