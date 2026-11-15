begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;
-- Capture the first actual qualification request prospectively. Shared-directory
-- reuse never assigns the same provider operation to a second property.
do $$
begin
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=to_regprocedure('public.icash_queue_title_qualification(uuid,uuid)')
  and md5(p.prosrc)='c172ac244c10d7b8cec8a080b86bd45f' and not p.prosecdef and p.provolatile='v') then
  raise exception 'Reviewed title qualification queue source required';
 end if;
end $$;

create schema if not exists icash_learning_private;
create table icash_learning_private.title_qualification_origins (
 job_id uuid primary key references public.icash_title_qualification_jobs(id),
 account_id uuid not null references public.icash_accounts(id),
 deal_id uuid not null references public.icash_deal_files(id),
 screening_id uuid references public.icash_screening_jobs(id),
 property_id text check(property_id is null or length(btrim(property_id))>0),
 assigned_at timestamptz not null default now()
);
create index title_qualification_origins_property on icash_learning_private.title_qualification_origins(account_id,property_id,assigned_at);
create table icash_learning_private.title_qualification_reuses (
 job_id uuid not null references public.icash_title_qualification_jobs(id),
 account_id uuid not null references public.icash_accounts(id),
 deal_id uuid not null references public.icash_deal_files(id),
 screening_id uuid references public.icash_screening_jobs(id),
 property_id text check(property_id is null or length(btrim(property_id))>0),
 reused_at timestamptz not null default now(),primary key(job_id,deal_id)
);
create index title_qualification_reuses_property on icash_learning_private.title_qualification_reuses(account_id,property_id,reused_at);
alter table icash_learning_private.title_qualification_origins enable row level security;
alter table icash_learning_private.title_qualification_reuses enable row level security;
revoke all on icash_learning_private.title_qualification_origins,icash_learning_private.title_qualification_reuses from public,anon,authenticated,service_role;
grant usage on schema icash_learning_private to service_role;
grant select on icash_learning_private.title_qualification_origins,icash_learning_private.title_qualification_reuses to service_role;
create policy title_qualification_origins_service_read on icash_learning_private.title_qualification_origins for select to service_role using(true);
create policy title_qualification_reuses_service_read on icash_learning_private.title_qualification_reuses for select to service_role using(true);

create function icash_learning_private.keep_title_cost_attribution() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'Title cost attribution is immutable';end $$;
revoke all on function icash_learning_private.keep_title_cost_attribution() from public,anon,authenticated,service_role;
create trigger keep_title_qualification_origin before update or delete on icash_learning_private.title_qualification_origins
for each row execute function icash_learning_private.keep_title_cost_attribution();
create trigger keep_title_qualification_reuse before update or delete on icash_learning_private.title_qualification_reuses
for each row execute function icash_learning_private.keep_title_cost_attribution();

-- Definer scope is needed only for append-only private attribution. Ordinary
-- roles cannot invoke this queue or write either attribution table.
create or replace function public.icash_queue_title_qualification(p_account uuid,p_deal uuid) returns void
language plpgsql security definer set search_path='' as $$
declare market_name text;st text;screen uuid;prop text;company uuid;job uuid;
begin
 select a.market,d.terms->>'state',s.id,
  case when jsonb_typeof(s.snapshot->'propertyId')='string' and nullif(btrim(s.snapshot->>'propertyId'),'') is not null then s.snapshot->>'propertyId' end
 into market_name,st,screen,prop
 from public.icash_deal_files d join public.icash_disposition_authorities a on a.deal_id=d.id and a.account_id=d.account_id
 left join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
 where d.id=p_deal and d.account_id=p_account and d.stage in ('under_contract','buyer_selected') and a.expires_at>now()
 and exists(select 1 from public.icash_signing_envelopes e where e.id=a.purchase_envelope_id and e.account_id=p_account and e.state='completed' and not e.test_mode);
 if market_name is null or length(market_name)>120 or st !~ '^[A-Z]{2}$' then return;end if;
 if exists(select 1 from public.icash_title_contacts where deal_id=p_deal and account_id=p_account and enabled and verified_until>now()) then return;end if;
 -- Serialize the original unique account/company/market identity before choosing
 -- its first originating deal; ON CONFLICT also preserves external/legacy jobs.
 perform pg_advisory_xact_lock(hashtextextended(p_account::text||':'||market_name,917406251));
 for company in select id from public.icash_title_directory
  where st=any(claimed_states) and status<>'rejected' and public_email is not null and contact_checked_until>now()
  order by case when status='qualified' and verified_until>now() then 0 else 1 end,id limit 2
 loop
  job:=null;
  insert into public.icash_title_qualification_jobs(account_id,company_id,market,state_code)
  values(p_account,company,market_name,st) on conflict do nothing returning id into job;
  if job is not null then
   insert into icash_learning_private.title_qualification_origins(job_id,account_id,deal_id,screening_id,property_id)
   values(job,p_account,p_deal,screen,prop);
  else
   select id into job from public.icash_title_qualification_jobs where account_id=p_account and company_id=company and market=market_name;
   -- A historical job stays originless. A later queue request proves reuse only,
   -- never where that already-created provider work originally belonged.
   if job is not null and not exists(select 1 from icash_learning_private.title_qualification_origins where job_id=job and account_id=p_account and deal_id=p_deal) then
    insert into icash_learning_private.title_qualification_reuses(job_id,account_id,deal_id,screening_id,property_id)
    values(job,p_account,p_deal,screen,prop) on conflict do nothing;
   end if;
  end if;
 end loop;
end $$;
revoke all on function public.icash_queue_title_qualification(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_queue_title_qualification(uuid,uuid) to service_role;

-- Original, property-bound evidence only. This does not settle, assign outcomes,
-- replay work or treat a missing provider receipt as zero cost.
create function icash_learning_private.outcome_cost_sources(p_account uuid)
returns table(property_id text,operation_key text,created_at timestamptz,observed_at timestamptz,
 unattributed boolean,acquisition boolean,share_count integer,share_rank integer)
language sql stable security definer set search_path='' as $function$
 with scope as materialized (
  select s.id,s.snapshot,s.event_key,s.created_at,s.snapshot->>'propertyId' property_id
  from public.icash_screening_jobs s where s.account_id=p_account
   and jsonb_typeof(s.snapshot->'propertyId')='string' and nullif(btrim(s.snapshot->>'propertyId'),'') is not null
 ), deals as materialized (
  select d.id,s.property_id from public.icash_deal_files d join scope s on s.id=d.screening_id where d.account_id=p_account
 ), threads as materialized (
  select t.id,t.recipient,d.property_id from public.icash_text_threads t join deals d on d.id=t.deal_id where t.account_id=p_account
 ), contacts as materialized (
  select t.property_id,encode(sha256(convert_to(t.recipient,'UTF8')),'hex') contact_key from threads t
  union select s.property_id,r.contact_key from public.icash_call_recordings r join scope s on s.id=r.screening_id where r.account_id=p_account
  union select s.property_id,c.contact_key from public.icash_live_conversations c join scope s on s.id=c.screening_id where c.account_id=p_account
 ), inventory as materialized (
  select r.*,a.ids,a.unique_count,
   coalesce(cardinality(r.property_ids)>0 and cardinality(r.property_ids)=r.returned_properties
    and cardinality(r.property_ids)=a.unique_count and array_position(r.property_ids,null) is null
    and not exists(select 1 from unnest(r.property_ids) v where nullif(btrim(v),'') is null)
    and jsonb_typeof(d.result->'rows')='array'
    and jsonb_array_length(case when jsonb_typeof(d.result->'rows')='array' then d.result->'rows' else '[]'::jsonb end)=r.returned_properties
    and a.ids=response.ids and response.valid
    and not exists(select 1 from public.icash_discovery_filter_attribution b join scope s on s.id=b.screening_id
     where b.operation_key=r.operation_key and (b.account_id is distinct from p_account or not s.property_id=any(r.property_ids))),false) valid
  from public.icash_discovery_inventory_receipts r
  left join public.icash_discovery_results d on d.operation_key=r.operation_key and d.account_id=r.account_id
  cross join lateral (select array_agg(distinct v order by v) ids,count(distinct v)::integer unique_count from unnest(r.property_ids) v) a
  cross join lateral (select array_agg(v->>'dm_property_id' order by v->>'dm_property_id') ids,
   bool_and(jsonb_typeof(v->'dm_property_id')='string' and nullif(btrim(v->>'dm_property_id'),'') is not null) valid
   from jsonb_array_elements(case when jsonb_typeof(d.result->'rows')='array' then d.result->'rows' else '[]'::jsonb end) v) response
  where r.account_id=p_account
 ), raw as (
  -- Every attempted channel, including failures without a success receipt.
  select t.property_id,'text:'||m.id operation_key,m.created_at,m.last_delivery_at observed_at,false unattributed,false acquisition,1 share_count,1 share_rank
  from public.icash_text_messages m join threads t on t.id=m.thread_id
  where m.account_id=p_account and m.direction='outgoing' and (m.state in ('dispatching','accepted','delivered') or nullif(m.provider_id,'') is not null
   or exists(select 1 from public.icash_operation_spend o where o.account_id=p_account and o.operation_key='text:'||m.id))
  union all
  select t.property_id,'sms-ai:'||j.id,j.created_at,null,false,false,1,1 from public.icash_text_ai_jobs j join threads t on t.id=j.thread_id
  where j.account_id=p_account and (j.state='analyzing' or nullif(j.provider_id,'') is not null or j.usage is not null
   or exists(select 1 from public.icash_operation_spend o where o.account_id=p_account and o.operation_key='sms-ai:'||j.id))
  union all
  select s.property_id,coalesce(r.operation_key,'missing:recording:'||r.id),r.created_at,r.dial_claimed_at,false,false,1,1
  from public.icash_call_recordings r join scope s on s.id=r.screening_id where r.account_id=p_account
  union all
  select s.property_id,coalesce(c.operation_key,'missing:conversation:'||c.id),c.created_at,c.completed_at,false,false,1,1
  from public.icash_live_conversations c join scope s on s.id=c.screening_id where c.account_id=p_account
  union all
  select s.property_id,coalesce(j.operation_key,'missing:voice-job:'||j.id),j.created_at,null,
   p.screening_id is not null and c.screening_id is not null and p.screening_id<>c.screening_id,false,1,1
  from public.icash_voice_jobs j
  left join public.icash_contact_permissions p on p.id=j.permission_id and p.account_id=j.account_id
  left join public.icash_operational_contacts c on c.id=j.operational_contact_id and c.account_id=j.account_id
  join scope s on s.id=p.screening_id or s.id=c.screening_id
  where j.account_id=p_account and (j.operation_key is not null or j.provider_call_sid is not null or j.state in ('dispatching','dispatched'))
  union all
  select s.property_id,c.operation_key,c.created_at,c.connected_at,false,false,1,1 from public.icash_customer_phone_calls c
  join scope s on s.id=c.screening_id where c.account_id=p_account
  union all
  select d.property_id,r.operation_key,r.created_at,r.call_started_at,t.property_id is distinct from d.property_id,false,1,1
  from icash_recorded_reception_private.sessions r join icash_seller_agreement_private.inbound_bindings b on b.session_id=r.id and b.account_id=r.account_id
  join deals d on d.id=b.deal_id left join threads t on t.id=b.thread_id where r.account_id=p_account
  union all
  -- Caller matching detects an attribution gap; it never proves a property.
  select c.property_id,r.operation_key,r.created_at,r.call_started_at,true,false,1,1
  from icash_recorded_reception_private.sessions r join contacts c on c.contact_key=r.contact_key
  where r.account_id=p_account and not exists(select 1 from icash_seller_agreement_private.inbound_bindings b where b.session_id=r.id and b.account_id=r.account_id)
  union all
  select c.property_id,r.operation_key,r.reserved_at,r.terminal_at,true,false,1,1
  from icash_reception_private.receipts r join contacts c on c.contact_key=r.caller_hash where r.account_id=p_account
  union all
  select d.property_id,'signing:'||e.id,e.created_at,e.updated_at,false,false,1,1
  from public.icash_signing_envelopes e join deals d on d.id=e.deal_id
  where e.account_id=p_account and not e.test_mode and (e.provider_id is not null
   or exists(select 1 from public.icash_operation_spend o where o.account_id=p_account and o.operation_key='signing:'||e.id))
  union all
  select d.property_id,'missing:contract-text-resend:'||r.id,r.created_at,r.updated_at,true,false,1,1
  from public.icash_contract_text_resends r join public.icash_signing_envelopes e on e.id=r.envelope_id and e.account_id=r.account_id
  join deals d on d.id=e.deal_id where r.account_id=p_account and not e.test_mode and r.state in ('dispatching','accepted','needs_review')
  union all
  select d.property_id,'deal-email:'||m.id,m.created_at,m.updated_at,false,false,1,1
  from public.icash_deal_emails m join deals d on d.id=m.deal_id
  where m.account_id=p_account and m.direction='outgoing' and (m.state in ('dispatching','accepted') or m.provider_id is not null
   or exists(select 1 from public.icash_operation_spend o where o.account_id=p_account and o.operation_key='deal-email:'||m.id))
  union all
  select s.property_id,f.operation_key,f.requested_at,f.response_at,false,false,1,1
  from icash_seller_recovery_private.contact_refreshes f join public.icash_operational_contacts c on c.id=f.original_contact_id and c.account_id=f.account_id
  join scope s on s.id=c.screening_id where f.account_id=p_account
  union all
  select t.property_id,f.operation_key,f.requested_at,f.response_at,false,false,1,1
  from icash_seller_recovery_private.contact_refreshes f join public.icash_seller_gaps g on g.id=f.gap_id and g.account_id=f.account_id
  join threads t on t.id=g.thread_id where f.account_id=p_account
  union all
  -- Owner operations retain exact screening keys even when the lookup failed
  -- before producing icash_owner_contacts. Shared batches already allocate their
  -- original unique-person costs to these operations; do not divide again.
  select s.property_id,o.operation_key,o.created_at,o.dispatched_at,false,true,1,1
  from scope s join public.icash_operation_spend o on o.account_id=p_account and o.operation_key='owners:'||p_account||':'||s.id
  union all
  select s.property_id,c.operation_key,c.created_at,public.icash_dealmachine_owner_source_started_at(p_account,s.id),
   c.operation_key is distinct from 'owners:'||p_account||':'||s.id
    or c.result->>'propertyId' is distinct from s.property_id
    or public.icash_dealmachine_saved_owner_result_valid(c.result) is not true
    or public.icash_dealmachine_owner_source_started_at(p_account,s.id) is null,true,1,1
  from public.icash_owner_contacts c join scope s on s.id=c.screening_id where c.account_id=p_account
  union all
  select s.property_id,m.operation_key,m.assigned_at,m.assigned_at,
   m.operation_key is distinct from 'seller-lead:'||m.lead_id||':'||p_account
    or s.event_key is distinct from m.operation_key or s.snapshot#>>'{sellerRequest,id}' is distinct from m.lead_id::text,true,1,1
  from public.icash_seller_matches m join scope s on s.id=m.screening_id where m.account_id=p_account
  union all
  -- Refreshed shared inbound lookups have no property-operation settlement.
  -- Preserve that evidence gap instead of treating the refresh as free.
  select s.property_id,'missing:seller-research-refresh:'||f.id,f.claimed_at,f.completed_at,true,true,1,1
  from public.icash_seller_research_refreshes f join public.icash_seller_matches m on m.lead_id=f.lead_id and m.account_id=p_account
  join scope s on s.id=m.screening_id where s.snapshot#>>'{sellerRequest,id}'=f.lead_id::text
   and (s.id=any(f.applied_screenings) or f.state in ('checking','review'))
  union all
  -- Split only an original full returned-property list, in stable ID order.
  -- Remainders therefore stay deterministic without favoring eventual outcomes.
  select v.property_id,r.operation_key,r.created_at,r.created_at,
   not r.valid or exists(select 1 from scope s join public.icash_discovery_filter_attribution a on a.screening_id=s.id
      where s.property_id=v.property_id and s.event_key=r.operation_key||':'||v.property_id
       and (a.account_id is distinct from p_account or a.operation_key is distinct from r.operation_key)),
   true,greatest(r.unique_count,1),v.rank::integer
  from inventory r cross join lateral unnest(r.ids) with ordinality v(property_id,rank)
  union all
  -- Original attribution without its full inventory list cannot certify a share.
  select s.property_id,a.operation_key,s.created_at,null,true,true,1,1
  from public.icash_discovery_filter_attribution a join scope s on s.id=a.screening_id where a.account_id=p_account
   and not exists(select 1 from inventory r where r.operation_key=a.operation_key and s.property_id=any(r.property_ids))
  union all
  -- A screening created by discovery still needs its original paid-or-explicitly
  -- free page evidence. Losing all three operation/result/attribution rows must
  -- not convert acquisition into an invented zero-dollar input.
  select s.property_id,'missing:discovery-source:'||s.id,s.created_at,null,true,true,1,1
  from scope s where s.event_key like 'discovery:%'
   and not exists(select 1 from inventory r where s.event_key=r.operation_key||':'||s.property_id and s.property_id=any(r.property_ids))
  union all
  -- An uncertain paid page has no known property assignment. NULL is a private
  -- account-level gap marker; consumers must not silently filter it away.
  select null,o.operation_key,o.created_at,o.dispatched_at,true,true,1,1 from public.icash_operation_spend o
  where o.account_id=p_account and o.operation_key ~ ('^discovery:'||p_account||':[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[1-9][0-9]*$')
   and not exists(select 1 from inventory r where r.operation_key=o.operation_key)
   and (o.dispatched_at is not null or o.state not in ('reserved','cancelled'))
  union all
  select d.property_id,r.operation_key,r.created_at,r.created_at,
   r.operation_key not in ('buyers:'||r.deal_id||':'||r.revision||':'||r.page,'buyers:'||r.deal_id||':'||r.revision||':'||r.page||':corporate'),false,1,1
  from public.icash_buyer_search_receipts r join deals d on d.id=r.deal_id where r.operation_key is not null
  union all
  select d.property_id,r.operation_key,r.created_at,r.finished_at,false,false,1,1
  from icash_research_private.requests r join deals d on r.operation_key ~ ('^buyers:'||d.id||':[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[1-9][0-9]*(:corporate)?$')
  where r.account_id=p_account and r.admitted and r.kind='buyer_search'
  union all
  select d.property_id,'title:'||r.id,r.created_at,r.updated_at,false,false,1,1
  from public.icash_title_requests r join deals d on d.id=r.deal_id where r.account_id=p_account
   and (r.state in ('dispatching','sent','needs_review') or r.provider_id is not null
    or exists(select 1 from public.icash_operation_spend o where o.account_id=p_account and o.operation_key='title:'||r.id))
  union all
  select d.property_id,'title-followup:'||t.id,t.created_at,t.updated_at,
   not exists(select 1 from public.icash_title_requests r where r.id=t.request_id and r.account_id=t.account_id and r.deal_id=t.deal_id),false,1,1
  from public.icash_title_tasks t join deals d on d.id=t.deal_id where t.account_id=p_account
   and (t.email_state in ('dispatching','sent','needs_review') or t.email_provider_id is not null
    or exists(select 1 from public.icash_operation_spend o where o.account_id=p_account and o.operation_key='title-followup:'||t.id))
  union all
  select d.property_id,r.operation_key,r.created_at,r.created_at,false,false,1,1
  from public.icash_title_search_results r join deals d on d.id=r.deal_id where r.account_id=p_account
  union all
  select d.property_id,'title-qualify:'||j.id,j.created_at,j.updated_at,
   a.property_id is distinct from d.property_id or a.screening_id is null
    or not exists(select 1 from scope s where s.id=a.screening_id and s.property_id=a.property_id),false,1,1
  from icash_learning_private.title_qualification_origins a join deals d on d.id=a.deal_id
  join public.icash_title_qualification_jobs j on j.id=a.job_id and j.account_id=a.account_id
  where a.account_id=p_account and (j.state in ('dispatching','sent','needs_review') or j.provider_id is not null
   or exists(select 1 from public.icash_operation_spend o where o.account_id=p_account and o.operation_key='title-qualify:'||j.id))
  union all
  -- Valid prospective reuse has no second cost. An originless/contradictory
  -- shared job is an explicit missing source, never a zero-dollar operation.
  select d.property_id,'missing:title-qualification-reuse:'||u.job_id||':'||u.deal_id,u.reused_at,j.updated_at,true,false,1,1
  from icash_learning_private.title_qualification_reuses u join deals d on d.id=u.deal_id
  join public.icash_title_qualification_jobs j on j.id=u.job_id and j.account_id=u.account_id
  where u.account_id=p_account and (u.property_id is distinct from d.property_id
   or not exists(select 1 from scope s where s.id=u.screening_id and s.property_id=u.property_id)
   or not exists(select 1 from icash_learning_private.title_qualification_origins a join deals own on own.id=a.deal_id
    join scope s on s.id=a.screening_id and s.property_id=a.property_id
    where a.job_id=u.job_id and a.account_id=p_account and a.property_id=own.property_id))
   and (j.state in ('dispatching','sent','needs_review') or j.provider_id is not null
    or exists(select 1 from public.icash_operation_spend o where o.account_id=p_account and o.operation_key='title-qualify:'||j.id))
  union all
  select null,'title-qualify:'||j.id,j.created_at,j.updated_at,true,false,1,1
  from public.icash_title_qualification_jobs j where j.account_id=p_account
   and not exists(select 1 from icash_learning_private.title_qualification_origins a where a.job_id=j.id and a.account_id=p_account)
   and (j.state in ('dispatching','sent','needs_review') or j.provider_id is not null
    or exists(select 1 from public.icash_operation_spend o where o.account_id=p_account and o.operation_key='title-qualify:'||j.id))
 ) select * from raw order by property_id nulls first,operation_key,created_at limit 100001;
$function$;
revoke all on function icash_learning_private.outcome_cost_sources(uuid) from public,anon,authenticated;
grant execute on function icash_learning_private.outcome_cost_sources(uuid) to service_role;

-- Assemble and validate the account graph once for a bounded refresh batch.
-- Original settled customer charges are separate from verified supplier costs.
create function icash_learning_private.outcome_window_cost_batch(p_account uuid,p_trials jsonb)
returns table(property_id text,started_at timestamptz,window_days integer,costs jsonb)
language plpgsql stable security definer set search_path='' as $function$
declare valid_trials integer;
begin
 -- Disabled consumers submit []. Do not touch the cost graph in that path.
 if p_account is null or jsonb_typeof(p_trials) is distinct from 'array' then return;end if;
 if jsonb_array_length(p_trials)=0 or jsonb_array_length(p_trials)>2000 then return;end if;
 begin
  select count(*) into valid_trials from jsonb_to_recordset(p_trials) t(property_id text,started_at timestamptz,window_days integer)
  where nullif(btrim(t.property_id),'') is not null and isfinite(t.started_at) and t.window_days in (30,60)
   and t.started_at+make_interval(days=>t.window_days)<=now();
  -- Reviewed consumers use one original first exposure per property. Reject
  -- arbitrary repeated starts before they can multiply the account graph.
  if exists(select 1 from jsonb_to_recordset(p_trials) t(property_id text,started_at timestamptz,window_days integer)
   where nullif(btrim(t.property_id),'') is not null and isfinite(t.started_at) and t.window_days in (30,60)
    and t.started_at+make_interval(days=>t.window_days)<=now()
   group by t.property_id having count(distinct t.started_at)>1) then return;end if;
 exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return;
 end;
 if valid_trials=0 then return;end if;
 return query
 with trials as materialized (
  select row_number() over(order by t.property_id,t.started_at,t.window_days) trial_id,t.* from (
   select distinct x.property_id,x.started_at,x.window_days from jsonb_to_recordset(p_trials) x(property_id text,started_at timestamptz,window_days integer)
   where nullif(btrim(x.property_id),'') is not null and isfinite(x.started_at) and x.window_days in (30,60)
    and x.started_at+make_interval(days=>x.window_days)<=now()
  )t
 ), scope as materialized (
  select s.snapshot->>'propertyId' property_id,min(s.created_at) created_at
  from public.icash_screening_jobs s where s.account_id=p_account
   and coalesce(s.snapshot->>'practice','false')<>'true' and coalesce(s.result->>'practice','false')<>'true'
   and s.snapshot->>'propertyId' not like 'practice_%'
  group by s.snapshot->>'propertyId'
 ), sources as materialized (
  select * from icash_learning_private.outcome_cost_sources(p_account)
 ), source_clocks as materialized (
  select s.*,o.dispatched_at,coalesce(o.dispatched_at,o.created_at,s.created_at) operation_at
  from sources s left join public.icash_operation_spend o on o.account_id=p_account and o.operation_key=s.operation_key
 ), starts as (
  select s.property_id,min(s.operation_at) first_at from source_clocks s group by s.property_id
 ), bounds as materialized (
  select t.*,least(t.started_at,s.created_at,k.first_at) first_at,t.started_at+make_interval(days=>t.window_days) end_at,
   s.property_id is not null scoped
  from trials t left join scope s on s.property_id=t.property_id left join starts k on k.property_id=t.property_id
 ), mappings as materialized (
  select s.operation_key,count(distinct s.property_id) properties,bool_or(s.unattributed or s.property_id is null) ambiguous,
   min(s.share_count) min_shares,max(s.share_count) max_shares,
   count(distinct s.share_rank) ranks,count(distinct (s.property_id,s.share_rank)) property_ranks,
   min(s.share_rank) first_rank,max(s.share_rank) last_rank,bool_and(s.acquisition) acquisition
  from sources s group by s.operation_key
 ), valid_mappings as materialized (
  select m.*,not m.ambiguous and m.properties=m.max_shares and m.min_shares=m.max_shares
   and m.ranks=m.max_shares and m.property_ranks=m.properties and m.first_rank=1 and m.last_rank=m.max_shares
   and (m.max_shares=1 or m.acquisition) valid
  from mappings m
 ), candidate_groups as (
  select b.trial_id,s.operation_key,bool_or(s.unattributed) unattributed,bool_or(s.acquisition) acquisition,
   min(s.share_count) share_count,min(s.share_rank) share_rank,bool_or(not m.valid) conflicting
  from bounds b join source_clocks s on s.property_id=b.property_id join valid_mappings m using(operation_key)
  where s.operation_at between (case when s.acquisition then b.first_at else b.started_at end) and b.end_at
   or (s.dispatched_at is null and s.observed_at between (case when s.acquisition then b.first_at else b.started_at end) and b.end_at)
  group by b.trial_id,s.operation_key
 ), candidates as materialized (
  select k.* from (select g.*,row_number() over(partition by g.trial_id order by g.operation_key) ordinal from candidate_groups g) k
  where k.ordinal<=10001
 ), operation_checks as materialized (
  -- Validate each ledger/coverage operation once, even when it occurs in both
  -- horizons or in multiple conserved acquisition shares.
  select k.operation_key,o.created_at,o.dispatched_at,o.actual_micros,o.cost_basis,
   coalesce(o.charged_cents-v.covered_cents,o.charged_cents) net_cents,
   coalesce(o.state='settled' and o.charged_cents>=0 and o.dispatched_at>=o.created_at
    and o.settled_at between o.dispatched_at and now() and nullif(btrim(o.settlement_evidence),'') is not null
    and ((o.charged_cents=0 and u.n=0) or (o.charged_cents>0 and u.n=1 and u.amount=-o.charged_cents and u.valid))
    and ((v.operation_key is null and c.n=0) or (v.account_id=p_account and v.gross_cents=o.charged_cents and v.customer_cents>=0
     and v.covered_cents>0 and v.customer_cents+v.covered_cents=v.gross_cents and nullif(btrim(v.evidence_ref),'') is not null
     and c.n=1 and c.amount=v.covered_cents and c.valid)),false) verified
  from (select distinct k.operation_key from candidates k) k
  left join public.icash_operation_spend o on o.account_id=p_account and o.operation_key=k.operation_key
  left join public.icash_usage_coverage v on v.operation_key=k.operation_key
  cross join lateral(select count(*) n,min(l.delta_cents) amount,bool_and(l.kind='usage' and nullif(btrim(l.evidence_ref),'') is not null) valid
   from public.icash_credit_ledger l where l.account_id=p_account and l.event_key='usage:'||k.operation_key) u
  cross join lateral(select count(*) n,min(l.delta_cents) amount,bool_and(l.kind='grant' and nullif(btrim(l.evidence_ref),'') is not null) valid
   from public.icash_credit_ledger l where l.account_id=p_account and l.event_key='usage-coverage:'||k.operation_key) c
 ), checked as (
  select k.*,o.actual_micros,o.cost_basis,o.net_cents,
   coalesce(o.verified and not k.unattributed and not k.conflicting and k.share_count>0 and k.share_rank between 1 and k.share_count
    and o.dispatched_at between (case when k.acquisition then b.first_at else b.started_at end) and b.end_at,false) verified
  from candidates k join bounds b using(trial_id) join operation_checks o using(operation_key)
 ), unbound as materialized (
  -- Identify account operations lacking an exact, conserved source once.
  select o.operation_key,coalesce(o.dispatched_at,o.created_at) operation_at,coalesce(m.acquisition,false) acquisition
  from public.icash_operation_spend o left join valid_mappings m on m.operation_key=o.operation_key
  where o.account_id=p_account and (o.dispatched_at is not null or o.state in ('dispatched','settled','needs_review'))
   and coalesce(m.valid,false) is not true
 ), unknown_keys as (
  select b.trial_id,u.operation_key from bounds b join unbound u on u.operation_at<=b.end_at
   and (u.operation_at>=b.first_at or u.acquisition)
  union
  select b.trial_id,s.operation_key from bounds b join sources s on s.property_id is null and s.unattributed
   and (s.created_at<=b.end_at and (s.acquisition or s.created_at>=b.first_at) or s.observed_at between b.first_at and b.end_at)
 ), unknown as (
  select u.trial_id,count(*) n from unknown_keys u group by u.trial_id
 ), totals as (
  select k.trial_id,count(*) n,count(*) filter(where not k.verified) unresolved,count(*) filter(where k.unattributed or k.conflicting) unattributed,
   coalesce(sum(k.net_cents/k.share_count+case when k.share_rank<=mod(k.net_cents,k.share_count) then 1 else 0 end) filter(where k.verified),0) cents,
   coalesce(sum(k.actual_micros/k.share_count+case when k.share_rank<=mod(k.actual_micros,k.share_count) then 1 else 0 end)
    filter(where k.verified and k.cost_basis='verified' and k.actual_micros>=0),0) supplier,
   bool_and(k.verified) complete,bool_and(k.verified and k.cost_basis='verified' and k.actual_micros>=0) supplier_complete
  from checked k group by k.trial_id
 ), source_size as (select count(*) n from sources)
 select b.property_id,b.started_at,b.window_days,
  jsonb_build_object('scope','property-outcome-costs-v1','windowDays',b.window_days,'operationCount',coalesce(t.n,0),
   'costCents',coalesce(t.cents,0),'unresolved',coalesce(t.unresolved,0),'unattributed',coalesce(t.unattributed,0),'unboundOperations',coalesce(u.n,0),
   'truncated',coalesce(t.n>10000,false) or z.n>=100001,
   'providerCostMicros',coalesce(t.supplier,0),'providerCostsComplete',t.supplier_complete is true and coalesce(u.n,0)=0 and coalesce(t.n between 1 and 10000,false) and z.n<100001 and b.scoped,
   'complete',t.complete is true and coalesce(u.n,0)=0 and coalesce(t.n between 1 and 10000,false) and z.n<100001 and b.scoped)
 from bounds b left join totals t using(trial_id) left join unknown u using(trial_id) cross join source_size z
 order by b.trial_id;
end;
$function$;
revoke all on function icash_learning_private.outcome_window_cost_batch(uuid,jsonb) from public,anon,authenticated;
grant execute on function icash_learning_private.outcome_window_cost_batch(uuid,jsonb) to service_role;

-- Preserve the private single-property interface for diagnostics and callers.
create function icash_learning_private.outcome_window_costs(p_account uuid,p_property text,p_start timestamptz,p_days integer)
returns jsonb language sql stable security definer set search_path='' as $function$
 select coalesce((select b.costs from icash_learning_private.outcome_window_cost_batch(p_account,
  jsonb_build_array(jsonb_build_object('property_id',p_property,'started_at',p_start,'window_days',p_days))) b limit 1),
  jsonb_build_object('scope','property-outcome-costs-v1','windowDays',p_days,'operationCount',0,'costCents',0,
   'unresolved',0,'unattributed',0,'unboundOperations',0,'truncated',false,'providerCostMicros',0,'providerCostsComplete',false,'complete',false));
$function$;
revoke all on function icash_learning_private.outcome_window_costs(uuid,text,timestamptz,integer) from public,anon,authenticated;
grant execute on function icash_learning_private.outcome_window_costs(uuid,text,timestamptz,integer) to service_role;

-- Property-bound 30/60-day customer-spend evidence. Supplier costs are reported
-- separately; this is not profit, revenue, or a forecast of completed deals.
create table icash_learning_policy_private.outcome_cost_settings(
 id integer primary key check(id=1),installed_at timestamptz not null default now(),
 enabled_at timestamptz,release_sha text check(release_sha ~ '^[a-f0-9]{40}$'),
 check(enabled_at is null or release_sha is not null)
);
insert into icash_learning_policy_private.outcome_cost_settings(id) values(1);
alter table icash_learning_policy_private.outcome_cost_settings enable row level security;
revoke all on icash_learning_policy_private.outcome_cost_settings from public,anon,authenticated,service_role;
grant select on icash_learning_policy_private.outcome_cost_settings to service_role;
create function public.icash_outcome_cost_learning_active() returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from icash_learning_policy_private.outcome_cost_settings c
  join icash_learning_policy_private.settings s on s.id=c.id and s.enabled and s.release_sha=c.release_sha
  join icash_learning_private.policy_releases r on r.release_sha=c.release_sha
  where c.id=1 and c.enabled_at between c.installed_at and now()
   and r.completed_at between c.installed_at and c.enabled_at and r.registered_at<=now()
   and s.activated_at between r.completed_at and c.enabled_at and s.evidence_after>=r.completed_at)
$$;
create function public.icash_activate_outcome_cost_learning(p_actor uuid,p_release_sha text,p_enabled boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid or p_enabled is null then raise exception 'Owner required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(726341927);perform 1 from public.icash_operating_budget where id=1 for update;
 if not p_enabled then update icash_learning_policy_private.outcome_cost_settings set enabled_at=null where id=1;
  return jsonb_build_object('enabled',false);end if;
 if not exists(select 1 from icash_learning_policy_private.outcome_cost_settings c
  join icash_learning_policy_private.settings s on s.id=c.id and s.enabled and s.release_sha=p_release_sha
  join icash_learning_private.policy_releases r on r.release_sha=s.release_sha
  where c.id=1 and r.completed_at between c.installed_at and now() and r.registered_at<=now()
   and s.activated_at between r.completed_at and now() and s.evidence_after>=r.completed_at) then
  raise exception 'Canonical successful post-install learning release required';end if;
 update icash_learning_policy_private.outcome_cost_settings set release_sha=p_release_sha,
  enabled_at=case when release_sha=p_release_sha and enabled_at>=(select activated_at from icash_learning_policy_private.settings where id=1) then enabled_at else now() end where id=1;
 return jsonb_build_object('enabled',true,'releaseSha',p_release_sha);
end $$;
revoke all on function public.icash_outcome_cost_learning_active(),public.icash_activate_outcome_cost_learning(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.icash_outcome_cost_learning_active(),public.icash_activate_outcome_cost_learning(uuid,text,boolean) to service_role;

alter table public.icash_learning_rollups add column outcome_costs jsonb;

-- Outcome cost rollup columns
do $patch$ declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.icash_refresh_seller_call_learning(uuid)'::regprocedure);
 needle:=$needle$contract_trials,contracts,closing_trials,closings,cost_cents,costs_complete,cost_scope)$needle$;
 replacement:=$replacement$contract_trials,contracts,closing_trials,closings,cost_cents,costs_complete,cost_scope,outcome_costs)$replacement$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Outcome cost rollup columns prerequisite changed';end if;
 execute replace(d,needle,replacement);
end $patch$;

-- Outcome cost rollup columns
do $patch$ declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.icash_refresh_seller_interest_v6(uuid)'::regprocedure);
 needle:=$needle$contract_trials,contracts,closing_trials,closings,cost_cents,costs_complete,cost_scope)$needle$;
 replacement:=$replacement$contract_trials,contracts,closing_trials,closings,cost_cents,costs_complete,cost_scope,outcome_costs)$replacement$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Outcome cost rollup columns prerequisite changed';end if;
 execute replace(d,needle,replacement);
end $patch$;


-- Seller call batches every mature trial against one account cost graph.
do $patch$ declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.icash_refresh_seller_call_learning(uuid)'::regprocedure);
 needle:=$needle$ )
 insert into public.icash_learning_rollups$needle$;
 replacement:=$replacement$ ), outcome_windows as materialized (
  select * from icash_learning_private.outcome_window_cost_batch(p_account,(
   select coalesce(jsonb_agg(jsonb_build_object('property_id',e.property_key,'started_at',e.started_at,'window_days',h.days)),'[]'::jsonb)
   from exposures e cross join (values(30),(60)) h(days)
   where public.icash_outcome_cost_learning_active() and e.started_at<=now()-make_interval(days=>h.days)
  ))
 )
 insert into public.icash_learning_rollups$replacement$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Seller call batched cost prerequisite changed';end if;
 execute replace(d,needle,replacement);
end $patch$;

-- Seller text batches every mature trial against one account cost graph.
do $patch$ declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.icash_refresh_seller_interest_v6(uuid)'::regprocedure);
 needle:=$needle$ )
 insert into public.icash_learning_rollups$needle$;
 replacement:=$replacement$ ), outcome_windows as materialized (
  select * from icash_learning_private.outcome_window_cost_batch(p_account,(
   select coalesce(jsonb_agg(jsonb_build_object('property_id',e.property_key,'started_at',e.started_at,'window_days',h.days)),'[]'::jsonb)
   from exposures e cross join (values(30),(60)) h(days)
   where public.icash_outcome_cost_learning_active() and e.started_at<=now()-make_interval(days=>h.days)
  ))
 )
 insert into public.icash_learning_rollups$replacement$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Seller text batched cost prerequisite changed';end if;
 execute replace(d,needle,replacement);
end $patch$;

-- Seller-call mature cost windows
do $patch$ declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.icash_refresh_seller_call_learning(uuid)'::regprocedure);
 needle:=$needle$is true,'seller-contact-72h-v1'
 from exposures where costs->'priorContact'='false'::jsonb group by context,variant;$needle$;
 replacement:=$replacement$is true,'seller-contact-72h-v1',
  jsonb_build_object('scope','property-outcome-costs-v1','contracts',jsonb_build_object('costCents',coalesce(sum((c30.window_cost->>'costCents')::bigint),0),'complete',(bool_and(coalesce(c30.window_cost->'complete'='true'::jsonb,false)) filter(where e.started_at<=now()-interval '30 days')) is true,'optedOut',count(*) filter(where e.started_at<=now()-interval '30 days' and e.opted_out),'providerCostMicros',coalesce(sum((c30.window_cost->>'providerCostMicros')::bigint),0),'providerCostsComplete',(bool_and(coalesce(c30.window_cost->'providerCostsComplete'='true'::jsonb,false)) filter(where e.started_at<=now()-interval '30 days')) is true),'closings',jsonb_build_object('costCents',coalesce(sum((c60.window_cost->>'costCents')::bigint),0),'complete',(bool_and(coalesce(c60.window_cost->'complete'='true'::jsonb,false)) filter(where e.started_at<=now()-interval '60 days')) is true,'optedOut',count(*) filter(where e.started_at<=now()-interval '60 days' and e.opted_out),'providerCostMicros',coalesce(sum((c60.window_cost->>'providerCostMicros')::bigint),0),'providerCostsComplete',(bool_and(coalesce(c60.window_cost->'providerCostsComplete'='true'::jsonb,false)) filter(where e.started_at<=now()-interval '60 days')) is true))
 from exposures e left join outcome_windows c30(property_id,cost_start,window_days,window_cost) on c30.property_id=e.property_key and c30.cost_start=e.started_at and c30.window_days=30
 left join outcome_windows c60(property_id,cost_start,window_days,window_cost) on c60.property_id=e.property_key and c60.cost_start=e.started_at and c60.window_days=60 where costs->'priorContact'='false'::jsonb group by context,variant;$replacement$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Seller-call mature cost windows prerequisite changed';end if;
 execute replace(d,needle,replacement);
end $patch$;

-- Seller-text mature cost windows
do $patch$ declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.icash_refresh_seller_interest_v6(uuid)'::regprocedure);
 needle:=$needle$is true,'seller-contact-72h-v1'
 from exposures e join costs c on c.thread_id=e.thread_id where not c.prior_contact group by e.variant;$needle$;
 replacement:=$replacement$is true,'seller-contact-72h-v1',
  jsonb_build_object('scope','property-outcome-costs-v1','contracts',jsonb_build_object('costCents',coalesce(sum((c30.window_cost->>'costCents')::bigint),0),'complete',(bool_and(coalesce(c30.window_cost->'complete'='true'::jsonb,false)) filter(where e.started_at<=now()-interval '30 days')) is true,'optedOut',count(*) filter(where e.started_at<=now()-interval '30 days' and e.contact_opted_out),'providerCostMicros',coalesce(sum((c30.window_cost->>'providerCostMicros')::bigint),0),'providerCostsComplete',(bool_and(coalesce(c30.window_cost->'providerCostsComplete'='true'::jsonb,false)) filter(where e.started_at<=now()-interval '30 days')) is true),'closings',jsonb_build_object('costCents',coalesce(sum((c60.window_cost->>'costCents')::bigint),0),'complete',(bool_and(coalesce(c60.window_cost->'complete'='true'::jsonb,false)) filter(where e.started_at<=now()-interval '60 days')) is true,'optedOut',count(*) filter(where e.started_at<=now()-interval '60 days' and e.contact_opted_out),'providerCostMicros',coalesce(sum((c60.window_cost->>'providerCostMicros')::bigint),0),'providerCostsComplete',(bool_and(coalesce(c60.window_cost->'providerCostsComplete'='true'::jsonb,false)) filter(where e.started_at<=now()-interval '60 days')) is true))
 from exposures e join costs c on c.thread_id=e.thread_id left join outcome_windows c30(property_id,cost_start,window_days,window_cost) on c30.property_id=e.property_key and c30.cost_start=e.started_at and c30.window_days=30
 left join outcome_windows c60(property_id,cost_start,window_days,window_cost) on c60.property_id=e.property_key and c60.cost_start=e.started_at and c60.window_days=60 where not c.prior_contact group by e.variant;$replacement$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Seller-text mature cost windows prerequisite changed';end if;
 execute replace(d,needle,replacement);
end $patch$;

-- Canonical outcome cost aggregates
do $patch$ declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.icash_shared_learning_stats(text,text,text)'::regprocedure);
 needle:=$needle$sum(attempts*weight) effective_attempts$needle$;
 replacement:=$replacement$jsonb_build_object('scope','property-outcome-costs-v1','contracts',jsonb_build_object('cost_cents',coalesce(sum((outcome_costs->'contracts'->>'costCents')::bigint),0),'effective_cost_cents',coalesce(sum((outcome_costs->'contracts'->>'costCents')::numeric*weight),0),'effective_opted_out',coalesce(sum((outcome_costs->'contracts'->>'optedOut')::numeric*weight),0),'costs_complete',(bool_and(coalesce(outcome_costs->>'scope'='property-outcome-costs-v1' and outcome_costs->'contracts'->'complete'='true'::jsonb,false)) filter(where contract_trials>0)) is true and public.icash_outcome_cost_learning_active() and (p_domain='seller_calls' or (p_domain='seller_sms' and p_context='cash-question-v6'))),'closings',jsonb_build_object('cost_cents',coalesce(sum((outcome_costs->'closings'->>'costCents')::bigint),0),'effective_cost_cents',coalesce(sum((outcome_costs->'closings'->>'costCents')::numeric*weight),0),'effective_opted_out',coalesce(sum((outcome_costs->'closings'->>'optedOut')::numeric*weight),0),'costs_complete',(bool_and(coalesce(outcome_costs->>'scope'='property-outcome-costs-v1' and outcome_costs->'closings'->'complete'='true'::jsonb,false)) filter(where closing_trials>0)) is true and public.icash_outcome_cost_learning_active() and (p_domain='seller_calls' or (p_domain='seller_sms' and p_context='cash-question-v6')))) outcome_costs,
 sum(attempts*weight) effective_attempts$replacement$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Canonical outcome cost aggregates prerequisite changed';end if;
 execute replace(d,needle,replacement);
end $patch$;

-- Outcome cost validation variables
do $patch$ declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.icash_learning_decision_v2(jsonb,text[],boolean)'::regprocedure);
 needle:=$needle$s jsonb;k text;v numeric;stats jsonb;$needle$;
 replacement:=$replacement$s jsonb;k text;v numeric;window_key text;window_cost jsonb;stats jsonb;$replacement$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Outcome cost validation variables prerequisite changed';end if;
 execute replace(d,needle,replacement);
end $patch$;

-- Outcome cost validation
do $patch$ declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.icash_learning_decision_v2(jsonb,text[],boolean)'::regprocedure);
 needle:=$needle$  foreach k in array integers||numbers loop$needle$;
 replacement:=$replacement$  if s ? 'outcome_costs' and s->'outcome_costs'<>'null'::jsonb then
   if jsonb_typeof(s->'outcome_costs') is distinct from 'object' or s->'outcome_costs'->>'scope' is distinct from 'property-outcome-costs-v1' then return result;end if;
   foreach window_key in array array['contracts','closings'] loop
    window_cost:=s->'outcome_costs'->window_key;
    if jsonb_typeof(window_cost) is distinct from 'object' or jsonb_typeof(window_cost->'costs_complete') is distinct from 'boolean' then return result;end if;
    foreach k in array array['cost_cents','effective_cost_cents','effective_opted_out'] loop
     if jsonb_typeof(window_cost->k) is distinct from 'number' then return result;end if;
     v:=(window_cost->>k)::numeric;
     if v<0 or v>9007199254740991 or (k='cost_cents' and trunc(v)<>v) then return result;end if;
    end loop;
    k:=case window_key when 'contracts' then 'effective_contract_trials' else 'effective_closing_trials' end;
    if jsonb_typeof(s->k) is distinct from 'number' then return result;end if;
    if (window_cost->>'effective_opted_out')::numeric>(s->>k)::numeric then return result;end if;
   end loop;
  end if;
  foreach k in array integers||numbers loop$replacement$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Outcome cost validation prerequisite changed';end if;
 execute replace(d,needle,replacement);
end $patch$;

-- Objective-specific cost denominator
do $patch$ declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.icash_learning_decision_v2(jsonb,text[],boolean)'::regprocedure);
 needle:=$needle$ if objective<>'positive' and exists(select 1 from jsonb_array_elements(stats)r where r->>'cost_scope'='seller-contact-72h-v1') then
  return result||'{"reason":"outcome_window_costs_incomplete"}'::jsonb;end if;$needle$;
 replacement:=$replacement$ if objective<>'positive' and exists(select 1 from jsonb_array_elements(stats)r where r->>'cost_scope'='seller-contact-72h-v1') then
  if exists(select 1 from jsonb_array_elements(stats)r where r->>'cost_scope' is distinct from 'seller-contact-72h-v1'
   or r->'outcome_costs'->>'scope' is distinct from 'property-outcome-costs-v1'
   or r->'outcome_costs'->objective->'costs_complete' is distinct from 'true'::jsonb) then
   return result||'{"reason":"outcome_window_costs_incomplete"}'::jsonb;end if;
  select jsonb_agg(r||jsonb_build_object('cost_cents',r->'outcome_costs'->objective->'cost_cents',
   'effective_cost_cents',r->'outcome_costs'->objective->'effective_cost_cents','effective_opted_out',r->'outcome_costs'->objective->'effective_opted_out','costs_complete',true)) into stats from jsonb_array_elements(stats)r;
 end if;$replacement$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Objective-specific cost denominator prerequisite changed';end if;
 execute replace(d,needle,replacement);
end $patch$;

commit;
