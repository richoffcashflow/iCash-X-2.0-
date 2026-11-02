-- Batch siblings may have an original purchase without an individual ticket.
-- Skip their held work before ranking; never reset the purchase or its money.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;needle text:=' and (t.id is null or (';
begin
 d:=pg_get_functiondef('public.icash_enrichment_before_prospecting_budget(uuid)'::regprocedure);
 if md5(d)<>'b8bca73d70e728aab0a795310577da86'
  or (length(d)-length(replace(d,needle,'')))<>length(needle) then
  raise exception 'Owner candidate prerequisite changed';
 end if;
 execute replace(d,needle,$new$
 and not exists(select 1 from public.icash_operation_spend o where o.operation_key='owners:'||s.account_id||':'||s.id)
 and not exists(select 1 from public.icash_operation_spend o
  join public.icash_screening_jobs prior on o.operation_key='owners:'||s.account_id||':'||prior.id
  where prior.account_id=s.account_id and prior.snapshot->>'propertyId'=s.snapshot->>'propertyId'
   and o.state in ('reserved','dispatched'))
$new$||needle);
end $patch$;
commit;
