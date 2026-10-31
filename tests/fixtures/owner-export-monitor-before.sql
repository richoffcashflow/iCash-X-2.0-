CREATE OR REPLACE FUNCTION public.icash_refresh_reviewed_workflow_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET statement_timeout TO '10s'
AS $function$
declare report jsonb;
begin
 -- Concurrent maintenance invocations share one snapshot, without replaying work.
 perform pg_advisory_xact_lock(916014);
 if exists(select 1 from icash_reliability_private.snapshots where id=1 and checked_at>now()-interval '30 seconds') then
  select s.report into report from icash_reliability_private.snapshots s where id=1;return report;
 end if;
 with active_texts as not materialized (
  select m.* from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
  left join public.icash_deal_files d on d.id=t.deal_id and d.account_id=m.account_id
  left join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=m.account_id
  where t.retired_at is null and coalesce(d.stage not in ('closed','cancelled'),true) and s.state is distinct from 'archived'
 ), active_envelopes as not materialized (
  select e.* from public.icash_signing_envelopes e join public.icash_deal_files d on d.id=e.deal_id and d.account_id=e.account_id
  left join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=e.account_id
  where d.stage not in ('closed','cancelled') and s.state is distinct from 'archived'
 ), raw_findings as (
  select 'text_receipt'::text kind,m.id resource_id,m.account_id,m.updated_at since
   from active_texts m where m.direction='outgoing' and m.state='dispatching' and m.updated_at<now()-interval '5 minutes'
  union all select 'text_review',m.id,m.account_id,m.updated_at from active_texts m
   where m.direction='outgoing' and m.state='needs_review'
  union all select 'contract_delivery',m.id,m.account_id,m.updated_at from public.icash_contract_text_deliveries d
   join active_texts m on m.id=d.message_id and m.account_id=d.account_id
   join active_envelopes e on e.id=d.envelope_id and e.account_id=d.account_id
   where not e.test_mode and e.state='awaiting_counterparty' and m.state in ('ready','accepted') and m.updated_at<now()-interval '10 minutes'
  union all select 'contract_preparation',e.id,e.account_id,e.updated_at from active_envelopes e
   where not e.test_mode and (e.state='needs_review' or e.state='creating' and e.updated_at<now()-interval '5 minutes')
  union all select 'screening_lease',s.id,s.account_id,s.lease_until from public.icash_screening_jobs s
   where s.state='running' and s.lease_until<now()-interval '2 minutes'
  union all select 'call_receipt',v.id,v.account_id,v.updated_at from public.icash_voice_jobs v
   where v.state='dispatching' and v.updated_at<now()-interval '5 minutes'
 union all select kind,resource_id,account_id,since from public.icash_undispatched_outreach_findings()

 ), reviewed as materialized (
  select f.*,a.disposition,a.acknowledged_at from raw_findings f
  left join icash_reliability_private.workflow_acknowledgements a
   on a.kind=f.kind and a.resource_id=f.resource_id and a.account_id=f.account_id and a.since=f.since
 ), findings as (
  select kind,resource_id,account_id,since from reviewed where acknowledged_at is null
 ), texts as (
  select count(*) filter(where state in ('accepted','delivered')) accepted,count(*) filter(where state='delivered') delivered,
   count(*) filter(where state='needs_review') review from public.icash_text_messages where direction='outgoing' and created_at>=now()-interval '24 hours'
 ), contracts as (
  select count(*) filter(where provider_id is not null) created,count(*) filter(where state='completed') completed,
   count(*) filter(where state='needs_review') review from public.icash_signing_envelopes where not test_mode and created_at>=now()-interval '24 hours'
 )
 select jsonb_build_object('checkedAt',now(),'issueCount',(select count(*) from findings),
  'acknowledgedCount',(select count(*) from reviewed where acknowledged_at is not null),
  'acknowledgedIssues',coalesce((select jsonb_agg(to_jsonb(f)) from (
   select kind,resource_id as "resourceId",account_id as "accountId",since,disposition,acknowledged_at as "acknowledgedAt"
   from reviewed where acknowledged_at is not null order by since,kind,resource_id limit 25
  ) f),'[]'::jsonb),
  'issues',coalesce((select jsonb_agg(to_jsonb(f)) from (select kind,resource_id as "resourceId",account_id as "accountId",since from findings order by since,kind,resource_id limit 25) f),'[]'::jsonb),
  'texts',jsonb_build_object('accepted',texts.accepted,'delivered',texts.delivered,'review',texts.review),
  'contracts',jsonb_build_object('created',contracts.created,'completed',contracts.completed,'review',contracts.review)) into report from texts cross join contracts;
 insert into icash_reliability_private.snapshots(id,checked_at,report) values(1,now(),report)
 on conflict(id) do update set checked_at=excluded.checked_at,report=excluded.report;
 return report;
end $function$;
