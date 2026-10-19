-- Repair only the seller-call inventory lookup. Retain the existing inventory,
-- Meta contact-only exception, reservation chain and immutable usage snapshots.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.icash_reserve_before_activation(uuid,text,uuid,timestamptz,timestamptz,boolean)'::regprocedure);
 needle:=$old$select p.screening_id,p.phone into screen,phone from public.icash_voice_jobs j join public.icash_contact_permissions p on p.id=j.permission_id and p.account_id=j.account_id where j.account_id=p_account and 'voice:'||j.id=p_operation and p.party='seller';$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Seller inventory target boundary changed';end if;
 replacement:=$new$select p.screening_id,p.phone into screen,phone
 from public.icash_voice_jobs j
 join public.icash_voice_contact_targets p on p.id=coalesce(j.permission_id,j.operational_contact_id) and p.account_id=j.account_id
 where j.account_id=p_account and 'voice:'||j.id=p_operation and p.party='seller'
 and (j.permission_id is null)<>(j.operational_contact_id is null)
 and ((j.permission_id is not null and p.eligibility_source='operator_record')
  or (j.operational_contact_id is not null and p.eligibility_source='operational_checks_only'
   and public.icash_operational_contact_current(p_account,j.operational_contact_id,'voice',false)));$new$;
 execute replace(definition,needle,replacement);
end $patch$;
commit;
