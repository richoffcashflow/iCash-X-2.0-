import assert from 'node:assert/strict';
import {installAccountYieldFixture,migration as accountMigration,value,read} from './acquisition-account-yield-fixture.mjs';
export {seedOrdinary,seedContinued,seedRecovery,lane,value,read,definition,policies,catalog,snapshot,assertOnlySchedulerHashesChanged} from './acquisition-account-yield-fixture.mjs';
export const captured=JSON.parse(read('tests/fixtures/research-priority-before.json'));
export const migration=read('config/research-priority-cost-isolation.sql');
export const migrationPath='supabase/migrations/20261116172000_research_priority_cost_isolation.sql';
export const signature='icash_work_private.daily_work_priority(uuid)';
export const beforeRank="coalesce((public.icash_daily_work_target(d.account_id)->>'priorityRatio')::numeric,1)";
export const afterRank='coalesce(icash_work_private.daily_work_priority(d.account_id),1)';
export async function installPriorityFixture(db){
 const exec=s=>db.exec?db.exec(s):db.query(s);
 await installAccountYieldFixture(db);await exec('begin;'+accountMigration+'commit;');
 await exec(`create schema if not exists icash_reliability_private;
 create table public.icash_prospecting_budgets(id bigint generated always as identity primary key,account_id uuid not null,baseline_cents bigint);
 create table public.icash_duplicate_discovery_coverage(operation_key text,account_id uuid,covered_cents bigint,primary key(operation_key,account_id));
 create function icash_reliability_private.pending_planning_cents(o public.icash_operation_spend) returns bigint
 language sql stable as $$select o.charge_cap_cents/2$$;
 grant select on public.icash_prospecting_budgets,public.icash_duplicate_discovery_coverage to service_role;
 grant usage on schema icash_reliability_private to service_role;`);
 const target=captured.find(f=>f.signature==='public.icash_daily_work_target(uuid)');
 await exec(target.definition);
 await exec('revoke all on function public.icash_daily_work_target(uuid) from public,anon,authenticated;grant execute on function public.icash_daily_work_target(uuid) to service_role;');
 for(const f of captured)assert.equal(await value(db,'select md5(pg_get_functiondef($1::regprocedure))',[f.signature]),f.hash);
}
export const priority=(db,account)=>value(db,'select icash_work_private.daily_work_priority($1)::text',[account]);
export const oldPriority=(db,account)=>value(db,"select public.icash_daily_work_target($1)->>'priorityRatio'",[account]);
export async function budget(db,account,cents){await db.query('insert into public.icash_prospecting_budgets(account_id,baseline_cents) values($1,$2)',[account,cents]);}
export async function operation(db,account,key,{state='settled',charge=0,covered=null,age='1 hour',cap=100}={}){
 await db.query(`insert into public.icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,state,charge_cap_cents,reserved_micros,charged_cents,settled_at,permission_until)
 select $1,$2,contact_rate_id,gen_random_uuid(),$3,$4,100000,$5,now()-$6::interval,now()+interval '1 day'
 from public.icash_discovery_configs where account_id=$2`,[key,account,state,cap,charge,age]);
 if(covered!==null)await db.query('insert into public.icash_duplicate_discovery_coverage values($1,$2,$3)',[key,account,covered]);
}
