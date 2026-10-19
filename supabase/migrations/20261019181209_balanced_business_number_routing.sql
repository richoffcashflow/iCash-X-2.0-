-- Share business numbers across new property conversations, keeping the same
-- number for their calls and texts. Selection is read-only: saved SMS threads
-- and admitted call records, including uncertain attempts, provide continuity.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create index icash_recording_business_recipient on public.icash_call_recordings(to_phone,from_phone,account_id,screening_id);
create index icash_customer_call_business_recipient on public.icash_customer_phone_calls(recipient_phone,business_phone,account_id,screening_id);

create function public.icash_business_conversation_sender(p_account uuid,p_screening uuid,p_recipient text)
returns text language plpgsql stable security invoker set search_path='' as $$
declare chosen text;identities integer;thread_party text;has_thread boolean:=false;
begin
 if p_recipient is null or p_recipient!~'^\+[1-9][0-9]{7,14}$'
  or not exists(select 1 from public.icash_screening_jobs s where s.id=p_screening and s.account_id=p_account)
  then return null;end if;
 if exists(select 1 from public.icash_text_suppressions where phone=p_recipient)
  or exists(select 1 from public.icash_webinar_phone_suppressions where phone=p_recipient)
  or exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(p_recipient,'UTF8')),'hex'))
  then return null;end if;

 -- An existing exact conversation wins before considering call history. Never
 -- hide a disabled or conflicting established identity by choosing a new one.
 select count(distinct t.sender),min(t.sender),min(t.party)
 into identities,chosen,thread_party
 from public.icash_non_test_text_threads t
 join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
 where t.account_id=p_account and d.screening_id=p_screening
  and t.recipient=p_recipient and t.retired_at is null;
 if identities>1 then return null;end if;
 has_thread:=identities=1;
 if not has_thread then
  -- Admission already saves the actual caller identity before provider work.
  -- Do not retry unknown outcomes through a different business number.
  select count(distinct history.sender),min(history.sender) into identities,chosen
  from (
   select r.from_phone sender from public.icash_call_recordings r
   where r.account_id=p_account and r.screening_id=p_screening and r.to_phone=p_recipient
   union all
   select c.business_phone sender from public.icash_customer_phone_calls c
   where c.account_id=p_account and c.screening_id=p_screening and c.recipient_phone=p_recipient
  ) history;
  if identities>1 then return null;end if;
 end if;

 select s.phone into chosen from public.icash_text_senders s
 where s.enabled and (chosen is null or s.phone=chosen)
  and (s.phone='+14243948384' or exists(
   select 1 from public.icash_business_voice_numbers n
   where n.phone=s.phone and n.phone in ('+14244377030','+17208134296')
    and n.outbound_enabled and n.forwarding_ready and n.caller_id_sid is not null))
  and not public.icash_text_role_conflict(s.phone,p_recipient)
  and not exists(select 1 from public.icash_sms_routes route
   where route.sender=s.phone and route.recipient=p_recipient
    and (route.account_id<>p_account or route.needs_review))
  and not exists(
   select 1 from public.icash_non_test_text_threads t
   join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
   where t.sender=s.phone and t.recipient=p_recipient
    and (t.account_id<>p_account or (t.retired_at is null
     and case when has_thread then t.party<>thread_party else d.screening_id<>p_screening end)))
  -- A call-first pair belonging to another account is as binding as an SMS
  -- route. Keep its inbound account identity unambiguous before any text exists.
  and not exists(select 1 from public.icash_call_recordings r
   where r.from_phone=s.phone and r.to_phone=p_recipient and r.account_id<>p_account)
  and not exists(select 1 from public.icash_customer_phone_calls c
   where c.business_phone=s.phone and c.recipient_phone=p_recipient and c.account_id<>p_account)
 order by encode(sha256(convert_to(p_account::text||':'||p_screening::text||':'||p_recipient||':'||s.phone,'UTF8')),'hex'),s.phone
 limit 1;
 return chosen;
end $$;

create function public.icash_property_call_sender(p_account uuid,p_screening uuid,p_recipient text)
returns text language sql stable security invoker set search_path='' as $$
 select public.icash_business_conversation_sender(p_account,p_screening,p_recipient);
$$;

-- Retain the legacy mutation-side lock. Eligibility probes below call the
-- STABLE core directly, using a real screening even before a draft exists.
create or replace function public.icash_property_text_sender(p_account uuid,p_deal uuid,p_recipient text)
returns text language plpgsql security invoker set search_path='' as $$
declare screening uuid;
begin
 perform pg_advisory_xact_lock(818,1);
 select d.screening_id into screening from public.icash_deal_files d
 where d.id=p_deal and d.account_id=p_account;
 if screening is null then return null;end if;
 return public.icash_business_conversation_sender(p_account,screening,p_recipient);
end $$;

-- Manual/browser calling still requires an actual allowed contact. The same
-- function is rechecked by final call admission and may also serve GET previews.
create or replace function public.icash_customer_call_sender(p_account uuid,p_screening uuid,p_recipient text)
returns text language sql security invoker set search_path='' as $$
 select public.icash_business_conversation_sender(p_account,p_screening,p_recipient)
 where exists(select 1 from public.icash_manual_contacts(p_account,p_screening) c
  where c.phone=p_recipient and not c.blocked);
$$;

revoke all on function public.icash_business_conversation_sender(uuid,uuid,text),
 public.icash_property_call_sender(uuid,uuid,text),public.icash_property_text_sender(uuid,uuid,text),
 public.icash_customer_call_sender(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_business_conversation_sender(uuid,uuid,text),
 public.icash_property_call_sender(uuid,uuid,text),public.icash_property_text_sender(uuid,uuid,text),
 public.icash_customer_call_sender(uuid,uuid,text) to service_role;

do $probes$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.icash_project_operational_sms_contacts(uuid)'::regprocedure);
 needle:='public.icash_property_text_sender(oc.account_id,(select existing.id from public.icash_deal_files existing where existing.account_id=oc.account_id and existing.screening_id=oc.screening_id),oc.phone)';
 replacement:='public.icash_business_conversation_sender(oc.account_id,oc.screening_id,oc.phone)';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
  raise exception 'Operational SMS candidate sender boundary changed';end if;
 definition:=replace(definition,needle,replacement);
 needle:='v_sender:=public.icash_property_text_sender(c.account_id,deal,c.phone);';
 replacement:='perform pg_advisory_xact_lock(818,1);'||chr(10)||'  v_sender:=public.icash_business_conversation_sender(c.account_id,c.screening_id,c.phone);';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
  raise exception 'Operational SMS draft sender boundary changed';end if;
 execute replace(definition,needle,replacement);
end $probes$;

-- Final admission, not a preview, serializes with new SMS thread creation and
-- rechecks the supplied caller. Existing recorded operations keep their original
-- immutable retry path even after sender settings or contact permissions change.
do $admission$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.icash_create_direct_recorded_call(uuid,text,text,text,text,text,text,jsonb,jsonb)'::regprocedure);
 needle:=' select j.id as job_id,j.permission_id,j.operational_contact_id,p.screening_id,p.party,p.phone,p.contact_key,c.agent_id,o.rate_id,o.charge_cap_cents into b';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
  raise exception 'Recorded call bound contact boundary changed';end if;
 -- Match SMS/manual admission lock order before account FKs or bound job locks.
 definition:=replace(definition,needle,' perform 1 from public.icash_operating_budget where id=1 for update;'||chr(10)||' perform pg_advisory_xact_lock(818,1);'||chr(10)||needle);
 needle:=' insert into public.icash_call_recordings(entry_policy,account_id,operation_key,voice_job_id,permission_id,operational_contact_id,screening_id,party,call_context,provider_account_sid,call_sid,';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
  raise exception 'Recorded call admission boundary changed';end if;
 replacement:=$guard$ if p_context->>'fromPhone' is distinct from public.icash_property_call_sender(p_account,b.screening_id,b.phone)
  then return null;end if;
$guard$||needle;
 execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('public.icash_begin_customer_phone_call(uuid,uuid,uuid,text,text,uuid,text,text,text,jsonb)'::regprocedure);
 needle:=' if p_sender is null or p_sender is distinct from public.icash_customer_call_sender(p_account,p_screening,p_recipient) then';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
  raise exception 'Manual call sender admission boundary changed';end if;
 execute replace(definition,needle,' perform pg_advisory_xact_lock(818,1);'||chr(10)||needle);
end $admission$;

-- Balance new access/customer-update conversations; preserve saved recipients.
-- This does not enroll recipients or enable the disabled webinar reminders.
create or replace function public.icash_webinar_campaign_sender(p_recipient text)
returns text language plpgsql security invoker set search_path='' as $$
declare chosen text;
begin
 if p_recipient is null or p_recipient!~'^\+[1-9][0-9]{7,14}$' then return null;end if;
 perform pg_advisory_xact_lock(818,1);
 select a.sender into chosen from public.icash_webinar_text_assignments a where a.recipient=p_recipient;
 if chosen is not null then
  return case when exists(select 1 from public.icash_webinar_text_senders where phone=chosen and enabled)
   and not exists(select 1 from public.icash_text_threads where sender=chosen and recipient=p_recipient and retired_at is null)
   then chosen else null end;
 end if;
 select s.phone into chosen
 from public.icash_webinar_text_senders s
 left join public.icash_webinar_text_assignments a on a.sender=s.phone
 where s.enabled and not exists(select 1 from public.icash_text_threads t where t.sender=s.phone and t.recipient=p_recipient and t.retired_at is null)
 group by s.phone order by count(a.recipient),s.phone limit 1;
 if chosen is not null then insert into public.icash_webinar_text_assignments(recipient,sender) values(p_recipient,chosen);end if;
 return chosen;
end $$;
revoke all on function public.icash_webinar_campaign_sender(text) from public,anon,authenticated;
grant execute on function public.icash_webinar_campaign_sender(text) to service_role;

commit;
