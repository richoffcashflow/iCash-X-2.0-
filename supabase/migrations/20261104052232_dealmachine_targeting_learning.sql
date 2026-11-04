-- Prospective, cost-complete comparisons. No switch is enabled by this release.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table icash_research_private.targeting_settings add column learning_started_at timestamptz;
alter table icash_research_private.targeting_experiments add column learning_started_at timestamptz;
update icash_research_private.targeting_settings set learning_started_at=now() where enabled;
update icash_research_private.targeting_experiments set learning_started_at=now() where enabled;

alter function public.icash_configure_targeting(uuid,text,jsonb,boolean) rename to icash_configure_targeting_before_learning;
create function public.icash_configure_targeting(p_actor uuid,p_action text,p_definition jsonb default null,p_enabled boolean default false) returns boolean
language plpgsql security definer set search_path='' as $$
declare configured boolean;
begin
 configured:=public.icash_configure_targeting_before_learning(p_actor,p_action,p_definition,p_enabled);
 if configured and p_enabled then
  if p_action='set_enabled' then update icash_research_private.targeting_settings set learning_started_at=coalesce(learning_started_at,now()) where id=1;
  elsif p_action='set_experiment' then update icash_research_private.targeting_experiments set learning_started_at=coalesce(learning_started_at,now()) where id=(p_definition->>'id')::uuid;end if;
 end if;
 return configured;
end $$;

-- The immutable provider plan still carries its exact definition. Learned is an
-- allocation label only; all original final paid-admission predicates still run.
create or replace function public.icash_discovery_filter_plan_valid(p jsonb) returns boolean language sql immutable set search_path='' as $$
 select public.icash_filter_plan_before_targeting(p) or coalesce(
  p->>'version'='seller-targeting-v1' and p->>'mode' in ('explore','learned') and p->>'strategy'='target_'||(p->'targeting'->>'id')
  and public.icash_targeting_definition_valid(p->'targeting') and jsonb_typeof(p->'providerPage')='number' and p->>'providerPage' ~ '^[1-9][0-9]{0,8}$'
  and p=jsonb_build_object('version',p->'version','strategy',p->'strategy','providerPage',p->'providerPage','mode',p->'mode','targeting',p->'targeting'),false);
$$;

create function public.icash_targeting_learning_evidence(p_account uuid,p_zip text,p_experiment uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with scope as materialized (
  select c.account_id,c.zip,c.per_page,jsonb_build_object('version','research-efficiency-v2','exclusionListId',c.research_list_id) query_policy,
   e.definition,'target_'||e.id strategy,greatest(s.learning_started_at,e.learning_started_at,now()-interval '180 days') started_at
  from public.icash_discovery_configs c join icash_research_private.targeting_settings s on s.id=1 and s.enabled and s.learning_started_at is not null
  join icash_research_private.targeting_experiments e on e.id=p_experiment and e.enabled and e.learning_started_at is not null
  where c.account_id=p_account and c.zip=p_zip and c.research_version=2 and c.research_list_id is not null
   and public.icash_targeting_available(p_account,p_zip,e.definition)
 ), pages as materialized (
  select p.*,o.state spend_state,o.charged_cents,o.actual_micros from scope c
  join public.icash_discovery_filter_pages p on p.account_id=c.account_id and p.zip=c.zip and p.created_at between c.started_at and now()
  join public.icash_discovery_inventory_receipts r on r.operation_key=p.operation_key and r.account_id=p.account_id
   and r.per_page=c.per_page and r.query_policy=c.query_policy
  left join public.icash_operation_spend o on o.operation_key=p.operation_key and o.account_id=p.account_id
  where (p.plan->>'version'='seller-filters-v1' and p.plan->>'strategy'='baseline')
   or (p.plan->>'version'='seller-targeting-v1' and p.plan->>'strategy'=c.strategy and p.plan->'targeting'=c.definition)
 ), signatures as materialized (
  select o.* from scope c cross join lateral public.icash_learning_deal_outcomes(c.account_id) o
 ), prospects as materialized (
  select a.screening_id,p.operation_key,p.plan->>'strategy' strategy,p.created_at,
   first_attempt.at attempted_at,
   coalesce(voice.opted_out,false) or coalesce(sms.opted_out,false) opted_out,
   least(voice.interested_at,sms.interested_at) interested_at,signature.purchase_at,signature.closed_at
  from pages p join public.icash_discovery_filter_attribution a on a.operation_key=p.operation_key and a.account_id=p.account_id
  join public.icash_screening_jobs s on s.id=a.screening_id and s.account_id=a.account_id
  left join lateral (
   select min(at) at from (
    select o.dispatched_at at from public.icash_live_conversations c join public.icash_operation_spend o on o.operation_key=c.operation_key and o.account_id=c.account_id
    where c.account_id=a.account_id and c.screening_id=a.screening_id and c.party='seller' and nullif(btrim(c.conversation_id),'') is not null
     and c.operation_key like 'voice:%' and o.dispatched_at>=c.created_at
    union all select o.dispatched_at from public.icash_deal_files d join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id and t.party='seller'
    join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
    join public.icash_operation_spend o on o.operation_key='text:'||m.id and o.account_id=m.account_id
    where d.account_id=a.account_id and d.screening_id=a.screening_id and m.direction='outgoing' and nullif(btrim(m.provider_id),'') is not null and m.state in ('accepted','delivered') and o.dispatched_at>=m.created_at
   ) attempts where at between p.created_at and now()
  ) first_attempt on true
  left join lateral (
   select bool_or(c.result->'optedOut'='true'::jsonb) opted_out,
    min(c.completed_at) filter(where c.state='complete' and public.icash_call_selling_interest(c.result) and public.icash_call_has_seller_response(c.result)
     and c.completed_at between first_attempt.at and first_attempt.at+interval '72 hours') interested_at
   from public.icash_live_conversations c where c.account_id=a.account_id and c.screening_id=a.screening_id and c.party='seller' and c.conversation_id is not null
  ) voice on true
  left join lateral (
   select bool_or(exists(select 1 from public.icash_text_messages m where m.thread_id=t.id and m.account_id=t.account_id
     and m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null) and public.icash_seller_contact_stop(m.body))) opted_out,
    min(public.icash_seller_sms_interest_at(a.account_id,t.id,first_attempt.at,first_attempt.at+interval '72 hours')) interested_at
   from public.icash_deal_files d join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id and t.party='seller'
   where d.account_id=a.account_id and d.screening_id=a.screening_id
  ) sms on true
  left join lateral (select min(purchase_at) purchase_at,min(closed_at) closed_at from signatures where screening_id=a.screening_id) signature on true
 ), raw_keys as (
  select p.plan->>'strategy' strategy,p.operation_key,true required from pages p where p.state not in ('empty','unavailable')
  union all select p.strategy,'owners:'||p_account||':'||p.screening_id,
   exists(select 1 from public.icash_owner_contacts c where c.account_id=p_account and c.screening_id=p.screening_id) from prospects p
  union all select p.strategy,c.operation_key,c.conversation_id is not null from prospects p join public.icash_live_conversations c on c.screening_id=p.screening_id and c.account_id=p_account
  union all select p.strategy,'text:'||m.id,m.provider_id is not null from prospects p
   join public.icash_deal_files d on d.screening_id=p.screening_id and d.account_id=p_account
   join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id
   join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id where m.direction='outgoing'
  union all select p.strategy,'deal-email:'||e.id,e.provider_id is not null from prospects p
   join public.icash_deal_files d on d.screening_id=p.screening_id and d.account_id=p_account
   join public.icash_deal_emails e on e.deal_id=d.id and e.account_id=d.account_id where e.direction='outgoing'
 ), operation_keys as (select strategy,operation_key,bool_or(required) required from raw_keys group by strategy,operation_key), costs as (
  select k.strategy,coalesce(sum(o.charged_cents) filter(where o.state='settled'),0)::bigint cents,
   coalesce(sum(o.actual_micros) filter(where o.state='settled'),0)::bigint micros,
   bool_and(case when o.operation_key is null then not k.required when o.state='cancelled' then not k.required
    else o.state='settled' and o.charged_cents is not null and o.charged_cents>=0 and o.actual_micros is not null and o.actual_micros>=0 end) complete
  from operation_keys k left join public.icash_operation_spend o on o.operation_key=k.operation_key and o.account_id=p_account group by k.strategy
 ), arms as (
  select c.*,arm.strategy arm from scope c cross join lateral (values('baseline'),(c.strategy)) arm(strategy)
 ), stats as (
  select a.arm,jsonb_build_object('strategy',a.arm,'attempts',f.attempts,'matureAttempts',f.mature,'interested',f.interested,'optedOut',f.opted_out,
   'contractTrials',f.contract_trials,'contracts',f.contracts,'closingTrials',f.closing_trials,'closings',f.closings,
   'costCents',coalesce(c.cents,0),'providerCostMicros',coalesce(c.micros,0),'costsComplete',coalesce(c.complete,true)
    and not exists(select 1 from pages p where p.plan->>'strategy'=a.arm and (p.state is distinct from 'complete' or p.spend_state is distinct from 'settled' or p.charged_cents is null or p.actual_micros is null))
    and not exists(select 1 from public.icash_discovery_filter_pages p where p.account_id=p_account and p.zip=p_zip and p.created_at between a.started_at and now()
     and (p.state='claimed' or (p.state='complete' and not exists(select 1 from public.icash_discovery_inventory_receipts r where r.operation_key=p.operation_key and r.account_id=p.account_id))))) value
  from arms a cross join lateral (
   select count(*) filter(where attempted_at is not null) attempts,
    count(*) filter(where attempted_at<=now()-interval '72 hours') mature,
    count(*) filter(where attempted_at<=now()-interval '72 hours' and interested_at between attempted_at and attempted_at+interval '72 hours' and not opted_out) interested,
    count(*) filter(where attempted_at is not null and opted_out) opted_out,
    count(*) filter(where created_at<=now()-interval '30 days') contract_trials,
    count(*) filter(where created_at<=now()-interval '30 days' and purchase_at between created_at and created_at+interval '30 days') contracts,
    count(*) filter(where created_at<=now()-interval '60 days') closing_trials,
    count(*) filter(where created_at<=now()-interval '60 days' and closed_at between created_at and created_at+interval '60 days') closings
   from prospects p where p.strategy=a.arm
  ) f left join costs c on c.strategy=a.arm
 ) select jsonb_build_object('version','seller-targeting-learning-v1','checkedAt',now(),'startedAt',c.started_at,
  'context',jsonb_build_object('accountId',p_account,'zip',p_zip,'pageSize',c.per_page,'queryPolicy',c.query_policy),
  'baseline',(select value from stats where arm='baseline'),'candidate',(select value from stats where arm=c.strategy)) from scope c;
$$;

-- Existing cursor creation and admission are unchanged; attach fresh comparisons
-- to their exact definition instead of consuming historical report percentages.
alter function public.icash_targeting_state(uuid,uuid,integer) rename to icash_targeting_state_before_learning;
create function public.icash_targeting_state(p_account uuid,p_revision uuid,p_page integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare state jsonb;c public.icash_discovery_configs;
begin
 state:=public.icash_targeting_state_before_learning(p_account,p_revision,p_page);
 if state is null then return null;end if;
 select * into c from public.icash_discovery_configs where account_id=p_account and revision=p_revision and next_page=p_page;
 if not found then return null;end if;
 return state||jsonb_build_object('learningContext',jsonb_build_object('accountId',p_account,'zip',c.zip,'pageSize',c.per_page,
  'queryPolicy',jsonb_build_object('version','research-efficiency-v2','exclusionListId',c.research_list_id)),
  'experiments',coalesce((select jsonb_agg(e||jsonb_build_object('learningEvidence',public.icash_targeting_learning_evidence(p_account,c.zip,(e->'definition'->>'id')::uuid))) from jsonb_array_elements(state->'experiments') e),'[]'));
end $$;

alter function public.icash_targeting_report(uuid) rename to icash_targeting_report_before_learning;
create function public.icash_targeting_report(p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare report jsonb;
begin
 report:=public.icash_targeting_report_before_learning(p_actor);
 return jsonb_set(report,'{definitions,allocation}',to_jsonb('Half existing audiences, every fourth baseline; at most three of five experimental slots favor a mature, cost-complete candidate with conservative superiority over its concurrent baseline. Otherwise collecting/exploring; no claimed causal lift.'::text))
  ||jsonb_build_object('learningPolicy','seller-targeting-learning-v1','learnedPages',(select count(*) from public.icash_discovery_filter_pages where plan->>'version'='seller-targeting-v1' and plan->>'mode'='learned'),
   'learningStartedAt',(select learning_started_at from icash_research_private.targeting_settings where id=1));
end $$;
revoke all on function public.icash_targeting_learning_evidence(uuid,text,uuid),public.icash_targeting_state(uuid,uuid,integer),public.icash_targeting_state_before_learning(uuid,uuid,integer),public.icash_targeting_report(uuid),public.icash_targeting_report_before_learning(uuid),public.icash_configure_targeting(uuid,text,jsonb,boolean),public.icash_configure_targeting_before_learning(uuid,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.icash_targeting_learning_evidence(uuid,text,uuid),public.icash_targeting_state(uuid,uuid,integer),public.icash_targeting_report(uuid),public.icash_configure_targeting(uuid,text,jsonb,boolean) to service_role;
commit;
