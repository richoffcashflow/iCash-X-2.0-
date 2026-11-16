// Synthetic lifecycle sources only. Actual credit, settlement, reserve chain and
// prospecting guard bodies are saved definitions; no provider path is exercised.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const account='10000000-0000-4000-8000-000000000001';
export const rate='10000000-0000-4000-8000-000000000011';
export const release='b'.repeat(40);
export const poolDigest='2684b0bdd601bf9a63b4a1cc45cde4cc582404fefa830e47cafd4711de6dc322';
export const migrationPath='config/reviewed-planning-relief-20261116.sql';
export const before=JSON.parse(read('tests/fixtures/reviewed-pending-work-before.json'));
export const ledger=JSON.parse(read('tests/fixtures/reviewed-planning-relief-ledger.json'));
export const literal=v=>"'"+String(v).replaceAll("'","''")+"'";
export const json=v=>literal(JSON.stringify(v))+'::jsonb';
export const stageSQL=(pool,selected,sha=release)=>`select icash_reliability_private.stage_pending_work_relief_20261116(${json(pool)},${json(selected)},${literal(sha)})`;
export const activateSQL=(hash,sha=release)=>`select icash_reliability_private.activate_pending_work_relief_20261116(${literal(hash)},${literal(sha)})`;
export const admissionSQL=(key,a=account)=>`select public.icash_reserve_operation(${literal(a)}::uuid,${literal(key)},'${rate}'::uuid,now()+interval '1 day',null,false)`;
export const accountingSQL=`select jsonb_build_object(
 'operations',(select jsonb_agg(to_jsonb(o) order by operation_key) from public.icash_operation_spend o),
 'wallets',(select jsonb_agg(to_jsonb(w) order by account_id) from public.icash_wallets w),
 'accounts',(select jsonb_agg(to_jsonb(a) order by id) from public.icash_accounts a),
 'budget',(select to_jsonb(b) from public.icash_operating_budget b where id=1),
 'authorizations',(select jsonb_agg(to_jsonb(r) order by operation_key) from public.icash_credit_reservations r),
 'ledger',(select jsonb_agg(to_jsonb(l) order by event_key) from public.icash_credit_ledger l),
 'coverage',(select jsonb_agg(to_jsonb(c) order by operation_key) from public.icash_usage_coverage c),
 'oldPolicy',(select to_jsonb(p) from icash_reliability_private.pending_work_relief_policy p),
 'oldRows',(select jsonb_agg(to_jsonb(r) order by operation_key) from icash_reliability_private.pending_work_relief r),
 'nov13Policy',(select to_jsonb(p) from icash_reliability_private.pending_work_relief_policy_20261113 p),
 'nov13Rows',(select jsonb_agg(to_jsonb(r) order by operation_key) from icash_reliability_private.pending_work_relief_20261113 r))`;
export const poolSQL=`select coalesce(jsonb_agg(jsonb_build_object('operation_key',o.operation_key,'account_id',o.account_id,
 'source_sha256',encode(sha256(convert_to((to_jsonb(o)-'estimate_checked_at')::text,'UTF8')),'hex')) order by o.operation_key collate "C"),'[]'::jsonb)
 from public.icash_operation_spend o join public.fixture_relief_sources s using(operation_key)`;
export const selectedSQL=`select coalesce(jsonb_agg(jsonb_build_object('operation_key',o.operation_key,
 'idle_source_sha256',encode(sha256(convert_to(icash_reliability_private.pending_work_relief_idle_source_20261116(o)::text,'UTF8')),'hex')) order by o.operation_key collate "C"),'[]'::jsonb)
 from public.icash_operation_spend o join public.fixture_relief_sources s using(operation_key) where s.eligible and s.lease_expires_at is null`;
export function replacePoolDigest(source,pool){
 assert.equal(source.split(poolDigest).length,2,'only the public permitted-pool digest is replaced in the in-memory synthetic migration');
 const canonical=pool.map(p=>`${p.operation_key}\t${p.account_id}\t${p.source_sha256}`).sort().join('\n');
 return source.replace(poolDigest,createHash('sha256').update(canonical).digest('hex'));
}
export const syntheticGates=`
create or replace function icash_reliability_private.pending_work_relief_idle_source_20261116(p_operation public.icash_operation_spend)
 returns jsonb language sql stable set search_path='' as $$
 select to_jsonb(s) from public.fixture_relief_sources s where s.operation_key=p_operation.operation_key and s.account_id=p_operation.account_id
 and s.eligible and (s.lease_expires_at is null or s.lease_expires_at<=clock_timestamp()) $$;
create or replace function icash_reliability_private.pending_work_relief_lock_source_20261116(p_operation public.icash_operation_spend)
 returns void language plpgsql set search_path='' as $$begin
 perform 1 from public.fixture_relief_sources s where s.operation_key=p_operation.operation_key for update nowait;
 if not found then raise exception 'Synthetic source missing';end if;end$$;
create or replace function icash_reliability_private.pending_work_relief_controls_20261116(p_account uuid)
 returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.icash_accounts c join public.icash_wallets w on w.account_id=c.id
 join public.fixture_relief_controls f on f.account_id=c.id where c.id=p_account and not c.bot_paused
 and w.balance_cents>0 and f.allowed and public.icash_membership_work_allowed(p_account)) $$;
`;
export function seedSQL(key='fixture-original',quote=100,a=account){return `
insert into public.icash_credit_reservations(account_id,operation_key,amount_cents) values('${a}',${literal(key)},${quote});
insert into public.icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,state,permission_until,created_at,dispatched_at)
 select operation_key,account_id,'${rate}',id,amount_cents,amount_cents*500,'dispatched','2027-01-01','2026-11-14T01:00Z','2026-11-14T01:00:01Z'
 from public.icash_credit_reservations where operation_key=${literal(key)};
update public.icash_operating_budget set reserved_micros=reserved_micros+${quote*500} where id=1;
insert into public.fixture_relief_sources(operation_key,account_id) values(${literal(key)},'${a}');`}
export function baseSQL(){
 for(const {definition,md5} of Object.values(ledger))assert.equal(createHash('md5').update(definition).digest('hex'),md5);
 return `
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end$$;
${read('tests/fixtures/opportunity-schema.sql')}
create table public.icash_prospecting_budgets(id bigint generated always as identity primary key,account_id uuid,baseline_cents bigint);
${before.icash_prospecting_total_available};
drop table public.icash_prospecting_budgets cascade;
${read('tests/fixtures/reviewed-pending-work-foundation.sql')}
alter table public.icash_operation_spend add column dealmachine_cost_multiplier numeric,add column data_unit_cost_micros bigint,add column data_cost_basis text;
${Object.values(before).map(x=>x+';').join('\n')}
create trigger fixture_final_guard before insert on public.icash_operation_spend for each row execute function public.icash_guard_prospecting_spend();
${read('config/reviewed-pending-work-relief.sql')}
select icash_reliability_private.activate_pending_work_relief(manifest,repeat('a',40)) from icash_reliability_private.pending_work_relief_policy;
begin;${read('config/funded-stall-recovery-20261113.sql')}commit;
select icash_reliability_private.activate_pending_work_relief_20261113(manifest,repeat('a',40)) from icash_reliability_private.pending_work_relief_policy_20261113;
create table icash_reliability_private.research_settlement_corrections(operation_key text,account_id uuid,operation_snapshot jsonb,manifest_components jsonb);
-- Empty rowtypes allow the real per-kind checker to compile. Generic lifecycle
-- scenarios replace its body below and never claim these rows prove eligibility.
create schema icash_research_private;
create table icash_research_private.owner_batches(id uuid primary key,account_id uuid,primary_screening uuid,created_at timestamptz,state text,items jsonb,preview_receipt jsonb,paid_receipt jsonb,results jsonb);
create table icash_research_private.owner_batch_items(screening_id uuid,batch_id uuid,operation_key text);
create table icash_research_private.owner_exports(id uuid primary key,request jsonb,receipt jsonb,recovery jsonb,recovery_history jsonb,csv text,artifact_sha256 text,parsed_rows jsonb,terminal_at timestamptz,completed_at timestamptz,next_recover_at timestamptz,recovery_attempts integer,lease_token uuid,lease_until timestamptz,capacity_review_id uuid);
create table icash_research_private.requests(id uuid primary key,kind text,account_id uuid,operation_key text,admitted boolean,created_at timestamptz,finished_at timestamptz,result jsonb);
create table public.icash_dealmachine_request_budget(id integer primary key);
insert into public.icash_dealmachine_request_budget values(1);
create table public.icash_spend_activations(account_id uuid,enabled boolean,customer_cap_cents bigint);
create table public.icash_funding_orders(account_id uuid,mode text,state text,credited_at timestamptz);
insert into public.icash_spend_activations select id,true,1 from public.icash_accounts;
insert into public.icash_funding_orders select id,'live','paid',now() from public.icash_accounts;
insert into public.icash_data_cost_settings(provider,credit_micros,cost_basis,source_ref) values('dealmachine',10000,'synthetic','SYNTHETIC fixed data unit');
create function public.icash_voice_credit_bound(uuid,text,uuid) returns jsonb language sql as $$select null::jsonb$$;
create function public.icash_reception_credit_bound(uuid,text,uuid) returns jsonb language sql as $$select null::jsonb$$;
create function public.icash_limited_seller_voice(uuid,text) returns boolean language sql as $$select false$$;
create function public.icash_cancellation_voice_current(uuid,text) returns boolean language sql as $$select false$$;
create function public.icash_meta_voice_context(uuid,uuid) returns jsonb language sql as $$select null::jsonb$$;
create function public.icash_vip_active(uuid) returns boolean language sql as $$select false$$;
create function public.icash_seller_lead_rate_multiplier(uuid,text,uuid) returns numeric language sql as $$select 2::numeric$$;
create function public.icash_research_purchase_allowed(uuid,text,uuid) returns boolean language sql as $$select true$$;
update public.icash_operating_budget set require_company_reserve=false,standard_cost_multiplier=2,elevenlabs_cost_multiplier=2;
update public.icash_operation_rates set costs_micros=(select jsonb_object_agg(cat,case when cat='dealmachine' then 10000 else 0 end)
 from unnest(array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other']) cat);
${Object.values(ledger).map(x=>x.definition+';').join('\n')}
create table public.fixture_relief_sources(operation_key text primary key,account_id uuid not null,eligible boolean not null default true,
 lease_expires_at timestamptz,source_version integer not null default 1);
create table public.fixture_relief_controls(account_id uuid primary key,allowed boolean not null default true);
insert into public.fixture_relief_controls select id,true from public.icash_accounts;
${seedSQL()}
grant usage on schema public,icash_work_private to service_role;
grant select,insert,update on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
`;
}
if(process.argv[1]===fileURLToPath(import.meta.url)&&process.argv[2]==='--emit-base')process.stdout.write(baseSQL());
if(process.argv[1]===fileURLToPath(import.meta.url)&&process.argv[2]==='--emit-gates')process.stdout.write(syntheticGates);
if(process.argv[1]===fileURLToPath(import.meta.url)&&process.argv[2]==='--emit-peer')process.stdout.write(seedSQL('fixture-peer'));
