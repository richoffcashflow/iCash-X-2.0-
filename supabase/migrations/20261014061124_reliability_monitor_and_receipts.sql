begin;
-- Service-only telemetry. No phone numbers, message bodies, tokens or provider calls.
create schema icash_reliability_private;
revoke all on schema icash_reliability_private from public,anon,authenticated;
grant usage on schema icash_reliability_private to service_role;
create table icash_reliability_private.heartbeats(
 component text primary key check(component in ('worker','maintenance')),
 status text not null check(status in ('ok','degraded','standby')),
 checked_at timestamptz not null default now()
);
create table icash_reliability_private.snapshots(
 id integer primary key check(id=1),checked_at timestamptz not null,report jsonb not null
);
alter table icash_reliability_private.heartbeats enable row level security;
alter table icash_reliability_private.snapshots enable row level security;
revoke all on all tables in schema icash_reliability_private from public,anon,authenticated;
grant select,insert,update on all tables in schema icash_reliability_private to service_role;

create function public.icash_record_service_heartbeat(p_component text,p_status text) returns void
language sql security invoker set search_path='' as $$
 insert into icash_reliability_private.heartbeats(component,status) values(p_component,p_status)
 on conflict(component) do update set status=excluded.status,checked_at=now();
$$;

-- Replaying a known receipt is safe even if the first DB response was lost.
-- Never replace a different provider ID or regress a terminal delivery outcome.
create or replace function public.icash_accept_text(p_account uuid,p_message uuid,p_provider text) returns void
language plpgsql security invoker set search_path='' as $$
declare ev jsonb;t public.icash_text_threads;m public.icash_text_messages;
begin
 if p_provider is null or length(btrim(p_provider)) not between 1 and 200 then raise exception 'Invalid provider receipt';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_provider,75));
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account and direction='outgoing' for update;
 if not found then raise exception 'Receipt needs reconciliation';end if;
 if m.provider_id=p_provider and m.state in ('accepted','delivered','needs_review','cancelled') then
  null; -- Reconcile saved callbacks below without resetting the current state.
 else
  if m.provider_id is not null or m.state not in ('dispatching','needs_review') then raise exception 'Receipt needs reconciliation';end if;
  update public.icash_text_messages set provider_id=p_provider,state='accepted',updated_at=now() where id=m.id;
 end if;
 select * into t from public.icash_text_threads where id=m.thread_id and account_id=p_account;
 select payload into ev from public.icash_text_events
 where payload->'data'->>'message_id'=p_provider and payload->'data'->>'from'=t.sender and payload->'data'->>'to'=t.recipient
 and type in ('text.delivery.confirmed','text.delivery.failed','text.cancelled')
 order by (type='text.delivery.confirmed') desc,(payload->>'timestamp')::double precision desc limit 1;
 if ev is not null then
  update public.icash_text_messages set state=case when ev->>'type'='text.delivery.confirmed' then 'delivered' when ev->>'type'='text.cancelled' then 'cancelled' else 'needs_review' end,
   last_delivery_at=to_timestamp((ev->>'timestamp')::double precision) where id=m.id
   and (last_delivery_at is null or last_delivery_at<=to_timestamp((ev->>'timestamp')::double precision))
   and (state<>'delivered' or ev->>'type'='text.delivery.confirmed');
 end if;
end $$;

-- Partial indexes keep the once-per-minute monitor proportional to outstanding work.
create index if not exists icash_reliability_text_dispatch on public.icash_text_messages(updated_at) where direction='outgoing' and state in ('dispatching','needs_review');
create index if not exists icash_reliability_signing_pending on public.icash_signing_envelopes(updated_at) where not test_mode and state in ('creating','needs_review');
create index if not exists icash_reliability_voice_dispatch on public.icash_voice_jobs(updated_at) where state='dispatching';
create index if not exists icash_reliability_text_recent on public.icash_text_messages(created_at) where direction='outgoing';
create index if not exists icash_reliability_signing_recent on public.icash_signing_envelopes(created_at) where not test_mode;

create function public.icash_refresh_reliability_snapshot() returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='10s' as $$
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
 ), findings as (
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
 ), texts as (
  select count(*) filter(where state in ('accepted','delivered')) accepted,count(*) filter(where state='delivered') delivered,
   count(*) filter(where state='needs_review') review from public.icash_text_messages where direction='outgoing' and created_at>=now()-interval '24 hours'
 ), contracts as (
  select count(*) filter(where provider_id is not null) created,count(*) filter(where state='completed') completed,
   count(*) filter(where state='needs_review') review from public.icash_signing_envelopes where not test_mode and created_at>=now()-interval '24 hours'
 )
 select jsonb_build_object('checkedAt',now(),'issueCount',(select count(*) from findings),
  'issues',coalesce((select jsonb_agg(to_jsonb(f)) from (select kind,resource_id as "resourceId",account_id as "accountId",since from findings order by since,kind,resource_id limit 25) f),'[]'::jsonb),
  'texts',jsonb_build_object('accepted',texts.accepted,'delivered',texts.delivered,'review',texts.review),
  'contracts',jsonb_build_object('created',contracts.created,'completed',contracts.completed,'review',contracts.review)) into report from texts cross join contracts;
 insert into icash_reliability_private.snapshots(id,checked_at,report) values(1,now(),report)
 on conflict(id) do update set checked_at=excluded.checked_at,report=excluded.report;
 return report;
end $$;

-- Cheap reads only: counts are calculated by maintenance, never by page polling.
create function public.icash_reliability_status() returns jsonb
language sql stable security invoker set search_path='' as $$
 with components as (
  select wanted.component,case when h.checked_at is null or h.checked_at<now()-interval '3 minutes' then 'unavailable' else h.status end status,h.checked_at
  from (values('worker'),('maintenance')) wanted(component) left join icash_reliability_private.heartbeats h on h.component=wanted.component
 ), snapshot as (select * from icash_reliability_private.snapshots where id=1)
 select jsonb_build_object(
  'status',case when not exists(select 1 from snapshot where checked_at>=now()-interval '3 minutes') or exists(select 1 from components where status<>'ok') or coalesce((select (report->>'issueCount')::bigint from snapshot),0)>0 then 'degraded' else 'ok' end,
  'fresh',exists(select 1 from snapshot where checked_at>=now()-interval '3 minutes'),
  'components',(select jsonb_object_agg(component,jsonb_build_object('status',status,'checkedAt',checked_at)) from components),
  'snapshot',(select report from snapshot));
$$;
revoke all on function public.icash_record_service_heartbeat(text,text),public.icash_refresh_reliability_snapshot(),public.icash_reliability_status(),public.icash_accept_text(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_record_service_heartbeat(text,text),public.icash_refresh_reliability_snapshot(),public.icash_reliability_status(),public.icash_accept_text(uuid,uuid,text) to service_role;
commit;
