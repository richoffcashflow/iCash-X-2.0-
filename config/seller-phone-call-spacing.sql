-- Recipient-level spacing, including the same phone on another property/account.
-- No job, receipt, wallet, Pause, opt-out or historical approval is rewritten.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create index icash_seller_phone_recent_dials on public.icash_call_recordings(to_phone,dial_claimed_at desc)
 where party='seller' and dial_claimed_at is not null;
create index icash_seller_phone_recent_manual on public.icash_customer_phone_calls(recipient_phone,created_at desc)
 where child_sid is not null;

create function public.icash_seller_phone_call_current(p_account uuid,p_job uuid) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare j public.icash_voice_jobs;p public.icash_voice_contact_targets;n bigint;last_attempt timestamptz;unknown_attempt boolean;
begin
 select * into j from public.icash_voice_jobs where id=p_job and account_id=p_account;
 if not found then return false;end if;
 select * into p from public.icash_voice_contact_targets
 where id=coalesce(j.permission_id,j.operational_contact_id) and account_id=p_account and party='seller'
 and ((j.permission_id is not null and j.operational_contact_id is null and eligibility_source='operator_record')
  or (j.permission_id is null and j.operational_contact_id is not null and eligibility_source='operational_checks_only'));
 if not found or p.phone is null or p.phone !~ '^\+[1-9][0-9]{7,14}$' then return false;end if;
 if exists(select 1 from public.icash_call_recordings r where r.voice_job_id=p_job
  and (r.account_id is distinct from p_account or r.to_phone is distinct from p.phone)) then return false;end if;
 select count(*),max(at),coalesce(bool_or(unknown),false) into n,last_attempt,unknown_attempt from (
  select r.dial_claimed_at at,(r.call_sid is null and r.call_ended_at is null) unknown
  from public.icash_call_recordings r
  where r.party='seller' and r.to_phone=p.phone and r.voice_job_id is distinct from p_job and r.dial_claimed_at is not null
   and (r.dial_claimed_at>now()-interval '24 hours' or (r.call_sid is null and r.call_ended_at is null))
  union all
  select c.created_at,false from public.icash_customer_phone_calls c
  where c.recipient_phone=p.phone and c.child_sid is not null and c.created_at>now()-interval '24 hours'
 ) attempts;
 if unknown_attempt then return false;end if;
 -- Real active conversations, due requested callbacks and validated notices
 -- retain the existing receipt-bound service path. A job flag is not proof.
 if coalesce(public.icash_voice_outreach_context(p_account,p_job)->>'activeConversation','false')='true'
  or public.icash_requested_seller_call_current(p_account,p_job) then return true;end if;
 -- A completed address response followed by a ready cash offer is existing
 -- seller work. Bind it to the original lead, permission, phone and actual call.
 if j.meta_offer_lead_id is not null and exists(
  select 1 from public.icash_meta_leads m
  join public.icash_seller_intakes l on l.id=m.lead_id and l.phone=p.phone
  join public.icash_contact_permissions cp on cp.id=j.permission_id and cp.account_id=m.account_id
   and cp.seller_intake_id=m.lead_id and cp.screening_id=m.screening_id and cp.phone=l.phone
  join public.icash_call_recordings first_call on first_call.voice_job_id=m.voice_job_id
   and first_call.account_id=m.account_id and first_call.to_phone=l.phone and first_call.call_sid is not null
  where m.lead_id=j.meta_offer_lead_id and m.account_id=p_account and m.screening_id=p.screening_id
   and m.address_confirmed_at>=first_call.dial_claimed_at and m.address_confirmed_at<=now()
   and m.offer_ready_at>=m.address_confirmed_at and m.offer_ready_at<=now()
   and m.offer_authorized_at is null and not m.paused and not m.voice_paused and m.declined_at is null
   and cp.revoked_at is null and cp.permission_until>now()
 ) then return true;end if;
 if j.meta_followup_lead_id is not null then
  return n<2 and (last_attempt is null or last_attempt<=now()-interval '2 hours')
   and public.icash_meta_followup_call_current(j.meta_followup_lead_id,p_job);
 end if;
 -- One new automatic introduction per phone per rolling day. Other properties
 -- do not create permission to call the same person again immediately.
 return n=0;
end $$;
revoke all on function public.icash_seller_phone_call_current(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_seller_phone_call_current(uuid,uuid) to service_role;

do $patch$
declare definition text;needle text;signature text;
begin
 -- The follow-up clock starts at the actual initial call, not an earlier SMS
 -- or a delayed lead creation time. Keep the existing single follow-up limit.
 definition:=pg_get_functiondef('public.icash_meta_followup_current(uuid,text)'::regprocedure);
 needle:='where j.id=m.voice_job_id and j.account_id=m.account_id and public.icash_voice_attempt_recorded(j.id)';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Meta actual-call spacing prerequisite changed';end if;
 definition:=replace(definition,needle,needle||$guard$
     and exists(select 1 from public.icash_call_recordings first_call
      where first_call.voice_job_id=j.id and first_call.account_id=j.account_id
       and first_call.call_sid is not null and first_call.dial_claimed_at<=now()-interval '2 hours')$guard$);
 execute definition;

 -- Recheck the same complete follow-up evidence at final dial admission.
 -- Its own not-yet-dialed recording is not a competing call. Every OTHER
 -- unfinished/unknown recording still blocks, including another property.
 needle:='FUNCTION public.icash_meta_followup_current(p_lead uuid, p_step text)';
 if position(needle in definition)=0 then raise exception 'Meta follow-up signature changed';end if;
 definition:=replace(definition,needle,'FUNCTION public.icash_meta_followup_call_current(p_lead uuid, p_job uuid)');
 definition:=replace(definition,'p_step',quote_literal('call'));
 needle:='where m.lead_id=p_lead';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Meta follow-up binding prerequisite changed';end if;
 definition:=replace(definition,needle,needle||$guard$
   and exists(select 1 from public.icash_voice_jobs current_job
    join public.icash_contact_permissions cp on cp.id=current_job.permission_id and cp.account_id=m.account_id
     and cp.seller_intake_id=m.lead_id and cp.screening_id=m.screening_id and cp.phone=l.phone
    where current_job.id=p_job and current_job.account_id=m.account_id
     and current_job.meta_followup_lead_id=m.lead_id and current_job.operational_contact_id is null)$guard$);
 needle:='where r.account_id=m.account_id and r.screening_id=m.screening_id and r.call_ended_at is null';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Meta current recording prerequisite changed';end if;
 execute replace(definition,needle,needle||E'\n    and not (r.voice_job_id is not distinct from p_job and r.call_sid is null and r.dial_claimed_at is null)');
 revoke all on function public.icash_meta_followup_call_current(uuid,uuid) from public,anon,authenticated;
 grant execute on function public.icash_meta_followup_call_current(uuid,uuid) to service_role;

 -- Filter before either fairness LIMIT, preserving the thirty-second slot,
 -- requested-call priority and least-recently-served account order.
 definition:=pg_get_functiondef('public.icash_next_before_fulfillment()'::regprocedure);
 needle:=$old$where v.state='ready' and v.due_at<=now()$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>2 then raise exception 'Voice spacing issuer prerequisite changed';end if;
 execute replace(definition,needle,needle||E'\n and public.icash_seller_phone_call_current(v.account_id,v.id)');

 foreach signature in array array[
  'public.icash_reserve_paced_voice(uuid,uuid,uuid,timestamp with time zone,timestamp with time zone,boolean)',
  'public.icash_claim_voice_job(uuid)',
  'public.icash_meta_claim_voice(uuid,uuid)',
  'public.icash_meta_claim_or_defer_voice(uuid,uuid)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  needle:=case when signature='public.icash_claim_voice_job(uuid)' then
   'not public.icash_voice_outreach_hours_current(j.account_id,p_job)'
   else 'not public.icash_voice_outreach_hours_current(p_account,p_job)' end;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Voice spacing admission prerequisite changed: %',signature;end if;
  execute replace(definition,needle,'('||needle||' or '||replace(needle,'icash_voice_outreach_hours_current','icash_seller_phone_call_current')||')');
 end loop;

 -- Serialize the last check with the durable dial claim. The operational
 -- validator already takes this same recipient lock after the budget lock.
 -- Reconciliation, ongoing calls and every other transition remain unchanged.
 definition:=pg_get_functiondef('public.icash_transition_call_recording(uuid,uuid,text,text,text,jsonb)'::regprocedure);
 needle:=$old$if p_action='claim_dial' then$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Final recipient dial spacing prerequisite changed';end if;
 execute replace(definition,needle,needle||$guard$
  perform pg_advisory_xact_lock(hashtextextended(r.to_phone,74));
  t:=icash_recording_private.clock_now();
  if not public.icash_seller_phone_call_current(r.account_id,r.voice_job_id) then return null;end if;$guard$);
end $patch$;
commit;
