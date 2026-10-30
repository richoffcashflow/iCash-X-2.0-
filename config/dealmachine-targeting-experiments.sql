-- Additive, inactive rollout. Existing receipts, admissions and prices remain authoritative.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create table icash_research_private.targeting_settings(
 id integer primary key check(id=1),enabled boolean not null default false,
 mobile_verified boolean not null default false,mobile_evidence_ref text,
 check(not mobile_verified or length(mobile_evidence_ref)>=12)
);
insert into icash_research_private.targeting_settings(id) values(1);
create table icash_research_private.targeting_experiments(
 id uuid primary key,definition jsonb not null,enabled boolean not null default false,
 created_at timestamptz not null default now(),created_by uuid not null,
 check(definition->>'id'=id::text)
);
alter table icash_research_private.targeting_settings enable row level security;
alter table icash_research_private.targeting_experiments enable row level security;
revoke all on icash_research_private.targeting_settings,icash_research_private.targeting_experiments from public,anon,authenticated,service_role;
create function icash_research_private.targeting_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or new.id<>old.id or new.definition<>old.definition or new.created_at<>old.created_at or new.created_by<>old.created_by then raise exception 'Targeting definition is immutable; create a new experiment';end if;
 return new;
end $$;
create trigger targeting_immutable before update or delete on icash_research_private.targeting_experiments for each row execute function icash_research_private.targeting_immutable();
-- Acquisition exclusions are not assignments. Keep the existing ownership FK and
-- attribution intact, including paid records that never became a customer's lead.
create table icash_research_private.targeting_acquired_properties(property_id text primary key,operation_key text not null,synced_at timestamptz);
alter table icash_research_private.targeting_acquired_properties enable row level security;
revoke all on icash_research_private.targeting_acquired_properties from public,anon,authenticated,service_role;
create index targeting_acquired_pending on icash_research_private.targeting_acquired_properties(property_id) where synced_at is null;
insert into icash_research_private.targeting_acquired_properties(property_id,operation_key,synced_at)
select distinct on (p.property_id) p.property_id,r.operation_key,x.synced_at
from public.icash_discovery_inventory_receipts r cross join lateral unnest(r.property_ids) p(property_id)
left join icash_research_private.exclusion_items x on x.property_id=p.property_id
order by p.property_id,r.created_at,r.operation_key;
create function icash_research_private.queue_targeting_acquisition() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into icash_research_private.targeting_acquired_properties(property_id,operation_key,synced_at)
 select p.property_id,new.operation_key,x.synced_at from unnest(new.property_ids) p(property_id)
 left join icash_research_private.exclusion_items x on x.property_id=p.property_id on conflict(property_id) do nothing;
 return new;
end $$;
create trigger targeting_exclude_acquired after insert on public.icash_discovery_inventory_receipts for each row execute function icash_research_private.queue_targeting_acquisition();
-- Keep the existing quota, disabled switch, lease and exact acknowledgement gates.
-- When experiments have never run and are disabled, ordinary sync is unchanged.
do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_claim_research_exclusions()'::regprocedure);
 needle:='select property_id from icash_research_private.exclusion_items where synced_at is null order by property_id limit 1000';
 if strpos(d,needle)=0 then raise exception 'Exclusion claim prerequisite changed';end if;
 execute replace(d,needle,$insert$select property_id from (
  select property_id from icash_research_private.exclusion_items where synced_at is null
  union select property_id from icash_research_private.targeting_acquired_properties where synced_at is null and (
   exists(select 1 from icash_research_private.targeting_settings where id=1 and enabled)
   or exists(select 1 from public.icash_discovery_filter_pages where plan->>'version'='seller-targeting-v1' and state not in ('empty','unavailable')))
 ) pending order by property_id limit 1000$insert$);
 d:=pg_get_functiondef('public.icash_finish_research_exclusions(uuid,jsonb)'::regprocedure);
 needle:='  update icash_research_private.exclusion_items set synced_at=now() where property_id=any(s.batch) and synced_at is null;';
 if strpos(d,needle)=0 then raise exception 'Exclusion acknowledgement prerequisite changed';end if;
 execute replace(d,needle,needle||E'\n  update icash_research_private.targeting_acquired_properties set synced_at=now() where property_id=any(s.batch) and synced_at is null;');
end $patch$;
alter table public.icash_discovery_filter_cursors drop constraint icash_discovery_filter_cursors_strategy_check;
alter table public.icash_discovery_filter_cursors add constraint icash_discovery_filter_cursors_strategy_check check(strategy in ('baseline','vacant','absentee','repairs') or strategy ~ '^target_[a-f0-9-]{36}$');
create index targeting_paid_markets on public.icash_discovery_filter_pages(zip,created_at) where plan->>'version'='seller-targeting-v1' and state not in ('empty','unavailable');

create function public.icash_targeting_filters(d jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare segment text:=d->>'segment';cutoff date:=(d->>'asOf')::date;
begin
 case segment
 when 'off_market' then return '[{"filter_id":"market_status","operator":"contains_any","value":[6]}]';
 when 'sale_7_10' then return jsonb_build_array(jsonb_build_object('filter_id','last_sale_date','operator','date_range','value',jsonb_build_object('start',to_char(cutoff-interval '10 years','YYYY-MM-DD'),'end',to_char(cutoff-interval '7 years','YYYY-MM-DD'))));
 when 'sale_10_plus' then return jsonb_build_array(jsonb_build_object('filter_id','last_sale_date','operator','is_before','value',to_char(cutoff-interval '10 years','YYYY-MM-DD')));
 when 'buyer_fit' then return (select jsonb_agg(jsonb_build_object('filter_id',key,'operator','range','value',value) order by key) from jsonb_each(d->'ranges'));
 when 'out_of_state_absentee' then return '[{"filter_id":"has_absentee_owners","value":true},{"filter_id":"has_out_of_state_owners","value":true}]';
 when 'vacant_absentee' then return '[{"filter_id":"is_vacant_home","value":true},{"filter_id":"has_absentee_owners","value":true}]';
 when 'mobile' then return '[]';
 else return null;
 end case;
end $$;
create function public.icash_targeting_definition_valid(d jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare r record;b jsonb:=d->'buyerEvidence';
begin
 if jsonb_typeof(d) is distinct from 'object' or coalesce(d->>'id','') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  or coalesce(d->>'asOf','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (d->>'asOf')::date<date '2020-01-01'
  or d->>'segment' not in ('off_market','sale_7_10','sale_10_plus','buyer_fit','out_of_state_absentee','vacant_absentee','mobile')
  or d->>'segment' is null or exists(select 1 from jsonb_object_keys(d) k where k not in ('id','segment','asOf','ranges','buyerEvidence')) then return false;end if;
 if d->>'segment'<>'buyer_fit' then return not(d ? 'ranges' or d ? 'buyerEvidence');end if;
 if jsonb_typeof(d->'ranges') is distinct from 'object' or d->'ranges'='{}' or jsonb_typeof(b) is distinct from 'object'
  or b is distinct from jsonb_build_object('accountId',b->'accountId','buyerId',b->'buyerId','sourceReference',b->'sourceReference','observedAt',b->'observedAt','expiresAt',b->'expiresAt','zips',b->'zips')
  or length(coalesce(b->>'sourceReference','')) not between 12 and 1000
  or (b->>'accountId')::uuid is null or (b->>'buyerId')::uuid is null
  or (b->>'observedAt')::timestamptz is null or (b->>'expiresAt')::timestamptz is null
  or (b->>'expiresAt')::timestamptz not between (b->>'observedAt')::timestamptz and (b->>'observedAt')::timestamptz+interval '30 days'
  or jsonb_typeof(b->'zips') is distinct from 'array' or jsonb_array_length(b->'zips') not between 1 and 100
  or exists(select 1 from jsonb_array_elements_text(b->'zips') z where z !~ '^[0-9]{5}$') then return false;end if;
 for r in select * from jsonb_each(d->'ranges') loop
  if r.key not in ('estimated_value','num_bedrooms','num_bathrooms','living_area_sqft','year_built') or jsonb_typeof(r.value) is distinct from 'object'
   or r.value is distinct from jsonb_build_object('min',r.value->'min','max',r.value->'max')
   or jsonb_typeof(r.value->'min') is distinct from 'number' or jsonb_typeof(r.value->'max') is distinct from 'number'
   or (r.value->>'min')::numeric<0 or (r.value->>'max')::numeric<(r.value->>'min')::numeric then return false;end if;
 end loop;
 return true;
exception when others then return false;
end $$;

-- Keep legacy plan identity and validation unchanged for already claimed work.
alter function public.icash_discovery_filter_plan_valid(jsonb) rename to icash_filter_plan_before_targeting;
create function public.icash_discovery_filter_plan_valid(p jsonb) returns boolean language sql immutable set search_path='' as $$
 select public.icash_filter_plan_before_targeting(p) or coalesce(
  p->>'version'='seller-targeting-v1' and p->>'mode'='explore' and p->>'strategy'='target_'||(p->'targeting'->>'id')
  and public.icash_targeting_definition_valid(p->'targeting') and jsonb_typeof(p->'providerPage')='number' and p->>'providerPage' ~ '^[1-9][0-9]{0,8}$'
  and p=jsonb_build_object('version',p->'version','strategy',p->'strategy','providerPage',p->'providerPage','mode',p->'mode','targeting',p->'targeting'),false);
$$;
create function public.icash_targeting_capable(d jsonb) returns boolean language plpgsql stable security definer set search_path='' as $$
declare c jsonb;f jsonb;m jsonb;
begin
 select result into c from public.icash_integration_checks where provider='dealmachine_targeting' and checked_at between now()-interval '7 days' and now();
 if c->>'status' is distinct from 'verified' or c->'plan'->'is_paid' is distinct from 'true'::jsonb then return false;end if;
 for f in select value from jsonb_array_elements(public.icash_targeting_filters(d)) loop
  select value into m from jsonb_array_elements(c->'filters') where value->>'filter_id'=f->>'filter_id';
  if (select count(*) from jsonb_array_elements(c->'filters') x where x->>'filter_id'=f->>'filter_id')<>1 or m is null or m->'is_premium_filter' is distinct from 'false'::jsonb
   or m->>'type' is distinct from (case when jsonb_typeof(f->'value')='boolean' then 'BOOLEAN' when f->>'filter_id'='last_sale_date' then 'DATE' when f->>'filter_id'='market_status' then 'MULTI_SELECT' else 'NUMBER' end)
   or (f ? 'operator' and not coalesce(m->'allowed_operators' ? (f->>'operator'),false)) then return false;end if;
  if f->>'filter_id'='market_status' and (select count(*) from jsonb_array_elements(m->'options') o where o->'option_id'='6'::jsonb and o->>'label'='Off Market')<>1 then return false;end if;
 end loop;
 if d->>'segment'='mobile' and not exists(select 1 from icash_research_private.targeting_settings where id=1 and mobile_verified) then return false;end if;
 return true;
exception when others then return false;
end $$;

-- New overlapping paid audiences require acknowledged organization-wide exclusion
-- coverage. A stale/missing list disables experiments, not baseline acquisition.
create function public.icash_targeting_dedup_ready(p_account uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.icash_discovery_configs c join icash_research_private.exclusions e on e.id=1 and e.list_id=c.research_list_id
  where c.account_id=p_account and c.research_version=2 and e.state='ready' and e.last_synced_at<=now())
 and not exists(select 1 from icash_research_private.exclusion_items where synced_at is null)
 and not exists(select 1 from icash_research_private.targeting_acquired_properties where synced_at is null)
 and not exists(select 1 from public.icash_discovery_filter_pages p join public.icash_operation_spend o using(operation_key,account_id)
  where p.zip=(select zip from public.icash_discovery_configs where account_id=p_account) and p.state='claimed' and o.state not in ('settled','cancelled'));
$$;
create function public.icash_targeting_available(p_account uuid,p_zip text,d jsonb) returns boolean language sql stable security definer set search_path='' as $$
 select public.icash_targeting_definition_valid(d) and (d->>'asOf')::date<=current_date
 and exists(select 1 from icash_research_private.targeting_settings where id=1 and enabled)
 and exists(select 1 from icash_research_private.targeting_experiments e where e.id=(d->>'id')::uuid and e.definition=d and e.enabled)
 and public.icash_targeting_capable(d)
 and (d->>'segment'<>'buyer_fit' or (
  d->'buyerEvidence'->>'accountId'=p_account::text and d->'buyerEvidence'->'zips' ? p_zip
  and (d->'buyerEvidence'->>'observedAt')::timestamptz<=now() and (d->'buyerEvidence'->>'expiresAt')::timestamptz>now()
  and exists(select 1 from public.icash_buyer_profiles b where b.id=(d->'buyerEvidence'->>'buyerId')::uuid and b.account_id=p_account)));
$$;
create function public.icash_targeting_state(p_account uuid,p_revision uuid,p_page integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.icash_discovery_configs;settings icash_research_private.targeting_settings;
begin
 select * into settings from icash_research_private.targeting_settings where id=1;
 if not settings.enabled then return null;end if;
 select * into c from public.icash_discovery_configs where account_id=p_account;
 if c.revision is distinct from p_revision or c.next_page is distinct from p_page then return null;end if;
 insert into public.icash_discovery_filter_cursors(account_id,revision,zip,strategy,next_page)
 select p_account,p_revision,c.zip,'target_'||e.id,1 from icash_research_private.targeting_experiments e
 where public.icash_targeting_available(p_account,c.zip,e.definition) on conflict do nothing;
 return jsonb_build_object('enabled',true,'dedupReady',public.icash_targeting_dedup_ready(p_account),'mobileVerified',settings.mobile_verified,
 'capabilities',(select result from public.icash_integration_checks where provider='dealmachine_targeting'),
 'experiments',coalesce((select jsonb_agg(jsonb_build_object('definition',e.definition,'nextPage',cur.next_page,'pages',cur.pages,'exhausted',cur.exhausted,'blocked',false))
  from icash_research_private.targeting_experiments e join public.icash_discovery_filter_cursors cur on cur.strategy='target_'||e.id
  where cur.account_id=p_account and cur.revision=p_revision and public.icash_targeting_available(p_account,c.zip,e.definition)),'[]'));
end $$;

-- Recheck configuration and cross-segment exclusion coverage inside the original
-- globally locked final admission, after the free estimate and before any money.
do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_reserve_and_claim_filtered_discovery(uuid,text,uuid,integer,integer,uuid,bigint,timestamptz,integer,text,text,jsonb)'::regprocedure);
 needle:=' if not public.icash_reserve_and_claim_property_discovery';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Targeting admission prerequisite changed';end if;
 execute replace(d,needle,$insert$
 if p_plan->>'version'='seller-targeting-v1' and (not public.icash_targeting_available(p_account,p_zip,p_plan->'targeting') or not public.icash_targeting_dedup_ready(p_account)) then return false;end if;
 -- Overlapping baseline acquisitions cannot overtake an experimental purchase
 -- or its unsynchronized receipt, even after rollback. Disjoint ZIPs retain supply.
 if exists(select 1 from public.icash_discovery_filter_pages fp
  where fp.zip=p_zip and fp.plan->>'version'='seller-targeting-v1' and fp.state not in ('empty','unavailable'))
  and not public.icash_targeting_dedup_ready(p_account) then return false;end if;
$insert$||needle);
end $patch$;

-- Old state/report functions deliberately keep the four original audiences.
-- Disabled experiment cursors must not keep an empty market alive on rollback.
create function public.icash_targeting_cursor_available(p_account uuid,p_revision uuid,p_zip text,p_strategy text) returns boolean language sql stable security definer set search_path='' as $$
 select p_strategy in ('baseline','vacant','absentee','repairs') or exists(select 1 from icash_research_private.targeting_experiments e
 where 'target_'||e.id=p_strategy and public.icash_targeting_available(p_account,p_zip,e.definition));
$$;
do $patch$
declare d text;name text;needle text:='where account_id=p_account and revision=p_revision and not exhausted';
begin
 foreach name in array array['icash_save_filtered_discovery(uuid,text,uuid,integer,jsonb)','icash_finish_empty_filter(uuid,uuid,integer,jsonb,text)','icash_prepare_discovery_inventory(uuid,uuid,integer)'] loop
  d:=pg_get_functiondef(('public.'||name)::regprocedure);
  if strpos(d,needle)=0 then raise exception 'Targeting cursor prerequisite changed: %',name;end if;
  execute replace(d,needle,needle||' and public.icash_targeting_cursor_available(p_account,p_revision,zip,strategy)');
 end loop;
end $patch$;

-- Existing export admission/recovery/settlement is retained, with only one optional
-- documented flag. Cohorts never mix in a batch and an empty result is not rebought.
create function public.icash_owner_targeting_pool(p_account uuid,p_screening uuid) returns text language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.icash_discovery_filter_attribution a join public.icash_discovery_filter_pages p using(operation_key,account_id)
  where a.account_id=p_account and a.screening_id=p_screening and p.plan->>'version'='seller-targeting-v1' and p.plan->'targeting'->>'segment'='mobile') then 'mobile' else 'active' end;
$$;
do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_admit_owner_active_export(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
 needle:=' if p_request is distinct from expected then return ''held'';end if;';
 if strpos(d,needle)=0 then raise exception 'Export request prerequisite changed';end if;
 execute replace(d,needle,$insert$
 if public.icash_owner_targeting_pool(p_account,p_primary)='mobile' then
  if not exists(select 1 from icash_research_private.targeting_settings where id=1 and mobile_verified) then return 'held';end if;
  expected:=expected||'{"mobile_only":true}'::jsonb;end if;
 if exists(select 1 from jsonb_array_elements(p_items) i where public.icash_owner_targeting_pool(p_account,(i->>'screeningId')::uuid)<>public.icash_owner_targeting_pool(p_account,p_primary)) then return 'held';end if;
$insert$||needle);
 d:=pg_get_functiondef('public.icash_save_owner_active_export(uuid,uuid,jsonb,jsonb)'::regprocedure);
 needle:=' remaining:=(credits->>''used'')::integer;';
 if strpos(d,needle)=0 then raise exception 'Export result prerequisite changed';end if;
 execute replace(d,needle,$insert$
 if e.request->'mobile_only'='true'::jsonb and exists(select 1 from jsonb_array_elements(p_rows) mobile_row(value) cross join generate_series(1,3) mobile_slot(n)
  where coalesce(mobile_row.value->>('phone_'||mobile_slot.n),'')<>'' and mobile_row.value->>('people_phone_'||mobile_slot.n||'_type_id') is distinct from 'Wireless') then raise exception 'Mobile export returned non-wireless or unknown type';end if;
$insert$||needle);
end $patch$;

CREATE OR REPLACE FUNCTION public.icash_targeting_feedback(p_account uuid, p_zip text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with pages as (
  select p.*,o.charged_cents,o.state spend_state from public.icash_discovery_filter_pages p
  left join public.icash_operation_spend o on o.operation_key=p.operation_key and o.account_id=p.account_id
  where p.account_id=p_account and p.zip=p_zip and p.plan->>'version' in ('seller-filters-v1','seller-targeting-v1')
  and p.created_at between now()-interval '90 days' and now()
 ), prospects as (
  select a.screening_id,p.operation_key,p.plan->>'strategy' strategy,
   first_attempt.at is not null attempted,coalesce(first_attempt.at<=now()-interval '72 hours',false) mature,
   coalesce(o.responded,false) responded,coalesce(o.opted_out,false) opted_out,
   (coalesce(o.interested,false) or public.icash_filter_sms_interest(p_account,a.screening_id)) and not coalesce(o.opted_out,false) interested,
   s.state='complete' and exists(select 1 from public.icash_automation_tickets t
    where t.account_id=a.account_id and t.screening_id=a.screening_id and t.kind='contacts' and t.state='complete' and t.outcome='empty') no_owner
  from pages p join public.icash_discovery_filter_attribution a on a.operation_key=p.operation_key and a.account_id=p.account_id
  join public.icash_screening_jobs s on s.id=a.screening_id and s.account_id=a.account_id
  left join public.icash_opportunity_outcomes o on o.screening_id=a.screening_id and o.account_id=a.account_id
  left join lateral (
   select min(at) at from (
    select c.created_at at from public.icash_live_conversations c where c.account_id=a.account_id and c.screening_id=a.screening_id and c.party='seller' and c.conversation_id is not null
    -- Queue creation is not send time. Updated/delivery receipts deliberately
    -- give a delayed send its full response window, including late webhooks.
    union all select greatest(m.created_at,m.updated_at,m.last_delivery_at) from public.icash_deal_files d join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id and t.party='seller'
    join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
    where d.account_id=a.account_id and d.screening_id=a.screening_id and m.direction='outgoing' and m.provider_id is not null and m.state in ('accepted','delivered')
   ) attempts where at<=now()
  ) first_attempt on true
 ), operation_keys as (
  select p.plan->>'strategy' strategy,p.operation_key,true required from pages p where p.state not in ('empty','unavailable')
  union select p.strategy,'owners:'||p_account||':'||p.screening_id,
   exists(select 1 from public.icash_owner_contacts c where c.account_id=p_account and c.screening_id=p.screening_id) from prospects p
  union select p.strategy,c.operation_key,c.conversation_id is not null from prospects p
   join public.icash_live_conversations c on c.screening_id=p.screening_id and c.account_id=p_account
  union select p.strategy,'text:'||m.id,m.provider_id is not null from prospects p
   join public.icash_deal_files d on d.screening_id=p.screening_id and d.account_id=p_account
   join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id
   join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id where m.direction='outgoing'
  union select p.strategy,'deal-email:'||e.id,false from prospects p
   join public.icash_deal_files d on d.screening_id=p.screening_id and d.account_id=p_account
   join public.icash_deal_emails e on e.deal_id=d.id and e.account_id=d.account_id where e.direction='outgoing'
 ), costs as (
  select k.strategy,coalesce(sum(o.charged_cents) filter(where o.state='settled'),0)::bigint cents,
   coalesce(sum(o.actual_micros) filter(where o.state='settled'),0)::bigint provider_micros,
   coalesce(sum(o.actual_micros) filter(where o.state='settled' and (k.operation_key like 'discovery:%' or k.operation_key like 'owners:%')),0)::bigint research_micros,
   bool_and(case when o.operation_key is null then not k.required
    else o.state='cancelled' or (o.state='settled' and o.charged_cents is not null and o.charged_cents>=0 and o.actual_micros is not null and o.actual_micros>=0) end) complete
  from operation_keys k left join public.icash_operation_spend o on o.operation_key=k.operation_key and o.account_id=p_account group by k.strategy
 ), recent_pages as (
  select p.plan->>'strategy' strategy,row_number() over(partition by p.plan->>'strategy' order by p.created_at desc,p.operation_key desc) position,
   p.state='complete' and p.spend_state='settled' and p.charged_cents>=0
   and not exists(select 1 from prospects f where f.operation_key=p.operation_key and (not f.no_owner or f.attempted)) unproductive
  from pages p
 )
 select jsonb_agg(jsonb_build_object('strategy',arms.strategy,'attempted',f.attempted,'matureAttempts',f.mature_attempts,
  'pendingAttempts',f.pending_attempts,'interested',f.interested,'optedOut',f.opted_out,'responded',f.responded,'properties',f.properties,
  'providerCostMicros',coalesce(c.provider_micros,0),'researchCostMicros',coalesce(c.research_micros,0),'costCents',coalesce(c.cents,0),'costsComplete',coalesce(c.complete,true) and not exists(select 1 from pages p
   where p.plan->>'strategy'=arms.strategy and (p.state='claimed' or (p.state='complete' and (p.spend_state is distinct from 'settled' or p.charged_cents is null or p.charged_cents<0)))),
  -- Only three consecutive known empty/no-owner pages permit cooling. Queued,
  -- held, uncertain, financially-held or merely unanswered work breaks the run.
  'recentUnproductivePages',coalesce((select min(r.position)-1 from recent_pages r
   where r.strategy=arms.strategy and r.position<=3 and r.unproductive is distinct from true),
   (select count(*) from recent_pages r where r.strategy=arms.strategy and r.position<=3))))
 from (select distinct plan->>'strategy' strategy from pages) arms
 cross join lateral(select count(*) properties,count(*) filter(where attempted) attempted,
  count(*) filter(where attempted and mature) mature_attempts,
  count(*) filter(where attempted and not mature and not interested and not opted_out) pending_attempts,
  count(*) filter(where attempted and responded and not opted_out) responded,
  count(*) filter(where attempted and interested) interested,count(*) filter(where attempted and opted_out) opted_out
  from prospects p where p.strategy=arms.strategy) f
 left join costs c on c.strategy=arms.strategy;
$function$;
-- Prospective observations at the existing authenticated seller qualification boundary.
create table icash_research_private.targeting_qualifications(
 account_id uuid not null,screening_id uuid not null,deal_id uuid not null,call_key text not null,
 evidence_hash text not null check(evidence_hash ~ '^[a-f0-9]{64}$'),created_at timestamptz not null default now(),
 primary key(account_id,screening_id,call_key)
);
alter table icash_research_private.targeting_qualifications enable row level security;
revoke all on icash_research_private.targeting_qualifications from public,anon,authenticated,service_role;
create function public.icash_targeting_note_qualified(p_hash text,p_conversation text,p_evidence_hash text) returns boolean language plpgsql security definer set search_path='' as $$
declare scope jsonb;d public.icash_deal_files;
begin
 scope:=public.icash_seller_agreement_call_context(p_hash,p_conversation);
 if scope is null or coalesce(p_evidence_hash,'') !~ '^[a-f0-9]{64}$' or nullif(scope->>'callKey','') is null then return false;end if;
 select * into d from public.icash_deal_files where id=(scope->>'dealId')::uuid and account_id=(scope->>'accountId')::uuid;
 if not found or not exists(select 1 from public.icash_screening_jobs s where s.account_id=d.account_id and s.id=d.screening_id and s.state='complete' and s.result->'financialCheck'->>'status'='eligible') then return false;end if;
 insert into icash_research_private.targeting_qualifications(account_id,screening_id,deal_id,call_key,evidence_hash) values(d.account_id,d.screening_id,d.id,scope->>'callKey',p_evidence_hash) on conflict do nothing;
 return true;
end $$;
create function public.icash_targeting_report(p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare report jsonb;total integer;
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid then raise exception 'Owner required' using errcode='42501';end if;
 select count(*) into total from (select distinct account_id,zip from public.icash_discovery_filter_pages where created_at between now()-interval '90 days' and now()) x;
 with cohorts as (
  select account_id,zip from public.icash_discovery_filter_pages where created_at between now()-interval '90 days' and now() group by account_id,zip order by max(created_at) desc limit 100
 ), stats as (
  select c.*,s from cohorts c cross join lateral jsonb_array_elements(public.icash_targeting_feedback(c.account_id,c.zip)) s
 ), samples as (
  select st.*,a.screening_id,p.created_at,sc.result,oc.result contacts,d.id deal_id
  from stats st join public.icash_discovery_filter_pages p on p.account_id=st.account_id and p.zip=st.zip and p.plan->>'strategy'=st.s->>'strategy' and p.created_at between now()-interval '90 days' and now()
  join public.icash_discovery_filter_attribution a on a.operation_key=p.operation_key and a.account_id=p.account_id
  join public.icash_screening_jobs sc on sc.id=a.screening_id and sc.account_id=a.account_id
  left join public.icash_owner_contacts oc on oc.screening_id=a.screening_id and oc.account_id=a.account_id
  left join public.icash_deal_files d on d.screening_id=a.screening_id and d.account_id=a.account_id
 ), funnel as (
  select account_id,zip,s->>'strategy' strategy,
   count(distinct screening_id) filter(where created_at<=now()-interval '30 days') mature_contract_samples,
   count(distinct screening_id) filter(where contacts is not null and exists(select 1 from jsonb_array_elements(contacts->'contacts') person cross join lateral jsonb_array_elements(person->'phones') phone where person->'likelyOwner'='true'::jsonb and phone->'doNotCall'='false'::jsonb and phone->>'activity'='active' and length(phone->>'number')=10)) valid_contact_properties,
   count(distinct screening_id) filter(where result->'financialCheck'->>'status'='eligible' and exists(select 1 from icash_research_private.targeting_qualifications e where e.account_id=samples.account_id and e.deal_id=samples.deal_id and e.screening_id=samples.screening_id and e.created_at between samples.created_at and now())) qualified,
   count(distinct screening_id) filter(where exists(select 1 from icash_call_offer_private.events e where e.account_id=samples.account_id and e.deal_id=samples.deal_id and e.action in ('get_offer','update_repairs','accept_offer') and coalesce(e.state->>'quotedPriceCents','') ~ '^[1-9][0-9]*$' and e.created_at between samples.created_at and now())) offers,
   count(distinct screening_id) filter(where exists(select 1 from public.icash_learning_deal_outcomes(samples.account_id) o where o.deal_id=samples.deal_id and o.purchase_at between samples.created_at and now())) signed_contracts
  from samples group by account_id,zip,s->>'strategy'
 ) select coalesce(jsonb_agg(st.s||jsonb_build_object('accountId',st.account_id,'zip',st.zip,'validContactProperties',coalesce(f.valid_contact_properties,0),
  'qualifiedConversations',coalesce(f.qualified,0),'offers',coalesce(f.offers,0),'signedContracts',coalesce(f.signed_contracts,0),'matureContractSamples',coalesce(f.mature_contract_samples,0),
  'qualifiedPerProviderDollar',case when st.s->'costsComplete'='true'::jsonb and (st.s->>'providerCostMicros')::numeric>0 then coalesce(f.qualified,0)*1000000.0/(st.s->>'providerCostMicros')::numeric end,
  'qualifiedPerCustomerDollar',case when st.s->'costsComplete'='true'::jsonb and (st.s->>'costCents')::numeric>0 then coalesce(f.qualified,0)*100.0/(st.s->>'costCents')::numeric end,
  'contractsPerCustomerDollar',case when st.s->'costsComplete'='true'::jsonb and (st.s->>'costCents')::numeric>0 then coalesce(f.signed_contracts,0)*100.0/(st.s->>'costCents')::numeric end,
  'contractsPerProviderDollar',case when st.s->'costsComplete'='true'::jsonb and (st.s->>'providerCostMicros')::numeric>0 then coalesce(f.signed_contracts,0)*1000000.0/(st.s->>'providerCostMicros')::numeric end,
  'evidenceStatus',case when st.s->'costsComplete' is distinct from 'true'::jsonb then 'costs_incomplete' when coalesce(f.mature_contract_samples,0)<100 or coalesce(f.qualified,0)<20 or coalesce(f.signed_contracts,0)<5 then 'collecting' else 'review_required' end,
  'winnerDeclared',false)),'[]') into report from stats st left join funnel f on f.account_id=st.account_id and f.zip=st.zip and f.strategy=st.s->>'strategy';
 return jsonb_build_object('version','seller-targeting-v1','checkedAt',now(),'cohorts',report,'cohortsTruncated',total>100,
  'settings',(select to_jsonb(s) from icash_research_private.targeting_settings s where id=1),
  'experiments',(select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at,e.id),'[]') from icash_research_private.targeting_experiments e),
  'capabilities',(select result from public.icash_integration_checks where provider='dealmachine_targeting'),
  'dedupReadyAccounts',(select count(*) from public.icash_discovery_configs c where c.enabled and public.icash_targeting_dedup_ready(c.account_id)),
  'configuredAccounts',(select count(*) from public.icash_discovery_configs where enabled),
  'dedupPending',(select count(*) from (select property_id from icash_research_private.exclusion_items where synced_at is null union select property_id from icash_research_private.targeting_acquired_properties where synced_at is null) pending),
  'definitions',jsonb_build_object('lastSale','Recorded-sale-date proxy, not verified ownership tenure','validContacts','Properties with a saved active, non-DNC likely-owner phone; not proof of consent or ownership','qualified','Prospective financial eligibility plus the existing live seller qualification gate; original conversation binding and evidence hash retained','offers','Saved price quotes returned to a live seller call; not a claim that the seller heard or accepted them','contracts','Original fully signed live purchase envelope','allocation','Fixed exploration; no automatic winner promotion'));
end $$;
create function public.icash_configure_targeting(p_actor uuid,p_action text,p_definition jsonb default null,p_enabled boolean default false) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid then raise exception 'Owner required' using errcode='42501';end if;
 if p_action='set_enabled' then update icash_research_private.targeting_settings set enabled=p_enabled where id=1;return true;end if;
 if p_action='set_experiment' then
  if not public.icash_targeting_definition_valid(p_definition) or (p_definition->>'asOf')::date>current_date then raise exception 'Invalid targeting definition';end if;
  insert into icash_research_private.targeting_experiments(id,definition,created_by,enabled) values((p_definition->>'id')::uuid,p_definition,p_actor,p_enabled) on conflict(id) do nothing;
  if not exists(select 1 from icash_research_private.targeting_experiments where id=(p_definition->>'id')::uuid and definition=p_definition) then raise exception 'Immutable targeting definition mismatch';end if;
  update icash_research_private.targeting_experiments set enabled=p_enabled where id=(p_definition->>'id')::uuid;return true;
 end if;
 return false;
end $$;
-- Definitions are opt-in; no fabricated buyer ranges and no mobile activation.
insert into icash_research_private.targeting_experiments(id,definition,created_by)
select id,jsonb_build_object('id',id,'segment',segment,'asOf','2026-10-30'),'592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid
from (select gen_random_uuid() id,segment from unnest(array['off_market','sale_7_10','sale_10_plus','out_of_state_absentee','vacant_absentee','mobile']) segment) defaults;
create function public.icash_owner_targeting_pools(p_account uuid,p_screenings uuid[]) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_object_agg(s.id,public.icash_owner_targeting_pool(p_account,s.id)),'{}') from public.icash_screening_jobs s
 where s.account_id=p_account and s.id=any(p_screenings) and cardinality(p_screenings) between 1 and 5;
$$;
-- Every new public RPC is private to trusted server code. No customer RLS bypass.
do $$
declare r record;
begin
 for r in select oid::regprocedure sig from pg_proc where pronamespace='public'::regnamespace and (proname like 'icash_targeting_%' or proname in ('icash_configure_targeting','icash_owner_targeting_pool','icash_owner_targeting_pools','icash_filter_plan_before_targeting','icash_discovery_filter_plan_valid')) loop
  execute format('revoke all on function %s from public,anon,authenticated',r.sig);
  execute format('grant execute on function %s to service_role',r.sig);
 end loop;
end $$;
commit;
