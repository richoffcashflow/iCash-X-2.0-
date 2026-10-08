begin;
-- Voice is bound to its own recording/contact, not to whether SMS setup finished.
do $patch$ declare body text;needle text;begin
 body:=pg_get_functiondef('public.icash_seller_agreement_call_context(text,text)'::regprocedure);
 needle:='select ''outbound:''||c.id::text,c.account_id,d.id,t.id,t.recipient';
 if position(needle in body)=0 then raise exception 'Outbound call scope changed';end if;
 body:=replace(body,needle,'select ''outbound:''||c.id::text,c.account_id,d.id,t.id,r.to_phone');
 needle:='join public.icash_text_threads t on t.account_id=c.account_id and t.deal_id=d.id and encode(sha256(convert_to(t.recipient,''UTF8'')),''hex'')=c.contact_key';
 if position(needle in body)=0 then raise exception 'Outbound text dependency changed';end if;
 body:=replace(body,needle,$new$join public.icash_call_recordings r on r.account_id=c.account_id and r.operation_key=c.operation_key
   and r.screening_id=c.screening_id and r.contact_key=c.contact_key and r.party='seller'
   and r.conversation_id=c.conversation_id and r.stop_token_hash=p_hash
   and r.call_ended_at is null and r.end_requested_at is null
  left join public.icash_text_threads t on t.account_id=c.account_id and t.deal_id=d.id and t.recipient=r.to_phone and t.retired_at is null$new$);
 body:=replace(body,'join public.icash_text_threads t on t.id=c.thread_id and t.account_id=c.account_id and t.party=''seller''','left join public.icash_text_threads t on t.id=c.thread_id and t.account_id=c.account_id and t.party=''seller''');
 needle:='and t.retired_at is null and not t.paused and not t.manual_only and public.icash_membership_work_allowed(c.account_id)';
 if position(needle in body)=0 then raise exception 'Contact controls changed';end if;
 body:=replace(body,needle,'and (c.thread_id is null or (t.id is not null and t.retired_at is null and not t.paused and not t.manual_only)) and public.icash_membership_work_allowed(c.account_id)');
 execute body;
end $patch$;

-- A finite sender pool must not cap how many properties one seller can submit.
-- Keep each property's thread and existing history. Never cross accounts/roles.
create or replace function public.icash_property_text_sender(p_account uuid,p_deal uuid,p_recipient text) returns text
language plpgsql security invoker set search_path='' as $$
declare chosen text;
begin
 if p_recipient is null or p_recipient!~'^\+[1-9][0-9]{7,14}$' then return null;end if;
 perform pg_advisory_xact_lock(818,1);
 if exists(select 1 from public.icash_text_suppressions where phone=p_recipient)
  or exists(select 1 from public.icash_webinar_phone_suppressions where phone=p_recipient)
  or exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(p_recipient,'UTF8')),'hex')) then return null;end if;
 select t.sender into chosen from public.icash_text_threads t where t.account_id=p_account and t.deal_id=p_deal and t.recipient=p_recipient and t.retired_at is null order by t.id limit 1;
 if chosen is not null then
  return case when exists(select 1 from public.icash_text_senders where phone=chosen and enabled) and not public.icash_text_role_conflict(chosen,p_recipient) then chosen else null end;
 end if;
 select s.phone into chosen from public.icash_text_senders s left join public.icash_webinar_text_senders w on w.phone=s.phone
 where s.enabled and not public.icash_text_role_conflict(s.phone,p_recipient)
 and not exists(select 1 from public.icash_text_threads t where t.sender=s.phone and t.recipient=p_recipient)
 order by coalesce(w.preferred,false),s.phone limit 1;
 if chosen is not null then return chosen;end if;
 select s.phone into chosen from public.icash_text_senders s left join public.icash_webinar_text_senders w on w.phone=s.phone
 where s.enabled and not public.icash_text_role_conflict(s.phone,p_recipient)
 and exists(select 1 from public.icash_text_threads t where t.sender=s.phone and t.recipient=p_recipient and t.account_id=p_account and t.party='seller')
 and not exists(select 1 from public.icash_text_threads t where t.sender=s.phone and t.recipient=p_recipient and (t.account_id<>p_account or t.party<>'seller'))
 order by coalesce(w.preferred,false),s.phone limit 1;
 return chosen;
end $$;
revoke all on function public.icash_property_text_sender(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_property_text_sender(uuid,uuid,text) to service_role;
commit;
