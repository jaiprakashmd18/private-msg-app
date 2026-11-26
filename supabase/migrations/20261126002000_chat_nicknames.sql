begin;

create table public.chat_nicknames (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  nickname text check (nickname is null or char_length(nickname) between 1 and 40),
  primary key (conversation_id, user_id)
);
alter table public.chat_nicknames enable row level security;
revoke all on public.chat_nicknames from public, anon, authenticated;
grant select on public.chat_nicknames to authenticated;
create policy "Members see shared nicknames"
  on public.chat_nicknames for select to authenticated
  using ((select private.is_active_user()) and private.is_conversation_member(conversation_id));

create function public.set_chat_nickname(p_chat uuid, p_user uuid, p_nickname text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_nickname text := nullif(btrim(p_nickname), '');
begin
  perform private.require_active_user();
  if not private.is_conversation_member(p_chat) or not exists (
    select 1 from public.conversations c join public.conversation_members m on m.conversation_id = c.id
    where c.id = p_chat and c.kind = 'direct' and m.user_id = p_user and m.left_at is null
  ) then
    raise exception 'This nickname is only available to members of this one-to-one chat' using errcode = '42501';
  end if;
  if char_length(v_nickname) > 40 then
    raise exception 'Use 40 characters or fewer' using errcode = '22023';
  end if;
  insert into public.chat_nicknames (conversation_id, user_id, nickname)
  values (p_chat, p_user, v_nickname)
  on conflict (conversation_id, user_id) do update set nickname = excluded.nickname;
end;
$$;

revoke execute on function public.set_chat_nickname(uuid, uuid, text) from public, anon;
grant execute on function public.set_chat_nickname(uuid, uuid, text) to authenticated;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.chat_nicknames;
  end if;
end $$;
commit;
