begin;
-- Customer-facing totals follow their local calendar, not the server's UTC day.
-- All metrics use persisted events; queued work and practice properties do not count.
create function public.icash_activity_report(p_account uuid,p_days integer,p_timezone text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare starts timestamptz;ends timestamptz:=now();report jsonb;
begin
 if p_days is null or p_days not in (1,7,30) then raise exception 'Invalid reporting period';end if;
 if p_timezone is null or length(p_timezone)>100 or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'Invalid reporting timezone';end if;
 if not exists(select 1 from public.icash_accounts where id=p_account) then return null;end if;
 starts:=(((ends at time zone p_timezone)::date-(p_days-1))::timestamp at time zone p_timezone);
 with real_properties as (
  select id,coalesce(nullif(result->'property'->>'propertyId',''),nullif(snapshot->>'propertyId','')) property_id,completed_at
  from public.icash_screening_jobs where account_id=p_account and state='complete'
  and coalesce(snapshot->>'practice','false')<>'true'
 ), first_leads as (
  select property_id,min(completed_at) added_at from real_properties
  where property_id is not null and left(property_id,9)<>'practice_' and completed_at<=ends group by property_id
 ), call_events as (
  select j.operation_key,coalesce(o.dispatched_at,c.created_at,j.created_at) started_at
  from public.icash_voice_jobs j left join public.icash_operation_spend o on o.operation_key=j.operation_key and o.account_id=j.account_id
  left join public.icash_live_conversations c on c.operation_key=j.operation_key and c.account_id=j.account_id
  where j.account_id=p_account and (nullif(j.provider_call_sid,'') is not null or nullif(j.conversation_id,'') is not null)
  union all
  select operation_key,created_at from public.icash_live_conversations where account_id=p_account and nullif(conversation_id,'') is not null
  union all
  select operation_key,provider_started_at from public.icash_call_recordings where account_id=p_account and provider_started_at is not null and nullif(call_sid,'') is not null
 ), practice_calls as (
  select c.operation_key from public.icash_live_conversations c join public.icash_screening_jobs s on s.id=c.screening_id and s.account_id=c.account_id
  where c.account_id=p_account and (left(coalesce(s.result->'property'->>'propertyId',s.snapshot->>'propertyId'),9)='practice_' or s.snapshot->>'practice'='true')
  union
  select r.operation_key from public.icash_call_recordings r join public.icash_screening_jobs s on s.id=r.screening_id and s.account_id=r.account_id
  where r.account_id=p_account and (left(coalesce(s.result->'property'->>'propertyId',s.snapshot->>'propertyId'),9)='practice_' or s.snapshot->>'practice'='true')
 ), first_calls as (
  select operation_key,min(started_at) started_at from call_events e where operation_key is not null
  and not exists(select 1 from practice_calls p where p.operation_key=e.operation_key) group by operation_key
 )
 select jsonb_build_object('days',p_days,'timezone',p_timezone,'startAt',starts,'endAt',ends,
  'leads',(select count(*) from first_leads where added_at>=starts and added_at<=ends),
  'calls',(select count(*) from first_calls where started_at>=starts and started_at<=ends),
  'texts',(select count(*) from public.icash_text_messages m
   join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
   join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
   join real_properties s on s.id=d.screening_id
   left join public.icash_operation_spend o on o.account_id=m.account_id and o.operation_key='text:'||m.id
   where m.account_id=p_account and m.direction='outgoing' and m.state in ('accepted','delivered') and nullif(m.provider_id,'') is not null
   and s.property_id is not null and left(s.property_id,9)<>'practice_' and coalesce(d.terms->>'practice','false')<>'true'
   and coalesce(o.dispatched_at,m.created_at)>=starts and coalesce(o.dispatched_at,m.created_at)<=ends),
  'contracts',(select count(*) from public.icash_deal_files d join real_properties s on s.id=d.screening_id where d.account_id=p_account and d.seller_signed_at>=starts and d.seller_signed_at<=ends and coalesce(d.terms->>'practice','false')<>'true' and s.property_id is not null and left(s.property_id,9)<>'practice_')
 ) into report;
 return report;
end $$;
revoke all on function public.icash_activity_report(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.icash_activity_report(uuid,integer,text) to service_role;
-- Voice jobs previously only had queue indexes. This report is account-scoped.
create index icash_voice_jobs_account_activity on public.icash_voice_jobs(account_id,created_at) where provider_call_sid is not null or conversation_id is not null;
commit;
