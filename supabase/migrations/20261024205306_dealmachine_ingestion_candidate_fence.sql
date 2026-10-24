-- Exclude already ingested/rejected owner sources before rechecking their saved
-- provider proof. All original proof predicates remain before order and LIMIT.
-- No source activation, receipt changes, earlier limit or provider work.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $migration$
declare definition text;
 original_query text:=$original$select oc.account_id,a.owner_user_id,oc.screening_id from public.icash_owner_contacts oc
   join public.icash_accounts a on a.id=oc.account_id
   join public.icash_operation_spend o on o.operation_key=oc.operation_key and o.account_id=oc.account_id and o.state in ('dispatched','settled')
   join public.icash_operation_rates rate on rate.id=o.rate_id and rate.operation='owner_enrichment'
   join public.icash_cost_observations cost on cost.provider='dealmachine' and cost.event_key=o.operation_key and cost.source_ref='dealmachine:owners:'||o.operation_key
   where (p_account is null or oc.account_id=p_account) and not a.bot_paused
    and not exists(select 1 from public.icash_dealmachine_dnc_ingestions i where i.screening_id=oc.screening_id)
    and not exists(select 1 from public.icash_dealmachine_dnc_rejections rejected where rejected.screening_id=oc.screening_id)
    and public.icash_dealmachine_request_started_at(oc.result) between '-infinity'::timestamptz and least(oc.created_at,clock_timestamp())
    and o.operation_key='owners:'||oc.account_id||':'||oc.screening_id and o.dispatched_at is not null
    and o.created_at>=public.icash_dealmachine_request_started_at(oc.result) and o.dispatched_at between o.created_at and oc.created_at
    and cost.units='provider_credits' and to_jsonb(cost.amount)=oc.result->'creditsUsed'
    and cost.observed_at between o.dispatched_at and oc.created_at
    and jsonb_typeof(oc.result->'contacts')='array' and jsonb_typeof(oc.result->'requestedPersonIds')='array'
    and jsonb_array_length(case when jsonb_typeof(oc.result->'contacts')='array' then oc.result->'contacts' else '[]'::jsonb end)<=25
    and jsonb_array_length(case when jsonb_typeof(oc.result->'requestedPersonIds')='array' then oc.result->'requestedPersonIds' else '[]'::jsonb end) between 1 and 25
    and coalesce(oc.result->>'creditsUsed','') ~ '^[0-9]{1,3}$' and oc.result->'providerCredits'->'used'=oc.result->'creditsUsed'
    and exists(select 1 from public.icash_screening_jobs s where s.id=oc.screening_id and s.account_id=oc.account_id and s.state='complete'
     and s.snapshot->>'propertyId'=oc.result->>'propertyId' and coalesce(s.snapshot->>'practice','false')<>'true')
   order by oc.created_at,oc.screening_id limit 100$original$;
 replacement_query text:=$replacement$with candidates as materialized (
 select oc.account_id,oc.screening_id,oc.operation_key,oc.result,oc.created_at,a.owner_user_id from public.icash_owner_contacts oc
 join public.icash_accounts a on a.id=oc.account_id
 where (p_account is null or oc.account_id=p_account) and not a.bot_paused
    and not exists(select 1 from public.icash_dealmachine_dnc_ingestions i where i.screening_id=oc.screening_id)
    and not exists(select 1 from public.icash_dealmachine_dnc_rejections rejected where rejected.screening_id=oc.screening_id)
)
select oc.account_id,oc.owner_user_id,oc.screening_id from candidates oc
   join public.icash_operation_spend o on o.operation_key=oc.operation_key and o.account_id=oc.account_id and o.state in ('dispatched','settled')
   join public.icash_operation_rates rate on rate.id=o.rate_id and rate.operation='owner_enrichment'
   join public.icash_cost_observations cost on cost.provider='dealmachine' and cost.event_key=o.operation_key and cost.source_ref='dealmachine:owners:'||o.operation_key
   where public.icash_dealmachine_request_started_at(oc.result) between '-infinity'::timestamptz and least(oc.created_at,clock_timestamp())
    and o.operation_key='owners:'||oc.account_id||':'||oc.screening_id and o.dispatched_at is not null
    and o.created_at>=public.icash_dealmachine_request_started_at(oc.result) and o.dispatched_at between o.created_at and oc.created_at
    and cost.units='provider_credits' and to_jsonb(cost.amount)=oc.result->'creditsUsed'
    and cost.observed_at between o.dispatched_at and oc.created_at
    and jsonb_typeof(oc.result->'contacts')='array' and jsonb_typeof(oc.result->'requestedPersonIds')='array'
    and jsonb_array_length(case when jsonb_typeof(oc.result->'contacts')='array' then oc.result->'contacts' else '[]'::jsonb end)<=25
    and jsonb_array_length(case when jsonb_typeof(oc.result->'requestedPersonIds')='array' then oc.result->'requestedPersonIds' else '[]'::jsonb end) between 1 and 25
    and coalesce(oc.result->>'creditsUsed','') ~ '^[0-9]{1,3}$' and oc.result->'providerCredits'->'used'=oc.result->'creditsUsed'
    and exists(select 1 from public.icash_screening_jobs s where s.id=oc.screening_id and s.account_id=oc.account_id and s.state='complete'
     and s.snapshot->>'propertyId'=oc.result->>'propertyId' and coalesce(s.snapshot->>'practice','false')<>'true')
   order by oc.created_at,oc.screening_id limit 100$replacement$;
begin
 definition:=pg_get_functiondef('public.icash_prepare_operational_contacts(uuid)'::regprocedure);
 if (length(definition)-length(replace(definition,original_query,'')))<>length(original_query) then
  raise exception 'DealMachine ingestion candidate prerequisite changed';
 end if;
 execute replace(definition,original_query,replacement_query);
end $migration$;
commit;

