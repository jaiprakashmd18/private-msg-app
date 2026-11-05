-- =============================================================================
-- UPDATE: Razorpay (one-time payment — UPI / Google Pay / cards, for India).
--
-- Run ONCE on a project set up before this update, AFTER update_subscriptions.sql.
-- New projects don't need it (setup_all.sql has everything). Paste into
-- Supabase -> SQL Editor -> Run.
-- =============================================================================

alter table public.subscriptions
  drop constraint if exists subscriptions_source_check;
alter table public.subscriptions
  add constraint subscriptions_source_check
  check (source in ('stripe', 'apple', 'google', 'admin', 'razorpay'));

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
  if p_source not in ('stripe', 'apple', 'google', 'razorpay') then
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
