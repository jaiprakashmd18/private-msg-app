begin;

create table private.open_when_letters (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  author uuid references public.profiles(id) on delete set null,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  opened_at timestamptz
);
create index on private.open_when_letters (conversation_id, created_at desc);

create table private.saved_memories (
  message_id uuid primary key references public.messages(id) on delete cascade,
  saved_at timestamptz not null default now(),
  caption text not null default '' check (char_length(caption) <= 200),
  pinned boolean not null default false
);

create table public.notification_privacy (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('full', 'sender', 'private'))
);
alter table public.notification_privacy enable row level security;
revoke all on public.notification_privacy from anon, authenticated;
grant select, insert, update on public.notification_privacy to authenticated;
grant select on public.notification_privacy to service_role;
create policy "members manage notification privacy" on public.notification_privacy
  for all to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_user()))
  with check (user_id = (select auth.uid()) and (select private.is_active_user()));

create table private.plus_gifts (
  code_hash bytea primary key,
  redeem_by timestamptz not null,
  duration_days integer not null,
  redeemed_by uuid references public.profiles(id) on delete set null,
  redeemed_at timestamptz
);
revoke all on private.open_when_letters, private.saved_memories, private.plus_gifts from public, anon, authenticated;

create function private.require_couple_upgrade(p_chat uuid)
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare v_user uuid := private.require_active_user();
begin
  if not exists (select 1 from public.conversations where id = p_chat and kind = 'direct')
     or not public.conversation_is_plus(p_chat) then
    raise exception 'An active couple chat with Plus is required' using errcode = '42501';
  end if;
  return v_user;
end;
$$;
revoke all on function private.require_couple_upgrade(uuid) from public, anon, authenticated;

create function public.open_when_letters(p_chat uuid)
returns table (id uuid, title text, body text, mine boolean, opened_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare v_user uuid := private.require_couple_upgrade(p_chat);
begin
  return query select l.id, l.title,
    case when l.author = v_user or l.opened_at is not null then l.body end,
    coalesce(l.author = v_user, false), l.opened_at
  from private.open_when_letters l where l.conversation_id = p_chat and l.author is not null
  order by l.created_at desc;
end;
$$;

create function public.save_open_when_letter(p_chat uuid, p_title text, p_body text, p_id uuid default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_user uuid := private.require_couple_upgrade(p_chat);
begin
  if p_id is null then
    insert into private.open_when_letters (conversation_id, author, title, body)
    values (p_chat, v_user, btrim(p_title), btrim(p_body));
  else
    update private.open_when_letters set title = btrim(p_title), body = btrim(p_body)
    where id = p_id and conversation_id = p_chat and author = v_user and opened_at is null;
    if not found then raise exception 'This letter can no longer be edited' using errcode = '42501'; end if;
  end if;
end;
$$;

create function public.act_on_open_when_letter(p_chat uuid, p_id uuid, p_action text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_user uuid := private.require_couple_upgrade(p_chat);
begin
  if p_action = 'open' then
    update private.open_when_letters set opened_at = coalesce(opened_at, now())
    where id = p_id and conversation_id = p_chat and author <> v_user;
  elsif p_action = 'withdraw' then
    delete from private.open_when_letters
    where id = p_id and conversation_id = p_chat and author = v_user and opened_at is null;
  else
    raise exception 'Unknown letter action' using errcode = '22023';
  end if;
  if not found then raise exception 'This letter is unavailable' using errcode = '42501'; end if;
end;
$$;

-- Respect each member’s message cutoff even though the function owns the saved rows.
create function public.couple_memories(p_chat uuid)
returns table (id uuid, body text, caption text, pinned boolean, saved_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_couple_upgrade(p_chat);
  return query select m.id, m.body, s.caption, s.pinned, s.saved_at
    from private.saved_memories s join public.messages m on m.id = s.message_id
    where m.conversation_id = p_chat and m.deleted_at is null
      and m.created_at > coalesce(private.my_cleared_at(p_chat), '-infinity'::timestamptz)
      and not exists (select 1 from public.attachments a where a.message_id = m.id and a.view_once)
    order by s.pinned desc, s.saved_at desc;
end;
$$;

create function public.set_couple_memory(p_chat uuid, p_message uuid, p_action text, p_caption text default '', p_pinned boolean default false)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_couple_upgrade(p_chat);
  if not exists (select 1 from public.messages m where m.id = p_message and m.conversation_id = p_chat
      and m.deleted_at is null and m.created_at > coalesce(private.my_cleared_at(p_chat), '-infinity'::timestamptz)
      and not exists (select 1 from public.attachments a where a.message_id = m.id and a.view_once)) then
    raise exception 'This message cannot be saved' using errcode = '42501';
  end if;
  case p_action
    when 'save' then insert into private.saved_memories (message_id) values (p_message) on conflict do nothing;
    when 'edit' then update private.saved_memories set caption = btrim(p_caption), pinned = p_pinned where message_id = p_message;
    when 'remove' then delete from private.saved_memories where message_id = p_message;
    else raise exception 'Unknown memory action' using errcode = '22023';
  end case;
end;
$$;

create function public.admin_create_plus_gift(p_days integer, p_redeem_days integer)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_admin uuid := private.require_admin();
  v_code text := replace(gen_random_uuid()::text, '-', '');
begin
  if p_days is null or p_redeem_days is null or p_days not between 1 and 365 or p_redeem_days not between 1 and 90 then
    raise exception 'Choose valid gift and redemption durations' using errcode = '22023';
  end if;
  insert into private.plus_gifts values (sha256(convert_to(v_code, 'UTF8')), now() + make_interval(days => p_redeem_days), p_days);
  perform private.write_audit(v_admin, 'admin.plus_gift_created', 'subscription', null, jsonb_build_object('days', p_days));
  return v_code;
end;
$$;

create function public.redeem_plus_gift(p_code text)
returns timestamptz language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.require_active_user();
  v_days integer;
  v_expires timestamptz;
begin
  update private.plus_gifts set redeemed_by = v_user, redeemed_at = now()
  where code_hash = sha256(convert_to(lower(btrim(p_code)), 'UTF8')) and redeem_by > now() and redeemed_at is null
  returning duration_days into v_days;
  if not found then raise exception 'Gift code is invalid, expired, or already used' using errcode = '22023'; end if;
  insert into private.plus_grants as g (user_id, expires_at) values (v_user, now() + make_interval(days => v_days))
  on conflict (user_id) do update set expires_at = case when g.expires_at is not null
    then greatest(now(), g.expires_at) + make_interval(days => v_days) end
  returning expires_at into v_expires;
  return v_expires;
end;
$$;

revoke execute on function public.open_when_letters(uuid), public.save_open_when_letter(uuid,text,text,uuid),
  public.act_on_open_when_letter(uuid,uuid,text), public.couple_memories(uuid),
  public.set_couple_memory(uuid,uuid,text,text,boolean), public.admin_create_plus_gift(integer,integer),
  public.redeem_plus_gift(text) from public, anon;
grant execute on function public.open_when_letters(uuid), public.save_open_when_letter(uuid,text,text,uuid),
  public.act_on_open_when_letter(uuid,uuid,text), public.couple_memories(uuid),
  public.set_couple_memory(uuid,uuid,text,text,boolean), public.admin_create_plus_gift(integer,integer),
  public.redeem_plus_gift(text) to authenticated;
create table private.couple_covers (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  attachment_id uuid not null references public.attachments(id) on delete cascade
);
revoke all on private.couple_covers from public, anon, authenticated;

create function public.couple_cover(p_chat uuid, p_attachment uuid default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_cover uuid;
begin
  perform private.require_active_user();
  if not private.is_conversation_member(p_chat)
     or not exists (select 1 from public.conversations where id = p_chat and kind = 'direct') then
    raise exception 'An active couple chat is required' using errcode = '42501';
  end if;
  if p_attachment is not null then
    if not exists (
      select 1 from public.attachments a join public.messages m on m.id = a.message_id
      where a.id = p_attachment and a.conversation_id = p_chat and not a.view_once
        and a.mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
        and m.deleted_at is null
        and m.created_at > coalesce(private.my_cleared_at(p_chat), '-infinity'::timestamptz)
    ) then raise exception 'Photo unavailable' using errcode = '42501'; end if;
    insert into private.couple_covers values (p_chat, p_attachment)
    on conflict (conversation_id) do update set attachment_id = excluded.attachment_id;
  end if;
  select c.attachment_id into v_cover from private.couple_covers c
  where c.conversation_id = p_chat;
  return v_cover;
end;
$$;
revoke execute on function public.couple_cover(uuid,uuid) from public, anon;
grant execute on function public.couple_cover(uuid,uuid) to authenticated;

create function public.server_notification_modes(p_endpoints text[])
returns table (endpoint text, mode text)
language sql stable security definer set search_path = ''
as $$
  select s.endpoint, p.mode from public.push_subscriptions s
  join public.notification_privacy p on p.user_id = s.user_id
  where s.endpoint = any(p_endpoints);
$$;
revoke execute on function public.server_notification_modes(text[]) from public, anon, authenticated;
grant execute on function public.server_notification_modes(text[]) to service_role;
commit;
