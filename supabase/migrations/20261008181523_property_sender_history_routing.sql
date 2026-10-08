-- Distinct new property conversations get a sender not previously used for this recipient.
-- Existing threads retain their identity. Opt-outs never cause number rotation.
alter table public.icash_text_threads add column sender_pool_assigned boolean not null default false;
create function public.icash_property_text_sender(p_account uuid,p_deal uuid,p_recipient text) returns text
language plpgsql security invoker set search_path='' as $$
declare chosen text;
begin
 if p_recipient is null or p_recipient!~'^\+[1-9][0-9]{7,14}$' then return null;end if;
 perform pg_advisory_xact_lock(818,1);
 if exists(select 1 from public.icash_text_suppressions where phone=p_recipient) or exists(select 1 from public.icash_webinar_phone_suppressions where phone=p_recipient) then return null;end if;
 select t.sender into chosen from public.icash_text_threads t where t.account_id=p_account and t.deal_id=p_deal and t.recipient=p_recipient and t.retired_at is null order by t.id limit 1;
 if chosen is not null then
  return case when exists(select 1 from public.icash_text_senders where phone=chosen and enabled) and not public.icash_text_role_conflict(chosen,p_recipient) then chosen else null end;
 end if;
 select s.phone into chosen from public.icash_text_senders s left join public.icash_webinar_text_senders w on w.phone=s.phone
 where s.enabled and not public.icash_text_role_conflict(s.phone,p_recipient)
 and not exists(select 1 from public.icash_text_threads t where t.sender=s.phone and t.recipient=p_recipient)
 order by coalesce(w.preferred,false),s.phone limit 1;
 return chosen;
end $$;
revoke all on function public.icash_property_text_sender(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_property_text_sender(uuid,uuid,text) to service_role;

do $patch$ declare body text;needle text;replacement text;begin
 select pg_get_functiondef('public.icash_prepare_seller_contacts(uuid,uuid,uuid,uuid)'::regprocedure) into strict body;
 needle:='if (select count(*) from public.icash_text_senders where enabled)<>1 then return;end if;
 select phone into chosen_sender from public.icash_text_senders where enabled for share;';replacement:='chosen_sender:=public.icash_property_text_sender(p_account,p_deal,l.phone);if chosen_sender is null then return;end if;';
 if position(needle in body)=0 then raise exception 'Property sender prerequisite changed: %','icash_prepare_seller_contacts(uuid,uuid,uuid,uuid)';end if;
 body:=replace(body,needle,replacement);
 needle:='insert into public.icash_text_threads(account_id,deal_id,sender,recipient,';replacement:='insert into public.icash_text_threads(sender_pool_assigned,account_id,deal_id,sender,recipient,';
 if position(needle in body)=0 then raise exception 'Property sender prerequisite changed: %','icash_prepare_seller_contacts(uuid,uuid,uuid,uuid)';end if;
 body:=replace(body,needle,replacement);
 needle:='values(p_account,p_deal,chosen_sender,l.phone,';replacement:='values(true,p_account,p_deal,chosen_sender,l.phone,';
 if position(needle in body)=0 then raise exception 'Property sender prerequisite changed: %','icash_prepare_seller_contacts(uuid,uuid,uuid,uuid)';end if;
 body:=replace(body,needle,replacement);
 execute body;
 select pg_get_functiondef('public.icash_prepare_manual_text(uuid,uuid,uuid,text,jsonb)'::regprocedure) into strict body;
 needle:='select phone into sender_phone from public.icash_text_senders where enabled order by phone limit 1;';replacement:='sender_phone:=public.icash_property_text_sender(p_account,d.id,p_phone);';
 if position(needle in body)=0 then raise exception 'Property sender prerequisite changed: %','icash_prepare_manual_text(uuid,uuid,uuid,text,jsonb)';end if;
 body:=replace(body,needle,replacement);
 needle:='Business texting number is not configured.';replacement:='No unused texting number is available for this contact. Review the existing conversation or add a number.';
 if position(needle in body)=0 then raise exception 'Property sender prerequisite changed: %','icash_prepare_manual_text(uuid,uuid,uuid,text,jsonb)';end if;
 body:=replace(body,needle,replacement);
 needle:='insert into public.icash_text_threads(account_id,deal_id,sender,recipient,';replacement:='insert into public.icash_text_threads(sender_pool_assigned,account_id,deal_id,sender,recipient,';
 if position(needle in body)=0 then raise exception 'Property sender prerequisite changed: %','icash_prepare_manual_text(uuid,uuid,uuid,text,jsonb)';end if;
 body:=replace(body,needle,replacement);
 needle:='values(p_account,d.id,sender_phone,p_phone,';replacement:='values(true,p_account,d.id,sender_phone,p_phone,';
 if position(needle in body)=0 then raise exception 'Property sender prerequisite changed: %','icash_prepare_manual_text(uuid,uuid,uuid,text,jsonb)';end if;
 body:=replace(body,needle,replacement);
 execute body;
 select pg_get_functiondef('public.icash_project_operational_sms_contacts(uuid)'::regprocedure) into strict body;
 needle:='if (select count(*) from public.icash_text_senders where enabled)<>1 then return 0;end if;
 select phone into v_sender from public.icash_text_senders where enabled for share;';replacement:='if not exists(select 1 from public.icash_text_senders where enabled) then return 0;end if;';
 if position(needle in body)=0 then raise exception 'Property sender prerequisite changed: %','icash_project_operational_sms_contacts(uuid)';end if;
 body:=replace(body,needle,replacement);
 needle:='and not exists(select 1 from public.icash_text_threads th where th.retired_at is null and th.sender=v_sender and th.recipient=oc.phone)';replacement:='and not exists(select 1 from public.icash_text_threads th join public.icash_deal_files df on df.id=th.deal_id and df.account_id=th.account_id where th.retired_at is null and th.account_id=oc.account_id and df.screening_id=oc.screening_id and th.recipient=oc.phone)';
 if position(needle in body)=0 then raise exception 'Property sender prerequisite changed: %','icash_project_operational_sms_contacts(uuid)';end if;
 body:=replace(body,needle,replacement);
 needle:='checked:=clock_timestamp();';replacement:='v_sender:=public.icash_property_text_sender(c.account_id,deal,c.phone);if v_sender is null then continue;end if;checked:=clock_timestamp();';
 if position(needle in body)=0 then raise exception 'Property sender prerequisite changed: %','icash_project_operational_sms_contacts(uuid)';end if;
 body:=replace(body,needle,replacement);
 needle:='insert into public.icash_text_threads(account_id,deal_id,sender,recipient,';replacement:='insert into public.icash_text_threads(sender_pool_assigned,account_id,deal_id,sender,recipient,';
 if position(needle in body)=0 then raise exception 'Property sender prerequisite changed: %','icash_project_operational_sms_contacts(uuid)';end if;
 body:=replace(body,needle,replacement);
 needle:='select c.account_id,deal,v_sender,c.phone,';replacement:='select true,c.account_id,deal,v_sender,c.phone,';
 if position(needle in body)=0 then raise exception 'Property sender prerequisite changed: %','icash_project_operational_sms_contacts(uuid)';end if;
 body:=replace(body,needle,replacement);
 execute body;
 select pg_get_functiondef('public.icash_decide_authority_review(uuid,uuid,text,text,jsonb)'::regprocedure) into strict body;
 needle:='perform 1 from public.icash_text_senders where phone=v->>''smsSender'' and enabled for share;';replacement:='v:=v||jsonb_build_object(''requestedSmsSender'',v->>''smsSender'',''smsSender'',public.icash_property_text_sender(r.account_id,d.id,p->>''phone''));perform 1 from public.icash_text_senders where phone=v->>''smsSender'' and enabled for share;';
 if position(needle in body)=0 then raise exception 'Property sender prerequisite changed: %','icash_decide_authority_review(uuid,uuid,text,text,jsonb)';end if;
 body:=replace(body,needle,replacement);
 needle:='insert into public.icash_text_threads(account_id,deal_id,sender,recipient,';replacement:='insert into public.icash_text_threads(sender_pool_assigned,account_id,deal_id,sender,recipient,';
 if position(needle in body)=0 then raise exception 'Property sender prerequisite changed: %','icash_decide_authority_review(uuid,uuid,text,text,jsonb)';end if;
 body:=replace(body,needle,replacement);
 needle:='values(r.account_id,d.id,v->>''smsSender'',p->>''phone'',';replacement:='values(true,r.account_id,d.id,v->>''smsSender'',p->>''phone'',';
 if position(needle in body)=0 then raise exception 'Property sender prerequisite changed: %','icash_decide_authority_review(uuid,uuid,text,text,jsonb)';end if;
 body:=replace(body,needle,replacement);
 execute body;
end $patch$;
