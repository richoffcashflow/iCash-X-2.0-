import {setupSql,seedSql,migration,enableSql,read} from './owner-preflight-cleanup-fixture.mjs';
export {read} from './owner-preflight-cleanup-fixture.mjs';
const deferral=read('config/owner-enrichment-deferral.sql');
const capGuards=deferral.slice(deferral.indexOf('create function public.icash_guard_owner_enrichment_recovery_credit'),deferral.indexOf('-- Keep the complete authoritative candidate'));
const stepGates=JSON.parse(read('tests/fixtures/owner-preflight-step-gates.json'));
const stepBefore=JSON.parse(read('tests/fixtures/owner-preflight-step-before.json'));
export const recoveryStages=JSON.parse(read('tests/fixtures/owner-recovery-code-stages-before.json'));
const stepDefinitions=['icash_owner_active_export_capacity()','icash_owner_active_export_capacity(uuid)','icash_research_private.owner_preflight_cohort(uuid,uuid)','public.icash_owner_preflight_due_at(uuid,uuid)','icash_enrichment_candidate(uuid)','icash_next_acquisition()'].map(signature=>stepBefore.find(x=>x.signature===signature).definition).join(';\n');
export const fixtureSql=setupSql+seedSql+read('config/owner-enrichment-evidence-indexes.sql')+capGuards+
 'alter table public.icash_owner_enrichment_recoveries drop constraint icash_owner_enrichment_recoveries_code_stage_check, add constraint icash_owner_enrichment_recoveries_code_stage_check '+recoveryStages.definition+';'+
 'alter table public.icash_automation_tickets add column prospecting_quote_cents bigint;'+migration+enableSql+`;
create function public.fixture_expired_ticket_seed(n integer) returns jsonb language plpgsql as $$
declare c jsonb;begin
 c:=public.fixture_cleanup_seed(n);
 -- The production journey reissues the same ticket after the original list
 -- expires, then the old handler records generic held. Its deadlines survive.
 update public.icash_automation_tickets set outcome='held' where id=(c->>'ticket')::uuid;
 return c;
end$$;`;
export const stepPrerequisites=`
create schema icash_work_private;
alter table public.fixture_cleanup_policy add column ordinary integer not null default 3,add column starter integer not null default 0;
create table public.icash_dealmachine_request_budget(id integer primary key,minute_start timestamptz,minute_used integer,minute_limit integer,day_start timestamptz,day_used integer,day_limit integer);
insert into public.icash_dealmachine_request_budget values(1,now(),0,70,now(),0,10000);
create function public.icash_dealmachine_provider_available() returns boolean language sql stable as $$select quota from public.fixture_cleanup_policy$$;
create function icash_research_private.request_reserve_state(timestamptz default now()) returns jsonb language sql stable as $$select jsonb_build_object('ordinaryRemaining',ordinary,'reserveRemaining',starter) from public.fixture_cleanup_policy$$;
create function icash_research_private.starter_request_allowance(uuid,timestamptz default now()) returns integer language sql stable as $$select case when $1 is null then 0 else starter end from public.fixture_cleanup_policy$$;

create table icash_work_private.continuation_policy(id integer primary key,enabled boolean,issued bigint);
insert into icash_work_private.continuation_policy values(1,true,0);
alter table icash_research_private.owner_exports add column if not exists terminal_at timestamptz,add column if not exists capacity_review_id uuid;
create or replace function public.icash_owner_active_export_enabled() returns boolean language sql stable as $$select true$$;
create or replace function icash_research_private.unknown_export_late_capacity_blocked() returns boolean language sql stable as $$select false$$;
`+stepGates.filter(x=>x.signature.startsWith('icash_dealmachine_capacity_available')).map(x=>x.definition).join(';\n')+';'+stepDefinitions+';';
export const stepSql=read('supabase/migrations/20261115000614_owner_preflight_step_capacity.sql');
export const continuationSql=read('supabase/migrations/20261115000635_owner_expired_preflight_ticket_continuation.sql');
