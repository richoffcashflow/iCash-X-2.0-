-- Complete the explicitly bounded seller-contact window, never total deal economics.
-- Original assignments, provider receipts, contacts and balances remain immutable.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table public.icash_learning_rollups add column cost_scope text;
-- Installing measurements must not activate allocation under an older release.
create table icash_learning_policy_private.seller_contact_settings(
 id integer primary key check(id=1),installed_at timestamptz not null default now(),
 enabled_at timestamptz,release_sha text check(release_sha ~ '^[a-f0-9]{40}$'),
 check(enabled_at is null or release_sha is not null)
);
insert into icash_learning_policy_private.seller_contact_settings(id) values(1);
alter table icash_learning_policy_private.seller_contact_settings enable row level security;
revoke all on icash_learning_policy_private.seller_contact_settings from public,anon,authenticated,service_role;
grant select on icash_learning_policy_private.seller_contact_settings to service_role;
create function public.icash_seller_contact_learning_active() returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from icash_learning_policy_private.seller_contact_settings c
  join icash_learning_policy_private.settings s on s.id=c.id and s.enabled and s.release_sha=c.release_sha
  join icash_learning_private.policy_releases r on r.release_sha=c.release_sha
  where c.id=1 and c.enabled_at between c.installed_at and now()
   and r.completed_at between c.installed_at and c.enabled_at and r.registered_at<=now()
   and s.activated_at between r.completed_at and c.enabled_at and s.evidence_after>=r.completed_at)
$$;
create function public.icash_activate_seller_contact_learning(p_actor uuid,p_release_sha text,p_enabled boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid or p_enabled is null then raise exception 'Owner required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(726341927);perform 1 from public.icash_operating_budget where id=1 for update;
 if not p_enabled then update icash_learning_policy_private.seller_contact_settings set enabled_at=null where id=1;
  return jsonb_build_object('enabled',false);end if;
 if not exists(select 1 from icash_learning_policy_private.seller_contact_settings c
  join icash_learning_policy_private.settings s on s.id=c.id and s.enabled and s.release_sha=p_release_sha
  join icash_learning_private.policy_releases r on r.release_sha=s.release_sha
  where c.id=1 and r.completed_at between c.installed_at and now() and r.registered_at<=now()
   and s.activated_at between r.completed_at and now() and s.evidence_after>=r.completed_at) then
  raise exception 'Canonical successful post-install learning release required';end if;
 update icash_learning_policy_private.seller_contact_settings set release_sha=p_release_sha,
  enabled_at=case when release_sha=p_release_sha and enabled_at>=(select activated_at from icash_learning_policy_private.settings where id=1) then enabled_at else now() end where id=1;
 return jsonb_build_object('enabled',true,'releaseSha',p_release_sha);
end $$;
revoke all on function public.icash_seller_contact_learning_active(),public.icash_activate_seller_contact_learning(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.icash_seller_contact_learning_active(),public.icash_activate_seller_contact_learning(uuid,text,boolean) to service_role;
-- Cost refreshes repeatedly bind one property's existing history. Account-only
-- indexes make this quadratic on active accounts; keep those lookups selective.
create index icash_learning_recording_property on public.icash_call_recordings(account_id,screening_id,created_at) where party='seller';
create index icash_learning_customer_call_property on public.icash_customer_phone_calls(account_id,screening_id,created_at);
create index icash_learning_text_ai_thread on public.icash_text_ai_jobs(account_id,thread_id,created_at);

-- Private aggregate bridge: reception bindings intentionally are not readable by
-- service_role. This function exposes only costs/counts, never contacts or payloads.
create function icash_learning_private.seller_contact_window_costs(p_account uuid,p_property text,p_start timestamptz,p_end timestamptz)
returns jsonb language sql stable security definer set search_path='' as $function$
 with scope as materialized (
  select s.id from public.icash_screening_jobs s
  where s.account_id=p_account and s.snapshot->>'propertyId'=p_property and nullif(p_property,'') is not null
   and isfinite(p_start) and isfinite(p_end) and p_start<=p_end and p_end<=p_start+interval '72 hours' and p_start<=now()
 ), deals as materialized (
  select d.id from public.icash_deal_files d join scope s on s.id=d.screening_id where d.account_id=p_account
 ), threads as materialized (
  select t.id,t.recipient from public.icash_text_threads t join deals d on d.id=t.deal_id
  where t.account_id=p_account and t.party='seller'
 ), contacts as materialized (
  select encode(sha256(convert_to(recipient,'UTF8')),'hex') key from threads
  union select r.contact_key from public.icash_call_recordings r join scope s on s.id=r.screening_id where r.account_id=p_account and r.party='seller'
  union select c.contact_key from public.icash_live_conversations c join scope s on s.id=c.screening_id where c.account_id=p_account and c.party='seller'
 ), raw as (
  select 'text:'||m.id operation_key,m.created_at,m.last_delivery_at observed_at,false unattributed,true contact_source
  from public.icash_text_messages m join threads t on t.id=m.thread_id
  where m.account_id=p_account and m.direction='outgoing' and (m.state in ('dispatching','accepted','delivered') or nullif(m.provider_id,'') is not null
   or exists(select 1 from public.icash_operation_spend o where o.account_id=p_account and o.operation_key='text:'||m.id))
  union all
  select 'sms-ai:'||j.id,j.created_at,null,false,false from public.icash_text_ai_jobs j join threads t on t.id=j.thread_id
  where j.account_id=p_account and (j.state='analyzing' or nullif(j.provider_id,'') is not null or j.usage is not null
   or exists(select 1 from public.icash_operation_spend o where o.account_id=p_account and o.operation_key='sms-ai:'||j.id))
  union all
  select coalesce(r.operation_key,'missing:recording:'||r.id),r.created_at,r.dial_claimed_at,false,true
  from public.icash_call_recordings r join scope s on s.id=r.screening_id where r.account_id=p_account and r.party='seller'
  union all
  select coalesce(c.operation_key,'missing:conversation:'||c.id),c.created_at,c.completed_at,false,true
  from public.icash_live_conversations c join scope s on s.id=c.screening_id where c.account_id=p_account and c.party='seller'
  union all
  select coalesce(j.operation_key,'missing:voice-job:'||j.id),j.created_at,null,false,true
  from public.icash_voice_jobs j
  left join public.icash_contact_permissions p on p.id=j.permission_id and p.account_id=j.account_id and p.party='seller'
  left join public.icash_operational_contacts c on c.id=j.operational_contact_id and c.account_id=j.account_id
  join scope s on s.id=coalesce(p.screening_id,c.screening_id)
  where j.account_id=p_account and (j.operation_key is not null or j.provider_call_sid is not null or j.state in ('dispatching','dispatched'))
  union all
  select c.operation_key,c.created_at,c.connected_at,false,true from public.icash_customer_phone_calls c
  join scope s on s.id=c.screening_id where c.account_id=p_account
  union all
  select r.operation_key,r.created_at,r.call_started_at,b.session_id is null,true
  from icash_recorded_reception_private.sessions r
  left join icash_seller_agreement_private.inbound_bindings b on b.session_id=r.id and b.account_id=r.account_id
  where r.account_id=p_account and (
   exists(select 1 from deals d join threads t on t.id=b.thread_id where d.id=b.deal_id)
   or (b.session_id is null and exists(select 1 from contacts c where c.key=r.contact_key)))
  union all
  -- Legacy inbound sessions have no immutable property binding. A possible
  -- contact match is an attribution gap, never a free or guessed property call.
  select r.operation_key,r.reserved_at,r.terminal_at,true,true from icash_reception_private.receipts r
  where r.account_id=p_account and exists(select 1 from contacts c where c.key=r.caller_hash)
  union all
  -- A purchase-signing provider request also sends a seller invitation. Its
  -- original signing operation is contact-window spend, never a signed outcome.
  select 'signing:'||e.id,e.created_at,e.updated_at,false,true
  from public.icash_signing_envelopes e join deals d on d.id=e.deal_id
  where e.account_id=p_account and e.kind='purchase' and not e.test_mode
   and (e.provider_id is not null or exists(select 1 from public.icash_operation_spend o where o.account_id=p_account and o.operation_key='signing:'||e.id))
  union all
  -- Legacy provider resends have their own uncertain receipt, not an ordinary
  -- text operation. Until complete billing attribution exists, do not call free.
  select 'missing:contract-text-resend:'||r.id,r.created_at,r.updated_at,true,true
  from public.icash_contract_text_resends r join public.icash_signing_envelopes e on e.id=r.envelope_id and e.account_id=r.account_id
  join deals d on d.id=e.deal_id where r.account_id=p_account and e.kind='purchase' and not e.test_mode
   and r.state in ('dispatching','accepted','needs_review')
  union all
  select 'deal-email:'||m.id,m.created_at,m.updated_at,
   not (m.contact_key like 'seller-lead:%' or exists(select 1 from public.icash_signing_envelopes e
    where e.account_id=p_account and e.deal_id=m.deal_id and e.kind='purchase' and m.contact_key like 'signer:'||e.id||':%')),true
  from public.icash_deal_emails m join deals d on d.id=m.deal_id
  where m.account_id=p_account and m.direction='outgoing' and m.contact_key<>'title'
   and not exists(select 1 from public.icash_signing_envelopes e where e.account_id=p_account and e.deal_id=m.deal_id and e.kind='assignment' and m.contact_key like 'signer:'||e.id||':%')
   and (m.state in ('dispatching','accepted') or m.provider_id is not null
    or exists(select 1 from public.icash_operation_spend o where o.account_id=p_account and o.operation_key='deal-email:'||m.id))
  union all
  -- Reminder revalidation incurs a separate paid DNC request. Its original
  -- contact or gap/thread binds it to the property, not the later successor.
  select f.operation_key,f.requested_at,f.response_at,false,false
  from icash_seller_recovery_private.contact_refreshes f
  where f.account_id=p_account and (
   exists(select 1 from public.icash_operational_contacts c join scope s on s.id=c.screening_id
    where c.id=f.original_contact_id and c.account_id=f.account_id)
   or exists(select 1 from public.icash_seller_gaps g join threads t on t.id=g.thread_id
    where g.id=f.gap_id and g.account_id=f.account_id))
 ), keys as materialized (
  select r.operation_key,bool_or(r.unattributed) unattributed from raw r
  left join public.icash_operation_spend o on o.account_id=p_account and o.operation_key=r.operation_key
  where coalesce(o.dispatched_at,o.created_at,r.created_at) between p_start and least(p_end,now())
   or (o.dispatched_at is null and r.observed_at between p_start and least(p_end,now()))
  group by r.operation_key order by r.operation_key limit 10001
 ), costs as (
  select k.*,o.charged_cents,o.actual_micros,o.state='settled' settled,
   coalesce(not k.unattributed and o.state='settled' and o.cost_basis='verified' and o.actual_micros>=0 and o.charged_cents>=0
    and o.dispatched_at>=o.created_at and o.dispatched_at between p_start and least(p_end,now())
    and o.settled_at between o.dispatched_at and now() and nullif(o.settlement_evidence,'') is not null,false) verified
  from keys k left join public.icash_operation_spend o on o.account_id=p_account and o.operation_key=k.operation_key
 ) select jsonb_build_object('scope','seller-contact-72h-v1','operationCount',count(*),'truncated',count(*)>10000,
  'costCents',coalesce(sum(charged_cents) filter(where settled and charged_cents>=0),0),'providerCostMicros',coalesce(sum(actual_micros) filter(where verified),0),
  'unresolved',count(*) filter(where not verified),'unattributed',count(*) filter(where unattributed),
  'priorContact',exists(select 1 from raw r left join public.icash_operation_spend o on o.account_id=p_account and o.operation_key=r.operation_key
   where r.contact_source and coalesce(o.dispatched_at,r.created_at,r.observed_at)<p_start),
  'complete',count(*) between 1 and 10000 and bool_and(verified) is true and exists(select 1 from scope)) from costs;
$function$;
revoke all on function icash_learning_private.seller_contact_window_costs(uuid,text,timestamptz,timestamptz) from public,anon,authenticated;
grant usage on schema icash_learning_private to service_role;
grant execute on function icash_learning_private.seller_contact_window_costs(uuid,text,timestamptz,timestamptz) to service_role;

create function public.icash_refresh_seller_call_learning(p_account uuid) returns void
language plpgsql security invoker set search_path='' as $function$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_account::text,81021));
 delete from public.icash_learning_rollups where account_id=p_account and domain='seller_calls';
 with properties as materialized (
  select id,snapshot->>'propertyId' property_key from public.icash_screening_jobs
  where account_id=p_account and nullif(snapshot->>'propertyId','') is not null
   and coalesce(snapshot->>'practice','false')<>'true' and coalesce(result->>'practice','false')<>'true'
   and left(snapshot->>'propertyId',9)<>'practice_'
 ), outcomes as materialized (
  select p.property_key,min(e.purchase_at) purchase_at,min(e.closed_at) closed_at
  from public.icash_learning_deal_outcomes(p_account) e join properties p on p.id=e.screening_id group by p.property_key
 ), candidates as materialized (
  select a.context,a.variant,r.id,r.screening_id,r.to_phone recipient,p.property_key,o.dispatched_at started_at
  from public.icash_learning_assignments a join public.icash_call_recordings r
   on r.account_id=a.account_id and r.screening_id::text||':'||r.contact_key=a.subject and r.call_context->>'strategyKey'=a.variant
  join properties p on p.id=r.screening_id
  join public.icash_operation_spend o on o.account_id=r.account_id and o.operation_key=r.operation_key
  where a.account_id=p_account and a.domain='seller_calls' and a.policy_version='shared-v1'
   and a.context in ('reviewed','limited') and a.variant in ('cash_interest','flexible_timing')
   and r.party='seller'
   -- Direct calls register their recording/conversation after paid admission.
   -- The original prospective assignment, not registration time, precedes dispatch.
   and o.dispatched_at>=a.created_at and o.dispatched_at<=now()
   -- Dispatched attempts remain trials even if dialing or AI registration fails.
   -- A positive label still requires the separate completed source conversation.
   and position('REVIEWED INTEREST QUESTION (shared-v1/'||a.context||'):' in r.call_context->>'prompt')>0
 ), first_exposures as materialized (
  -- Rescreening and trying another recipient do not create another trial for
  -- the same property or attach one eventual contract to multiple variants.
  select distinct on (property_key) * from candidates order by property_key,started_at,id
 ), exposures as materialized (
  select f.*,e.purchase_at,e.closed_at,
   coalesce(v.interested,false) or coalesce(t.interested,false) interested,
   coalesce(v.opted_out,false) or coalesce(t.opted_out,false) opted_out,
   coalesce(v.held,false) or coalesce(t.held,false) held,
   icash_learning_private.seller_contact_window_costs(p_account,f.property_key,f.started_at,f.started_at+interval '72 hours') costs
  from first_exposures f left join outcomes e on e.property_key=f.property_key
  left join lateral (
   select bool_or(public.icash_call_selling_interest(c.result)) interested,
    bool_or(c.result->'optedOut'='true'::jsonb or public.icash_seller_call_disposition(c.result)='opt_out') opted_out,
    bool_or(public.icash_seller_call_disposition(c.result) is not null) held
   from properties p join public.icash_live_conversations c on c.screening_id=p.id and c.account_id=p_account
   join public.icash_operation_spend o on o.account_id=c.account_id and o.operation_key=c.operation_key
   where p.property_key=f.property_key and c.party='seller' and c.state='complete' and nullif(c.conversation_id,'') is not null
    and o.dispatched_at between f.started_at and c.completed_at
    and c.completed_at between f.started_at and least(f.started_at+interval '72 hours',now())
  ) v on true
  left join lateral (
   select bool_or(public.icash_seller_sms_interest_at(p_account,t.id,f.started_at,f.started_at+interval '72 hours') is not null) interested,
    bool_or(public.icash_seller_response_disposition(m.body)='opt_out') opted_out,
    bool_or(public.icash_seller_response_disposition(m.body) is not null) held
   from properties p join public.icash_deal_files d on d.screening_id=p.id and d.account_id=p_account
   join public.icash_text_threads t on t.deal_id=d.id and t.account_id=p_account and t.party='seller'
   left join public.icash_text_messages m on m.thread_id=t.id and m.account_id=p_account and m.direction='incoming' and m.state='received'
    and (nullif(m.provider_id,'') is not null or nullif(m.event_id,'') is not null)
    and m.created_at between f.started_at and least(f.started_at+interval '72 hours',now())
   where p.property_key=f.property_key
  ) t on true
  where f.started_at between now()-interval '180 days' and now() and (e.purchase_at is null or e.purchase_at>=f.started_at)
   -- Only a property's first actual seller outreach can establish this trial.
   -- An earlier unassigned/legacy contact cannot become a new prospective arm.
   and not exists(select 1 from properties p join public.icash_call_recordings r on r.account_id=p_account and r.screening_id=p.id and r.party='seller'
    left join public.icash_operation_spend o on o.account_id=p_account and o.operation_key=r.operation_key
    where p.property_key=f.property_key and (r.call_sid is not null or r.dial_claimed_at is not null or o.dispatched_at is not null)
     and coalesce(o.dispatched_at,r.dial_claimed_at,r.created_at)<f.started_at)
   and not exists(select 1 from properties p join public.icash_live_conversations c on c.account_id=p_account and c.screening_id=p.id and c.party='seller'
    left join public.icash_operation_spend o on o.account_id=p_account and o.operation_key=c.operation_key
    where p.property_key=f.property_key and nullif(c.conversation_id,'') is not null and coalesce(o.dispatched_at,c.created_at)<f.started_at)
   and not exists(select 1 from properties p join public.icash_deal_files d on d.account_id=p_account and d.screening_id=p.id
    join public.icash_text_threads t on t.account_id=p_account and t.deal_id=d.id and t.party='seller'
    join public.icash_text_messages m on m.account_id=p_account and m.thread_id=t.id
    left join public.icash_operation_spend o on o.account_id=p_account and o.operation_key='text:'||m.id
    where p.property_key=f.property_key and ((m.direction='outgoing' and m.state in ('accepted','delivered') and nullif(m.provider_id,'') is not null
      and coalesce(o.dispatched_at,m.created_at)<f.started_at)
     or (m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null) and m.created_at<f.started_at)))
   and not exists(select 1 from properties p join public.icash_customer_phone_calls c on c.account_id=p_account and c.screening_id=p.id
    left join public.icash_operation_spend o on o.account_id=p_account and o.operation_key=c.operation_key
    where p.property_key=f.property_key and coalesce(o.dispatched_at,c.connected_at,c.created_at)<f.started_at)
 )
 insert into public.icash_learning_rollups(account_id,domain,context,market,variant,attempts,pending,positive,opted_out,
  contract_trials,contracts,closing_trials,closings,cost_cents,costs_complete,cost_scope)
 select p_account,'seller_calls',context,'*',variant,count(*),count(*) filter(where started_at>now()-interval '72 hours'),
  count(*) filter(where started_at<=now()-interval '72 hours' and interested and not opted_out and not held),count(*) filter(where opted_out),
  count(*) filter(where started_at<=now()-interval '30 days'),count(*) filter(where started_at<=now()-interval '30 days' and purchase_at between started_at and started_at+interval '30 days'),
  count(*) filter(where started_at<=now()-interval '60 days'),count(*) filter(where started_at<=now()-interval '60 days' and closed_at between started_at and started_at+interval '60 days'),
  coalesce(sum((costs->>'costCents')::bigint) filter(where started_at<=now()-interval '72 hours'),0),
  (bool_and(costs->'complete'='true'::jsonb) filter(where started_at<=now()-interval '72 hours')) is true,'seller-contact-72h-v1'
 from exposures where costs->'priorContact'='false'::jsonb group by context,variant;
end $function$;
revoke all on function public.icash_refresh_seller_call_learning(uuid) from public,anon,authenticated;
grant execute on function public.icash_refresh_seller_call_learning(uuid) to service_role;

-- Preserve legacy domains and the ranker wrapper; exact needles reject drift.
do $patch$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.icash_refresh_learning_account(uuid)'::regprocedure);
 needle:=' perform public.icash_refresh_learning_before_ranker(p_account);';
 replacement:=needle||E'\n perform public.icash_refresh_seller_call_learning(p_account);';
 if length(definition)-length(replace(definition,needle,''))<>length(needle) then raise exception 'Learning refresh prerequisite changed';end if;
 execute replace(definition,needle,replacement);
 definition:=pg_get_functiondef('public.icash_shared_learning_stats(text,text,text)'::regprocedure);
 needle:='bool_and(costs_complete) and p_domain not in (''seller_calls'',''buyer_search'',''seller_recovery'') costs_complete';
 replacement:='bool_and(costs_complete and (p_domain<>''seller_calls'' or (coalesce(cost_scope=''seller-contact-72h-v1'',false) and public.icash_seller_contact_learning_active()))) and p_domain not in (''buyer_search'',''seller_recovery'') costs_complete';
 if length(definition)-length(replace(definition,needle,''))<>length(needle) then raise exception 'Shared learning cost prerequisite changed';end if;
 execute replace(definition,needle,replacement);
 definition:=pg_get_functiondef('public.icash_shared_learning_stats(text,text,text)'::regprocedure);
 needle:='costs_complete,min(updated_at) updated_at,';
 replacement:='costs_complete,case when bool_or(cost_scope=''seller-contact-72h-v1'') then ''seller-contact-72h-v1'' end cost_scope,min(updated_at) updated_at,';
 if length(definition)-length(replace(definition,needle,''))<>length(needle) then raise exception 'Shared learning cost metadata prerequisite changed';end if;
 execute replace(definition,needle,replacement);
 definition:=pg_get_functiondef('public.icash_learning_decision_v2(jsonb,text[],boolean)'::regprocedure);
 needle:='or jsonb_typeof(s->''costs_complete'') is distinct from ''boolean'' or jsonb_typeof(s->''updated_at'') is distinct from ''string''';
 replacement:=needle||E'\n   or (s ? ''cost_scope'' and s->''cost_scope''<>''null''::jsonb and s->''cost_scope''<>''"seller-contact-72h-v1"''::jsonb)';
 if length(definition)-length(replace(definition,needle,''))<>length(needle) then raise exception 'Shared learning scope validation prerequisite changed';end if;
 execute replace(definition,needle,replacement);
 definition:=pg_get_functiondef('public.icash_learning_decision_v2(jsonb,text[],boolean)'::regprocedure);
 needle:=' if exists(select 1 from jsonb_array_elements(stats)r where not (r->>''costs_complete'')::boolean';
 replacement:=E' if objective<>''positive'' and exists(select 1 from jsonb_array_elements(stats)r where r->>''cost_scope''=''seller-contact-72h-v1'') then\n  return result||''{"reason":"outcome_window_costs_incomplete"}''::jsonb;end if;\n'||needle;
 if length(definition)-length(replace(definition,needle,''))<>length(needle) then raise exception 'Shared learning outcome cost prerequisite changed';end if;
 execute replace(definition,needle,replacement);
end $patch$;
commit;
