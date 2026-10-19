-- Filter existing conversations before expensive SMS proof/routing checks.
-- Full eligibility and routing still precede the unchanged order/LIMIT; the
-- insertion loop, source validation, locked rechecks, sender choice and wallet
-- behavior are unchanged. No threads, permissions or provider receipts change.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $migration$
declare definition text;
 original_head text:=$head$for c in select oc.* from public.icash_operational_contacts oc$head$;
 replacement_head text:=$new_head$for c in with candidates as materialized (
 select oc.* from public.icash_operational_contacts oc$new_head$;
 original_proof text:=$proof$
   and (not exists(select 1 from public.icash_dnc_verification_receipts receipt where receipt.id=oc.dnc_receipt_id and receipt.evidence_kind='national_provider_observation')
    or public.icash_operational_contact_current(oc.account_id,oc.id,'sms',false))
$proof$;
 original_route text:=$route$   and public.icash_prospect_sms_route_available($route$;
 replacement_route text:=$new_route$ ) select oc.* from candidates oc
 where (not exists(select 1 from public.icash_dnc_verification_receipts receipt where receipt.id=oc.dnc_receipt_id and receipt.evidence_kind='national_provider_observation')
    or public.icash_operational_contact_current(oc.account_id,oc.id,'sms',false))
   and public.icash_prospect_sms_route_available($new_route$;
begin
 definition:=pg_get_functiondef('public.icash_project_operational_sms_contacts(uuid)'::regprocedure);
 if (length(definition)-length(replace(definition,original_head,'')))<>length(original_head)
  or (length(definition)-length(replace(definition,original_proof,'')))<>length(original_proof)
  or (length(definition)-length(replace(definition,original_route,'')))<>length(original_route) then
  raise exception 'Operational SMS candidate prerequisite changed';
 end if;
 execute replace(replace(replace(definition,original_head,replacement_head),original_proof,chr(10)),original_route,replacement_route);
end $migration$;
commit;
