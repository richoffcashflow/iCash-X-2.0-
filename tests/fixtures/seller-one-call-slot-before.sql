CREATE OR REPLACE FUNCTION public.icash_voice_queue_slot_open(p_account uuid, p_job uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select exists(
  select 1 from public.icash_voice_jobs j
  join public.icash_voice_contact_targets target on target.id=coalesce(j.permission_id,j.operational_contact_id)
   and target.account_id=j.account_id and target.party='seller' and target.contact_key is not null
   and ((j.permission_id is not null and j.operational_contact_id is null and target.eligibility_source='operator_record')
    or (j.permission_id is null and j.operational_contact_id is not null and target.eligibility_source='operational_checks_only'))
  where j.id=p_job and j.account_id=p_account and j.state='ready'
 and public.icash_voice_capacity_available(j.account_id,(select agent_id from public.icash_voice_configs where account_id=j.account_id),'voice:'||j.id,target.contact_key,false)
  and not exists(
   select 1 from public.icash_voice_jobs busy where busy.id<>j.id
    and (busy.state in ('issued','dispatching') or (busy.state='held' and busy.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry')))
    and (exists(
     select 1 from public.icash_voice_contact_targets other where other.id=coalesce(busy.permission_id,busy.operational_contact_id)
      and other.account_id=busy.account_id and other.contact_key=target.contact_key
      and ((busy.permission_id is not null and busy.operational_contact_id is null and other.eligibility_source='operator_record')
       or (busy.permission_id is null and busy.operational_contact_id is not null and other.eligibility_source='operational_checks_only')))))
  and not exists(select 1 from public.icash_live_conversations live where live.state in ('waiting','review')
   and (live.contact_key=target.contact_key))
 );
$function$;
