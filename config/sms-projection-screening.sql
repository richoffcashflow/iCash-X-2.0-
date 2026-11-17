-- Reject prospects that the existing final projection cannot use before its
-- expensive source/routing checks and 100-candidate limit. No outreach occurs
-- here; all original locked checks and final dispatch admission remain intact.
begin;
set local lock_timeout='3s';
set local statement_timeout='8s';
do $patch$
declare definition text;
 needle text:=$old$ ), quality_candidates as materialized ($old$;
 replacement text:=$new$   and exists(select 1 from public.icash_screening_jobs s
    where s.id=oc.screening_id and s.account_id=oc.account_id
     and s.state='complete' and s.result->'financialCheck'->>'status'='eligible'
     and s.completed_at between now()-interval '24 hours' and now()
     and not exists(select 1 from public.icash_property_controls pc
      where pc.account_id=oc.account_id and pc.property_id=s.snapshot->>'propertyId' and pc.manual))
 ), quality_candidates as materialized ($new$;
begin
 definition:=pg_get_functiondef('public.icash_project_operational_sms_contacts(uuid)'::regprocedure);
 if md5(definition)<>'0f83440f4c7112ad29aa4e8b6e11215c'
  or length(definition)-length(replace(definition,needle,''))<>length(needle) then
  raise exception 'SMS projection screening prerequisite changed';
 end if;
 execute replace(definition,needle,replacement);
end $patch$;
commit;
