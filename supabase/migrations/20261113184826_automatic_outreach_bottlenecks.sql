-- Keep a new seller conversation usable for its already-eligible call, and
-- recover only proven unstarted number preflight failures through normal dispatch.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

do $routing$
declare d text:=pg_get_functiondef('public.icash_business_conversation_sender(uuid,uuid,text,boolean)'::regprocedure);
 needle text:=' -- Check health only after deterministic selection, avoiding a health query';
begin
 if md5(d)<>'91e104e38ecb9495aff2033cc4acdb47' then raise exception 'Automatic outreach routing prerequisite changed';end if;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Automatic outreach routing boundary changed';end if;
 d:=replace(d,'require_voice boolean:=p_voice;','require_voice boolean:=p_voice;require_sms boolean:=false;');
 d:=replace(d,needle,$new$ -- eligible_seller_dual_channel_v1: a first SMS must not strand a current
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
 -- Check health only after deterministic selection, avoiding a health query$new$);
 execute replace(d,'  and not (s.phone=any(unavailable))','  and (not require_sms or s.enabled)'||chr(10)||'  and not (s.phone=any(unavailable))');
end $routing$;

-- This append-only receipt already prevents a second recovery for any job.
alter table icash_recording_private.configuration_recoveries
 drop constraint configuration_recoveries_previous_outcome_check,
 add constraint configuration_recoveries_previous_outcome_check check(previous_outcome in
  ('production_agent_review_required','business_number_mismatch','business_number_verification_required'));
create index icash_voice_number_recovery_candidates on public.icash_voice_jobs(account_id,created_at,id)
 where state='held' and outcome in ('business_number_mismatch','business_number_verification_required') and operation_key is null;

do $recovery$
declare d text:=pg_get_functiondef('public.icash_recover_voice_configuration(text,text,text,text,timestamptz)'::regprocedure);
 old_text text;new_text text;
begin
 if md5(d)<>'a076e6723b74a3d167d59703163e78bc' then raise exception 'Automatic outreach recovery prerequisite changed';end if;
 for old_text,new_text in select * from (values
  ($old$target.contact_key,target.screening_id,t.id as ticket_id,$old$,
   $new$target.contact_key,target.screening_id,target.phone,t.id as ticket_id,$new$),
  ($old$t.state='held' and t.outcome='production_agent_review_required'$old$,
   $new$t.state='held' and t.outcome=v.outcome$new$),
  ($old$v.state='held' and v.outcome='production_agent_review_required'$old$,
   $new$v.state='held' and v.outcome in ('production_agent_review_required','business_number_mismatch','business_number_verification_required')$new$),
  ($old$  where public.icash_membership_work_allowed(candidate.account_id)$old$,
   $new$  -- Number failures only re-enter the queue when their current exact route
  -- is usable. Dispatch must still verify the provider before any admission.
  where (candidate.outcome='production_agent_review_required'
    or public.icash_property_call_sender(candidate.account_id,candidate.screening_id,candidate.phone) is not null)
   and public.icash_membership_work_allowed(candidate.account_id)$new$)
 ) replacements(old_value,new_value) loop
  if (length(d)-length(replace(d,old_text,'')))/length(old_text)<>1 then raise exception 'Automatic outreach recovery boundary changed';end if;
  d:=replace(d,old_text,new_text);
 end loop;
 execute d;
end $recovery$;
commit;
