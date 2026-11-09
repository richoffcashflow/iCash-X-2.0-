CREATE OR REPLACE FUNCTION public.icash_seller_phone_call_current(p_account uuid, p_job uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
 -- Owner self-demonstrations require their own fresh form receipt even when
 -- the rolling-day window clears. Expired requests cannot dial tomorrow.
 if p_account='48dfb798-8c1a-404f-88c0-c396cc067062'::uuid and p.phone='+12142185280'
  and exists(select 1 from public.icash_contact_permissions cp
   join public.icash_seller_intakes l on l.id=cp.seller_intake_id
   where cp.id=j.permission_id and cp.account_id=p_account and l.contact_consent_scope='icash_x_demo') then
  return public.icash_owner_demo_call_current(p_account,p_job);
 end if;
 -- One new automatic introduction per phone per rolling day. Other properties
 -- do not create permission to call the same person again immediately.
 return n=0;
end $function$;
