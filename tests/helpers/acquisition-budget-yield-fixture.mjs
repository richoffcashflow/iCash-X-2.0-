import assert from 'node:assert/strict';
import {installContinuedSchedulingFixture,seedOrdinary,seedContinued,value,read} from './continued-owner-scheduling-fixture.mjs';
export {seedOrdinary,seedContinued,value,read};
export const migration=read('config/acquisition-budget-yield.sql');
export const migrationPath='supabase/migrations/20261115230440_acquisition_budget_yield.sql';
export const signature='public.icash_next_acquisition()';
export const predecessorHash='74354d757bc909e3c21923f47c368e24';
export const definition=db=>value(db,"select pg_get_functiondef('public.icash_next_acquisition()'::regprocedure)");
export const policies=db=>value(db,`select jsonb_build_object(
 'fair',(select to_jsonb(p) from icash_work_private.continuation_policy p),
 'step',(select to_jsonb(p) from icash_work_private.preflight_step_policy p),
 'headroom',(select to_jsonb(p) from icash_research_private.acquisition_headroom_policy p))`);
export const catalog=db=>value(db,`select jsonb_object_agg(n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')',
 jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',p.proowner,'acl',p.proacl))
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','icash_work_private','icash_research_private','icash_private') and p.prokind='f'`);
export const snapshot=db=>value(db,`select jsonb_build_object(
 'budget',(select jsonb_agg(to_jsonb(x) order by id) from public.icash_operating_budget x),
 'accounts',(select jsonb_agg(to_jsonb(x) order by id) from public.icash_accounts x),
 'wallets',(select jsonb_agg(to_jsonb(x) order by account_id) from public.icash_wallets x),
 'operations',(select jsonb_agg(to_jsonb(x) order by operation_key) from public.icash_operation_spend x),
 'reservations',(select jsonb_agg(to_jsonb(x) order by id) from public.icash_credit_reservations x),
 'requests',(select jsonb_agg(to_jsonb(x) order by id) from icash_research_private.requests x),
 'configs',(select jsonb_agg(to_jsonb(x) order by account_id) from public.icash_discovery_configs x),
 'tickets',(select jsonb_agg(to_jsonb(x) order by id) from public.icash_automation_tickets x),
 'fairness',(select jsonb_agg(to_jsonb(x) order by id) from icash_work_private.continuation_policy x),
 'decisions',(select jsonb_agg(to_jsonb(x) order by turn) from icash_work_private.continuation_decisions x),
 'followups',(select jsonb_agg(to_jsonb(x) order by account_id) from icash_work_private.account_followups x))`);

export function assertOnlySchedulerHashesChanged(before,after,hash){
 const expected=structuredClone(before);
 expected.fair.scheduler_hash=hash;
 expected.step.function_hashes[signature]=hash;
 expected.headroom.acquisition_hash=hash;
 assert.deepEqual(after,expected,'Exactly three manifest slots change; all activation receipts, counters and other hashes survive');
}
export async function installBudgetYieldFixture(db){
 const exec=sql=>db.exec?db.exec(sql):db.query(sql);
 await installContinuedSchedulingFixture(db);
 await exec('begin;'+read('config/continued-owner-scheduling.sql')+'commit;');
 await exec('begin;'+read('config/owner-wait-admission.sql')+'commit;');
 assert.equal(await value(db,"select md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure))"),predecessorHash);
 // Real lane and account-followup issuers. Only unrelated issuers are empty
 // synthetic boundaries; research selection and its fairness recorder are real.
 const parallel=read('config/parallel-work-throughput.sql');
 const tableStart=parallel.indexOf('create table icash_work_private.account_followups(');
 const tableEnd=parallel.indexOf('-- Queue the follow-up',tableStart);
 assert(tableStart>0&&tableEnd>tableStart);
 await exec('alter table icash_work_private.dispatch_policy add column last_seed_at timestamptz;update icash_work_private.dispatch_policy set last_seed_at=now();');
 await exec(parallel.slice(tableStart,tableEnd));
 const followup=JSON.parse(read('tests/fixtures/acquisition-settlement-isolation-before.json')).find(x=>x.signature==='public.icash_issue_account_followup()');
 assert(followup);await exec(followup.definition);
 assert.equal(await value(db,"select md5(pg_get_functiondef('public.icash_issue_account_followup()'::regprocedure))"),followup.hash);
 for(const name of ['icash_next_automation','icash_issue_ready_voice_ticket','icash_issue_due_text_ai','icash_next_seller_followup','icash_recover_unstarted_seller_opener','icash_issue_ready_seller_text','icash_issue_due_signing_result','icash_issue_due_voice_result']){
  await exec(`create or replace function public.${name}() returns jsonb language sql as $$select null::jsonb$$;`);
 }
 const laneStart=parallel.indexOf('create function public.icash_next_automation_lane(');
 const laneEnd=parallel.indexOf('\nrevoke all on function',laneStart);
 assert(laneStart>0&&laneEnd>laneStart);await exec(parallel.slice(laneStart,laneEnd));
 await exec(`revoke all on function public.icash_next_automation_lane(text),public.icash_issue_account_followup() from public,anon,authenticated;
 grant execute on function public.icash_next_automation_lane(text),public.icash_issue_account_followup() to service_role;`);
}
export const lane=(db,name)=>value(db,'select public.icash_next_automation_lane($1)',[name]);
export async function seedRecovery(db,n){
 const c=await seedOrdinary(db,n);
 await db.query('update public.icash_discovery_configs set enabled=false where account_id=$1',[c.account]);
 await db.query("insert into icash_work_private.account_followups(account_id,next_run_at) values($1,now()-interval '1 hour')",[c.account]);
 await db.query(`insert into public.icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,state,charge_cap_cents,reserved_micros,permission_until)
 select $2,account_id,contact_rate_id,gen_random_uuid(),'dispatched',100,100000,now()+interval '1 day' from public.icash_discovery_configs where account_id=$1`,[c.account,'synthetic-original-unknown-'+n]);
 return c;
}
