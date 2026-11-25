-- Manual access and provider subscriptions have independent lifecycles.
begin;

create table if not exists private.plus_grants (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  expires_at timestamptz
);
revoke all on private.plus_grants from public, anon, authenticated;

insert into private.plus_grants (user_id, expires_at)
select user_id, current_period_end from public.subscriptions
where source = 'admin' and status in ('active', 'trialing')
  and (current_period_end is null or current_period_end > now())
on conflict (user_id) do nothing;

delete from public.subscriptions where source = 'admin';

create or replace function private.is_plus(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = p_user_id and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now())
  ) or exists (
    select 1 from private.plus_grants g
    where g.user_id = p_user_id and (g.expires_at is null or g.expires_at > now())
  );
$$;

create or replace function public.my_subscription()
returns table (is_plus boolean, status text, current_period_end timestamptz, cancel_at_period_end boolean, source text)
language sql stable security definer set search_path = ''
as $$
  select private.is_plus(me.uid),
    case when g.user_id is not null then 'active' else coalesce(s.status, 'inactive') end,
    case when g.user_id is not null then g.expires_at else s.current_period_end end,
    case when g.user_id is not null then false else coalesce(s.cancel_at_period_end, false) end,
    case when g.user_id is not null then 'admin' else s.source end
  from (select (select auth.uid()) as uid) me
  left join public.subscriptions s on s.user_id = me.uid
  left join private.plus_grants g on g.user_id = me.uid
    and (g.expires_at is null or g.expires_at > now())
    and not coalesce(s.status in ('active', 'trialing') and
        (s.current_period_end is null or s.current_period_end > now()), false);
$$;

create or replace function public.admin_set_plus(p_user_id uuid, p_on boolean, p_days integer default null)
returns public.subscriptions
language plpgsql security definer set search_path = ''
as $$
declare
  v_admin uuid := private.require_admin();
  v_expiry timestamptz;
  v_result public.subscriptions;
begin
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'No such member' using errcode = 'P0002';
  end if;

  if p_on then
    v_expiry := case when p_days is not null then now() + make_interval(days => greatest(p_days, 1)) end;
    insert into private.plus_grants (user_id, expires_at) values (p_user_id, v_expiry)
    on conflict (user_id) do update set expires_at = excluded.expires_at;
  else
    delete from private.plus_grants where user_id = p_user_id;
  end if;

  perform private.write_audit(v_admin, case when p_on then 'admin.plus_granted' else 'admin.plus_revoked' end,
    'subscription', p_user_id::text, jsonb_build_object('days', p_days));
  v_result.user_id := p_user_id;
  v_result.plan := 'plus';
  v_result.status := case when p_on then 'active' else 'canceled' end;
  v_result.source := 'admin';
  v_result.current_period_end := v_expiry;
  v_result.cancel_at_period_end := false;
  return v_result;
end;
$$;

create or replace function public.admin_list_plus_grants()
returns setof uuid
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  return query select g.user_id from private.plus_grants g
    where g.expires_at is null or g.expires_at > now();
end;
$$;

revoke execute on function public.admin_list_plus_grants() from public, anon;
grant execute on function public.admin_list_plus_grants() to authenticated;

commit;
