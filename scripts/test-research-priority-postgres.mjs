// Actual selector and target SQL over synthetic original operations only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {installPriorityFixture,migration,signature,beforeRank,afterRank,definition,policies,catalog,snapshot,
 assertOnlySchedulerHashesChanged,seedOrdinary,seedRecovery,lane,value,budget,operation,priority,oldPriority} from '../tests/helpers/research-priority-fixture.mjs';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg'),clients=[];
let initialized=false;
async function connect(name){
 const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',application_name:'priority-'+name,connectionTimeoutMillis:5000});
 clients.push(c);await c.connect();await assertDisposablePostgresTarget(c);
 await c.query("set statement_timeout='8s';set lock_timeout='5s';set timezone='UTC';set search_path=''");return c;
}
async function waitForLock(admin,pid){
 for(let n=0;n<100;n++){
  const r=(await admin.query('select wait_event_type,wait_event from pg_stat_activity where pid=$1',[pid])).rows[0];
  if(r?.wait_event_type==='Lock')return r;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.fail('Expected synthetic pending-report lock');
}
const accountFor=(db,t)=>value(db,'select account_id from public.icash_automation_tickets where token=$1',[t.token]);
try{
 const admin=await connect('admin'),holder=await connect('holder'),research=await connect('research'),recovery=await connect('recovery');
 await admin.query('drop schema if exists icash_reliability_private cascade;drop schema if exists icash_work_private cascade;drop schema if exists icash_private cascade;drop schema if exists icash_research_private cascade;drop schema if exists icash_owner_review_private cascade;drop schema public cascade;create schema public');
 await installPriorityFixture(admin);initialized=true;
 const costly=await seedOrdinary(admin,96000),ready=await seedOrdinary(admin,96001),dueRecovery=await seedRecovery(admin,96002);
 await budget(admin,costly.account,1000);await budget(admin,ready.account,1000);
 await operation(admin,costly.account,'synthetic-pending',{state:'dispatched',cap:9900});
 await operation(admin,costly.account,'synthetic-paid',{charge:450});
 await admin.query("update public.icash_discovery_configs set next_run_at=now()-interval '1 minute'");
 await admin.query(`create or replace function icash_reliability_private.pending_planning_cents(o public.icash_operation_spend) returns bigint
  language plpgsql stable as $$begin perform pg_advisory_xact_lock(98317,1);return o.charge_cap_cents/2;end$$;`);
 assert.equal(Number(await oldPriority(admin,costly.account)),0.9);
 assert.equal(Number(await oldPriority(admin,ready.account)),0);
 const before=await snapshot(admin),beforeDefinition=await definition(admin),beforePolicies=await policies(admin),beforeCatalog=await catalog(admin);
 await research.query("set role service_role;set statement_timeout='500ms'");await recovery.query('set role service_role');
 await holder.query('begin;select pg_advisory_xact_lock(98317,1)');
 const pid=await value(research,'select pg_backend_pid()');
 const blocked=lane(research,'research').then(()=>({unexpected:true}),error=>({error}));
 const originalWait=await waitForLock(admin,pid);
 assert.equal(await lane(recovery,'recovery'),null,'Unneeded pending-cost report holds the shared scheduler before ranking finishes');
 const failed=await blocked;assert.equal(failed.error?.code,'57014');
 assert.deepEqual(await snapshot(admin),before,'Original timeout rolls back issuance and all original money');
 await holder.query('rollback');
 await admin.query('begin;'+migration+'commit;');
 const afterDefinition=await definition(admin),afterHash=await value(admin,"select md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure))");
 assert.equal(afterDefinition,beforeDefinition.replace(beforeRank,afterRank));assertOnlySchedulerHashesChanged(beforePolicies,await policies(admin),afterHash);
 const afterCatalog=await catalog(admin),expected=structuredClone(beforeCatalog);expected['public.icash_next_acquisition()'].definition=afterDefinition;
 delete afterCatalog[signature];assert.deepEqual(afterCatalog,expected);
 const upgraded=await snapshot(admin);
 await holder.query('begin;select pg_advisory_xact_lock(98317,1)');
 await research.query('begin');const start=performance.now();const issued=await lane(research,'research'),elapsedMs=performance.now()-start;
 assert(issued?.token);assert.equal(await accountFor(research,issued),ready.account,'The same lowest-spend account wins while unrelated pending reporting is blocked');
 const selected=await snapshot(research);
 for(const k of ['budget','accounts','wallets','operations','reservations','requests'])assert.deepEqual(selected[k],upgraded[k]);
 const holderPid=await value(holder,'select pg_backend_pid()');let acquired=false;
 const accountLock=holder.query('select 1 from public.icash_accounts where id=$1 for update',[ready.account]).then(()=>{acquired=true;});
 await waitForLock(admin,holderPid);assert.equal(acquired,false,'Selected account retains its final control lock');
 await research.query('rollback');await accountLock;await holder.query('rollback');
 await recovery.query('begin');const continued=await lane(recovery,'recovery');assert(continued?.token);assert.equal(await accountFor(recovery,continued),dueRecovery.account);await recovery.query('rollback');
 assert.deepEqual(await snapshot(admin),upgraded);
 // Full target still honors its pending boundary; scalar rank remains identical
 // across an actual settlement change, covered cost and the 24-hour boundary.
 await admin.query('begin');
 for(const [key,opts] of [['covered',{charge:100,covered:150}],['old',{charge:900,age:'24 hours'}],['recent',{charge:20,age:'23 hours'}]]){
  await operation(admin,ready.account,'native-'+key,opts);assert.equal(await priority(admin,ready.account),await oldPriority(admin,ready.account));
 }
 await admin.query('rollback');
 console.log(JSON.stringify({result:'PASS native research priority isolation',postgres:await value(admin,'show server_version'),originalTimeout:'57014',originalWait,selectionMs:Math.round(elapsedMs),sameLowestSpendAccount:true,selectedAccountLockRetained:true,independentRecovery:true,allOriginalMoneyPreserved:true,afterHash}));
}catch(e){console.error(e.stack,e.where??'');process.exitCode=1;}finally{
 await Promise.allSettled(clients.map(c=>c.query('rollback')));
 if(initialized)await clients[0].query('drop schema if exists icash_reliability_private cascade');
 await Promise.allSettled(clients.map(c=>c.end()));
}
