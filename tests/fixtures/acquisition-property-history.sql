select fixture_preflight_seed(n,false,interval '6 minutes') from generate_series(1,2) n;
create index icash_screening_account on public.icash_screening_jobs(account_id,created_at desc);
create index icash_owner_contacts_account on public.icash_owner_contacts(account_id,created_at desc);
insert into public.icash_screening_jobs(id,account_id,event_key,snapshot,state,result,completed_at)
select md5('property-index-history-'||n)::uuid,s.account_id,'property-index-history-'||n,
 jsonb_set(s.snapshot,'{propertyId}',to_jsonb('prop_history_'||case when n>400 then n-400 else n end)),
 'complete',s.result,now()-case when n<=400 then interval '25 hours' else interval '1 hour' end
from public.icash_screening_jobs s cross join generate_series(1,500) n
where s.id=md5('priority-screening-1')::uuid;
insert into public.icash_owner_contacts(screening_id,account_id,operation_key,result,created_at)
select s.id,s.account_id,'owners:'||s.account_id||':'||s.id,'{"contacts":[]}',now()-interval '1 day'
from public.icash_screening_jobs s
where s.id in (select md5('property-index-history-'||n)::uuid from generate_series(1,50) n);
insert into public.icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,state,permission_until)
select 'owners:'||s.account_id||':'||s.id,s.account_id,md5('priority-rate-1')::uuid,gen_random_uuid(),105,250000,
 case when n%2=0 then 'reserved' else 'dispatched' end,now()-interval '1 day'
from generate_series(51,60) n join public.icash_screening_jobs s on s.id=md5('property-index-history-'||n)::uuid;
-- SQL NULL and non-string JSON values are retained exactly; the index extracts
-- the same text as the existing guards and never introduces a cast/normalizer.
insert into public.icash_screening_jobs(id,account_id,event_key,snapshot,state,result,completed_at)
select md5('property-index-null-'||n)::uuid,s.account_id,'property-index-null-'||n,
 case when n=1 then s.snapshot-'propertyId' when n=2 then jsonb_set(s.snapshot,'{propertyId}','null')
  else jsonb_set(s.snapshot,'{propertyId}','{"synthetic":"non-string"}') end,
 'complete',s.result,now()-interval '1 hour'
from public.icash_screening_jobs s cross join generate_series(1,3) n
where s.id=md5('priority-screening-1')::uuid;
analyze public.icash_screening_jobs;
analyze public.icash_owner_contacts;
analyze public.icash_operation_spend;
