begin;
-- Keep the original lease supported without authorizing arbitrary caller IDs.
alter table public.icash_business_voice_numbers drop constraint icash_business_voice_numbers_phone_check;
alter table public.icash_business_voice_numbers add constraint icash_business_voice_numbers_phone_check check(phone in ('+14244377030','+17208134296'));

-- The four-argument legacy function remains available for an older deployment.
create function public.icash_save_business_voice_number(p_account_sid text,p_caller_id_sid text,p_forwarding boolean,p_enabled boolean,p_phone text)
returns void language plpgsql security invoker set search_path='' as $$
begin
 insert into public.icash_business_voice_numbers(phone,provider_account_sid,caller_id_sid,forwarding_ready,outbound_enabled)
 values(p_phone,p_account_sid,p_caller_id_sid,p_forwarding,p_enabled)
 on conflict(phone) do update set provider_account_sid=excluded.provider_account_sid,caller_id_sid=excluded.caller_id_sid,forwarding_ready=excluded.forwarding_ready,outbound_enabled=excluded.outbound_enabled,verified_at=now();
 -- The owner explicitly connects a provider-verified active SMS lease. Existing
 -- conversation identities and suppression records are never rewritten.
 if p_forwarding then
  insert into public.icash_text_senders(phone,enabled) values(p_phone,true)
  on conflict(phone) do nothing;
 end if;
end $$;
revoke all on function public.icash_save_business_voice_number(text,text,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.icash_save_business_voice_number(text,text,boolean,boolean,text) to service_role;

create or replace function icash_recording_private.bind_business_caller_id() returns trigger language plpgsql security definer set search_path='' as $$
declare n public.icash_business_voice_numbers;
begin
 if TG_OP='UPDATE' then
  if row(new.from_phone,new.provider_account_sid,new.caller_id_sid) is distinct from row(old.from_phone,old.provider_account_sid,old.caller_id_sid) then raise exception 'Calling identity is immutable';end if;
  return new;
 end if;
 if new.from_phone in ('+14244377030','+17208134296') then
  select * into n from public.icash_business_voice_numbers where phone=new.from_phone and provider_account_sid=new.provider_account_sid and outbound_enabled and forwarding_ready for share;
  if not found or n.caller_id_sid is null then raise exception 'Calling number verification required'; end if;
  new.caller_id_sid:=n.caller_id_sid;
 elsif new.caller_id_sid is not null then raise exception 'Unexpected caller ID receipt';end if;
 return new;
end $$;
revoke all on function icash_recording_private.bind_business_caller_id() from public,anon,authenticated;

create or replace function public.icash_customer_call_sender(p_account uuid,p_screening uuid,p_recipient text) returns text language sql security invoker set search_path='' as $$
 with existing as (
  select t.sender from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  where t.account_id=p_account and d.screening_id=p_screening and t.recipient=p_recipient and t.retired_at is null
 ), chosen as (
  select case when exists(select 1 from existing)
   then (select e.sender from existing e join public.icash_text_senders s on s.phone=e.sender and s.enabled order by e.sender limit 1)
   else (select s.phone from public.icash_text_senders s left join public.icash_webinar_text_senders w on w.phone=s.phone
    where s.enabled and (s.phone not in ('+14244377030','+17208134296') or exists(select 1 from public.icash_business_voice_numbers n where n.phone=s.phone and n.outbound_enabled and n.forwarding_ready))
    order by coalesce(w.enabled and w.preferred,false) desc,s.phone limit 1) end sender
 ) select sender from chosen where exists(select 1 from public.icash_manual_contacts(p_account,p_screening) c where c.phone=p_recipient and not c.blocked);
$$;
revoke all on function public.icash_customer_call_sender(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_customer_call_sender(uuid,uuid,text) to service_role;
commit;
