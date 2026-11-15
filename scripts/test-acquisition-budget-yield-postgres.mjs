// Synthetic native transactions only, on the fixed disposable local database.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {installBudgetYieldFixture,migration,migrationPath,predecessorHash,definition,policies,catalog,snapshot,
 assertOnlySchedulerHashesChanged,seedOrdinary,seedRecovery,lane,value,read} from '../tests/helpers/acquisition-budget-yield-fixture.mjs';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg'),clients=[];
const connect=async name=>{
 const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',application_name:'budget-yield-'+name,connectionTimeoutMillis:5000});
 clients.push(c);await c.connect();await assertDisposablePostgresTarget(c);
 await c.query("set statement_timeout='8s';set lock_timeout='5s';set timezone='UTC'");return c;
};
async function waitForLock(admin,pid){
 for(let attempt=0;attempt<100;attempt++){
  const row=(await admin.query('select wait_event_type,wait_event from pg_stat_activity where pid=$1',[pid])).rows[0];
  if(row?.wait_event_type==='Lock')return row;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.fail('Expected synthetic native lock contention');
}
const ticket=db=>async token=>value(db,'select to_jsonb(t) from public.icash_automation_tickets t where token=$1',[token]);
try{
 const admin=await connect('admin'),holder=await connect('holder'),research=await connect('research'),recovery=await connect('recovery');
 await admin.query('drop schema if exists icash_work_private cascade;drop schema if exists icash_private cascade;drop schema if exists icash_research_private cascade;drop schema if exists icash_owner_review_private cascade;drop schema public cascade;create schema public');
 await installBudgetYieldFixture(admin);
 assert.equal(migration,read(migrationPath));
 assert.equal(await value(admin,"select md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure))"),predecessorHash);
 const c=await seedRecovery(admin,92000),before=await snapshot(admin);
 await research.query('set role service_role');await recovery.query('set role service_role');
 // A real due followup can issue while a legitimate financial transaction owns
 // the operating-budget row. It never settles/replays its dispatched original.
 await holder.query('begin;select 1 from public.icash_operating_budget where id=1 for update;');
 await recovery.query('begin');
 const positive=await lane(recovery,'recovery');assert(positive?.token);
 assert.equal((await ticket(recovery)(positive.token)).account_id,c.account);
 await recovery.query('rollback');assert.deepEqual(await snapshot(admin),before);
 // Reproduce the original defect using the exact acquisition and lane bodies.
 const researchPid=await value(research,'select pg_backend_pid()');let finished=false;
 const blocked=lane(research,'research').then(result=>{finished=true;return result;});
 const originalWait=await waitForLock(admin,researchPid);
 assert.equal(await value(admin,"select exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and granted)",[researchPid]),true);
 for(let i=0;i<3;i++)assert.equal(await lane(recovery,'recovery'),null);
 assert.equal(finished,false);assert.deepEqual(await snapshot(admin),before);
 await holder.query('rollback');assert.equal(await blocked,null);assert.deepEqual(await snapshot(admin),before);

 const beforeDefinition=await definition(admin),beforePolicies=await policies(admin),beforeCatalog=await catalog(admin);
 await admin.query('begin');await admin.query(migration);
 await assert.rejects(admin.query('select 1/0 as synthetic_migration_ledger_failure'),/division by zero/);await admin.query('rollback');
 assert.equal(await definition(admin),beforeDefinition);assert.deepEqual(await policies(admin),beforePolicies);
 await admin.query('begin;'+migration+'commit;');
 const afterDefinition=await definition(admin),afterHash=await value(admin,"select md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure))");
 assertOnlySchedulerHashesChanged(beforePolicies,await policies(admin),afterHash);
 const expected=structuredClone(beforeCatalog);expected['public.icash_next_acquisition()'].definition=afterDefinition;
 assert.deepEqual(await catalog(admin),expected,'No function or ACL other than the initial acquisition lock changes');
 const upgraded=await snapshot(admin);
 await holder.query('begin;select 1 from public.icash_operating_budget where id=1 for update;');
 await research.query("set statement_timeout='500ms'");
 const start=performance.now();assert.equal(await lane(research,'research'),null);const yieldMs=performance.now()-start;
 assert.deepEqual(await snapshot(admin),upgraded,'Busy-budget yield changes no state');
 await recovery.query('begin');
 const independent=await lane(recovery,'recovery');assert(independent?.token);
 const followup=await ticket(recovery)(independent.token);
 assert.equal(followup.kind,'account_reconcile');assert.equal(followup.account_id,c.account);
 const activeSnapshot=await snapshot(recovery);
 for(const field of ['budget','accounts','wallets','operations','reservations','requests','configs','fairness','decisions']){
  assert.deepEqual(activeSnapshot[field],upgraded[field],field+' survives independent recovery issuance');
 }
 await recovery.query('rollback');await holder.query('rollback');
 assert.deepEqual(await snapshot(admin),upgraded);
 await research.query("set statement_timeout='8s'");

 // Real eligible research stays due through contention, then issues exactly
 // once after the budget is available. No provider/spend operation is created.
 const ordinary=await seedOrdinary(admin,92001),readySnapshot=await snapshot(admin);
 await holder.query('begin;select 1 from public.icash_operating_budget where id=1 for update;');
 assert.equal(await lane(research,'research'),null);assert.deepEqual(await snapshot(admin),readySnapshot);
 await holder.query('rollback');await research.query('begin');
 const selected=await lane(research,'research');assert(selected?.token);
 assert.equal((await ticket(research)(selected.token)).account_id,ordinary.account);
 const issuedSnapshot=await snapshot(research);
 assert.equal(issuedSnapshot.fairness[0].issued,readySnapshot.fairness[0].issued+1);
 for(const field of ['budget','accounts','wallets','operations','reservations','requests'])assert.deepEqual(issuedSnapshot[field],readySnapshot[field]);
 // Reverse ordering: once scheduling has the row, financial work still waits
 // for the same transaction to end; SKIP LOCKED does not release its lock.
 const holderPid=await value(holder,'select pg_backend_pid()');let budgetAcquired=false;
 await holder.query('begin');
 const reverse=holder.query('select 1 from public.icash_operating_budget where id=1 for update').then(result=>{budgetAcquired=true;return result;});
 await waitForLock(admin,holderPid);assert.equal(budgetAcquired,false);
 await research.query('rollback');await reverse;await holder.query('rollback');
 assert.deepEqual(await snapshot(admin),readySnapshot);

 // Current controls still win when committed by the original budget holder.
 await holder.query('begin;select 1 from public.icash_operating_budget where id=1 for update;');
 await holder.query('update public.icash_accounts set bot_paused=true where id=$1',[ordinary.account]);
 assert.equal(await lane(research,'research'),null);await holder.query('commit');
 const paused=await snapshot(admin);assert.equal(await lane(research,'research'),null);assert.deepEqual(await snapshot(admin),paused);
 await admin.query('update public.icash_accounts set bot_paused=false where id=$1',[ordinary.account]);
 assert.deepEqual(await snapshot(admin),readySnapshot);
 await holder.query('begin;select 1 from public.icash_operating_budget where id=1 for update;update public.icash_operating_budget set enabled=false where id=1;');
 assert.equal(await lane(research,'research'),null);await holder.query('commit');
 const disabled=await snapshot(admin);assert.equal(await lane(research,'research'),null);assert.deepEqual(await snapshot(admin),disabled);
 await admin.query('update public.icash_operating_budget set enabled=true where id=1');
 assert.deepEqual(await snapshot(admin),readySnapshot);
 console.log(JSON.stringify({result:'PASS native acquisition budget yield',postgres:await value(admin,'show server_version'),
  predecessorHash,afterHash,originalWait,originalReadyRecoveryPollsBlocked:3,yieldMs:Math.round(yieldMs),
  realRecoveryDuringContention:true,realResearchAfterUnlock:true,acquiredBudgetLockRetained:true,
  latePauseAndDisabledBudgetPreserved:true,onlyThreeManifestHashesChanged:true,allScenarioStateRolledBack:true}));
}catch(e){console.error(e.stack,e.where??'');process.exitCode=1;}finally{
 for(const c of clients){try{await c.query('rollback');}catch{}await c.end().catch(()=>{});}
}
