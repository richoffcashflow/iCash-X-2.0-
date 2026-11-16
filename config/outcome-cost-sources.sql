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
