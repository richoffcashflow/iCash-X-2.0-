-- Count original, receipt-backed seller intake texts before an address is known.
-- Read-only presentation repair; no sends, contacts, balances or receipts change.
-- The migration runner owns the transaction together with its history entry.
set local lock_timeout='2s';
set local statement_timeout='10s';
do $patch$
declare definition text;needle text;before_acl aclitem[];before_owner oid;
begin
 select pg_get_functiondef(p.oid),p.proacl,p.proowner into strict definition,before_acl,before_owner
 from pg_proc p where p.oid='public.icash_activity_report(uuid,integer,text)'::regprocedure
 and p.provolatile='s' and not p.prosecdef and p.proconfig=array['search_path=""'];
 if md5(definition)<>'869238dd65e4d8af148e32757577db69'
  or before_acl is distinct from '{postgres=X/postgres,service_role=X/postgres}'::aclitem[]
 then raise exception 'Activity report prerequisite changed';end if;
 needle:=$old$   join real_properties s on s.id=d.screening_id
   left join public.icash_operation_spend o on o.account_id=m.account_id and o.operation_key='text:'||m.id$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Activity text source changed';end if;
 definition:=replace(definition,needle,$new$   join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
   left join public.icash_operation_spend o on o.account_id=m.account_id and o.operation_key='text:'||m.id$new$);
 needle:=$old$   and s.property_id is not null and left(s.property_id,9)<>'practice_' and coalesce(d.terms->>'practice','false')<>'true'
   and coalesce(o.dispatched_at,m.created_at)>=starts and coalesce(o.dispatched_at,m.created_at)<=ends),$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Activity text eligibility changed';end if;
 definition:=replace(definition,needle,$new$   and coalesce(s.snapshot->>'practice','false')<>'true' and coalesce(d.terms->>'practice','false')<>'true'
   and (
    (s.state='complete'
     and coalesce(nullif(s.result->'property'->>'propertyId',''),nullif(s.snapshot->>'propertyId','')) is not null
     and left(coalesce(nullif(s.result->'property'->>'propertyId',''),nullif(s.snapshot->>'propertyId','')),9)<>'practice_')
    or (s.state='awaiting_address'
     and left(coalesce(nullif(s.result->'property'->>'propertyId',''),nullif(s.snapshot->>'propertyId',''),''),9)<>'practice_'
     and exists(select 1 from public.icash_meta_leads intake
      join public.icash_meta_lead_messages receipt on receipt.lead_id=intake.lead_id and receipt.message_id=m.id
      where intake.account_id=m.account_id and intake.screening_id=s.id and intake.lead_id=t.seller_intake_id))
   )
   and coalesce(o.dispatched_at,m.created_at)>=starts and coalesce(o.dispatched_at,m.created_at)<=ends),$new$);
 execute definition;
 if not exists(select 1 from pg_proc p where p.oid='public.icash_activity_report(uuid,integer,text)'::regprocedure
  and p.provolatile='s' and not p.prosecdef and p.proconfig=array['search_path=""']
  and p.proacl is not distinct from before_acl and p.proowner=before_owner
  and md5(pg_get_functiondef(p.oid))=md5(definition))
 then raise exception 'Activity report postcondition failed';end if;
end $patch$;
