begin;

create policy "receive own call signals" on realtime.messages for select to authenticated
using (extension = 'broadcast' and realtime.topic() = 'calls:' || (select auth.uid())::text
  and (select private.is_active_user()));

create function public.signal_direct_call(p_chat uuid, p_call uuid, p_event text, p_data text default '')
returns void language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := private.require_active_user();
  recipient uuid;
begin
  select m.user_id into recipient from public.conversation_members m
    join public.conversations c on c.id = m.conversation_id
    where c.id = p_chat and c.kind = 'direct' and m.user_id <> caller and m.left_at is null
      and private.is_conversation_member(c.id) and private.user_is_active(m.user_id);
  if recipient is null then raise exception 'Active direct chat required' using errcode = '42501'; end if;
  if p_call is null or p_data is null or p_event is null or p_event not in ('voice','video','ready','offer','answer','end')
    or octet_length(p_data) > 65536 or (p_event not in ('offer','answer') and p_data <> '') then
    raise exception 'Invalid call signal' using errcode = '22023';
  end if;
  perform realtime.send(jsonb_build_object('chat',p_chat,'id',p_call,'sender',caller,
    'event',p_event,'data',p_data), 'signal', 'calls:' || recipient::text, true);
end;
$$;
revoke all on function public.signal_direct_call(uuid,uuid,text,text) from public, anon;
grant execute on function public.signal_direct_call(uuid,uuid,text,text) to authenticated;
commit;
