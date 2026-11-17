CREATE OR REPLACE FUNCTION public.icash_business_conversation_sender(p_account uuid, p_screening uuid, p_recipient text, p_voice boolean)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare unavailable text[]:=array[]::text[];existing_identity boolean;chosen text;identities integer;thread_party text;has_thread boolean:=false; require_voice boolean:=p_voice;require_sms boolean:=false;
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

 -- owner_demo_call_capable_v1: retain the original call-now receipt as intent.
 -- Its expiry still controls final dial admission; this selector never renews it.
 if not p_voice and chosen is null
  and p_account='48dfb798-8c1a-404f-88c0-c396cc067062'::uuid
  and public.icash_outreach_voice_current(p_account)
  and exists(
   select 1 from public.icash_accounts a
   join public.icash_seller_intakes l on l.assigned_account=a.id and l.screening_id=p_screening
   join public.icash_seller_matches m on m.lead_id=l.id and m.account_id=a.id and m.screening_id=l.screening_id
   join public.icash_optin_call_requests r on r.lead_id=l.id and r.request_id=l.request_id and r.phone=l.phone
   where a.id=p_account and a.owner_user_id='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid
    and l.phone=p_recipient and l.state='assigned' and l.ai_consented
    and l.contact_consent_scope='icash_x_demo' and l.attribution->>'demoAccountId'=a.id::text
    and r.source='demo_form' and r.account_id=a.id and r.requested_by=a.owner_user_id
    and r.request_version='icash-optin-call-now-2026-10-16.1' and r.request_reference=r.request_version
  ) then require_voice:=true;end if;
 -- eligible_seller_dual_channel_v1: a first SMS must not strand a current
 -- seller call on an SMS-only lease. Existing identities always remain binding.
 if not p_voice and chosen is null and public.icash_outreach_voice_current(p_account)
  and exists(select 1 from public.icash_voice_contact_targets target
   where target.account_id=p_account and target.screening_id=p_screening and target.phone=p_recipient
    and target.party='seller' and target.revoked_at is null and target.permission_until>now())
  then require_voice:=true;end if;
 -- The reverse order has the same requirement: a first seller call with a
 -- current SMS target must not establish a voice-only identity.
 if p_voice and chosen is null and public.icash_outreach_sms_current(p_account)
  and exists(select 1 from public.icash_operational_contacts target
   where target.account_id=p_account and target.screening_id=p_screening and target.phone=p_recipient
    and target.channel='sms' and target.revoked_at is null and target.eligibility_until>now())
  then require_sms:=true;end if;
 -- Check health only after deterministic selection, avoiding a health query
 -- for every number on the normal healthy path. Each rejected sender is removed
 -- from this bounded eligible pool; original identities are never reassigned.
 existing_identity:=chosen is not null;
 loop
 select s.phone into chosen from public.icash_text_senders s
 where (s.enabled or (p_voice and s.phone in ('+14154208230','+16195364770','+16462959838','+18623812530','+17866727869','+16462494809','+15056019451','+15055072937','+15127791343','+16027722055','+14357242174','+17262035755','+17262060050','+17189714119','+16463796122','+13104615259'))) and (chosen is null or s.phone=chosen)
  and (s.phone='+14243948384' or exists(
   select 1 from public.icash_business_voice_numbers n
   where n.phone=s.phone and n.phone in ('+14244377030','+17208134296','+14154208230','+16195364770','+16462959838','+18623812530','+17866727869','+16462494809','+15056019451','+15055072937','+15127791343','+16027722055','+14357242174','+17262035755','+17262060050','+17189714119','+16463796122','+13104615259')
    and n.forwarding_ready and ((n.outbound_enabled and n.caller_id_sid is not null)
    or (not require_voice and n.phone in ('+16462959838','+18623812530','+17866727869','+16462494809','+15056019451','+15055072937','+15127791343','+16027722055','+14357242174','+17262035755','+17262060050','+17189714119','+16463796122','+13104615259')))))
  and (not require_sms or s.enabled)
  and not (s.phone=any(unavailable))
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
 exit when chosen is null or p_voice or existing_identity
  or icash_text_receipt_private.sender_opener_available(chosen);
 unavailable:=array_append(unavailable,chosen);chosen:=null;
 end loop;
 return chosen;
end $function$;
