-- Check the existing account channel policy only after cheap first-call route
-- exclusions. Keep it before the full validator and the unchanged batch limit.
-- CASE prevents a disabled/NULL channel from evaluating the locking validator.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $migration$
declare definition text;
 original_inner text:=$inner$ where public.icash_outreach_voice_current(op.account_id) and op.channel='voice' and op.revoked_at is null and op.eligibility_until>now()$inner$;
 replacement_inner text:=$new_inner$ where op.channel='voice' and op.revoked_at is null and op.eligibility_until>now()$new_inner$;
 original_outer text:=$outer$ ) select op.* from candidates op
 where (not exists(select 1 from public.icash_dnc_verification_receipts receipt where receipt.id=op.dnc_receipt_id and receipt.evidence_kind='national_provider_observation')
  or public.icash_operational_contact_current(op.account_id,op.id,'voice',false))
 order by op.created_at,op.id limit 100$outer$;
 replacement_outer text:=$new_outer$ ) select op.* from candidates op
 where case when public.icash_outreach_voice_current(op.account_id) then
  (not exists(select 1 from public.icash_dnc_verification_receipts receipt where receipt.id=op.dnc_receipt_id and receipt.evidence_kind='national_provider_observation')
   or public.icash_operational_contact_current(op.account_id,op.id,'voice',false))
  else false end
 order by op.created_at,op.id limit 100$new_outer$;
begin
 definition:=pg_get_functiondef('public.icash_queue_voice_jobs()'::regprocedure);
 if position('with prior_first_routes as materialized (' in definition)=0
  or position('), candidates as materialized (' in definition)=0
  or (length(definition)-length(replace(definition,original_inner,'')))<>length(original_inner)
  or (length(definition)-length(replace(definition,original_outer,'')))<>length(original_outer) then
  raise exception 'Voice channel candidate prerequisite changed';
 end if;
 execute replace(replace(definition,original_inner,replacement_inner),original_outer,replacement_outer);
end $migration$;
commit;
