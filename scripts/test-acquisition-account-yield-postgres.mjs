// Synthetic native transactions only, on the fixed disposable local database.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {installAccountYieldFixture,migration,migrationPath,predecessorHash,definition,policies,catalog,snapshot,
 assertOnlySchedulerHashesChanged,seedOrdinary,seedRecovery,lane,value,read,beforeSelection,afterSelection} from '../tests/helpers/acquisition-account-yield-fixture.mjs';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg'),clients=[];
const connect=async name=>{
 const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',application_name:'account-yield-'+name,connectionTimeoutMillis:5000});
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
const ticket=(db,token)=>value(db,'select to_jsonb(t) from public.icash_automation_tickets t where token=$1',[token]);
try{
 const admin=await connect('admin'),holder=await connect('holder'),research=await connect('research'),recovery=await connect('recovery');
 await admin.query('drop schema if exists icash_work_private cascade;drop schema if exists icash_private cascade;drop schema if exists icash_research_private cascade;drop schema if exists icash_owner_review_private cascade;drop schema public cascade;create schema public');
 await installAccountYieldFixture(admin);assert.equal(migration,read(migrationPath));
 assert.equal(await value(admin,"select md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure))"),predecessorHash);
 // Six older account rows are legitimately busy, with an eligible later one.
 // SKIP LOCKED applies before LIMIT: a locked account cannot consume the five
 // returned candidate positions or starve a later eligible account.
 const busy=[];for(let n=0;n<6;n++)busy.push(await seedOrdinary(admin,93000+n));
 const available=await seedOrdinary(admin,93006),dueRecovery=await seedRecovery(admin,93007);
 await admin.query("update public.icash_discovery_configs set next_run_at=now()-interval '30 minutes' where account_id=any($1::uuid[])",[busy.map(c=>c.account)]);
 const before=await snapshot(admin);await research.query('set role service_role');await recovery.query('set role service_role');
 await holder.query('begin');await holder.query('select 1 from public.icash_accounts where id=any($1::uuid[]) for update',[busy.map(c=>c.account)]);
 await research.query("set statement_timeout='500ms'");
 const pid=await value(research,'select pg_backend_pid()');
 const blocked=lane(research,'research').then(()=>({unexpected:true}),error=>({error}));
 const originalWait=await waitForLock(admin,pid);
 assert.equal(await value(admin,"select exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and granted)",[pid]),true);
 assert.equal(await lane(recovery,'recovery'),null,'Blocked research owns the shared lane lock and prevents independent recovery');
 const result=await blocked;assert.equal(result.error?.code,'57014','Exact old selector reaches the account lock and times out');
 assert.deepEqual(await snapshot(admin),before,'Failed old selection rolls back all local work');
 await holder.query('rollback');
 const beforeDefinition=await definition(admin),beforePolicies=await policies(admin),beforeCatalog=await catalog(admin);
 await admin.query('begin;'+migration+'commit;');
 const afterDefinition=await definition(admin),afterHash=await value(admin,"select md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure))");
 assert.equal(afterDefinition,beforeDefinition.replace(beforeSelection,afterSelection));
 assertOnlySchedulerHashesChanged(beforePolicies,await policies(admin),afterHash);
 const expected=structuredClone(beforeCatalog);expected['public.icash_next_acquisition()'].definition=afterDefinition;
 assert.deepEqual(await catalog(admin),expected);
 const upgraded=await snapshot(admin);
 await holder.query('begin');await holder.query('select 1 from public.icash_accounts where id=any($1::uuid[]) for update',[busy.map(c=>c.account)]);
 const start=performance.now();await research.query('begin');
 const selected=await lane(research,'research'),yieldMs=performance.now()-start;
 assert(selected?.token);assert.equal((await ticket(research,selected.token)).account_id,available.account,'Later unlocked account must issue despite six older locked accounts');
 const issued=await snapshot(research);
 for(const c of busy)assert.deepEqual(issued.configs.find(x=>x.account_id===c.account),upgraded.configs.find(x=>x.account_id===c.account),'Busy account keeps its due time and complete config');
 for(const field of ['budget','accounts','wallets','operations','reservations','requests'])assert.deepEqual(issued[field],upgraded[field],field+' unchanged');
 assert.equal(issued.fairness[0].issued,upgraded.fairness[0].issued+1);
 // The acquired account lock remains authoritative until selection commits.
 const holderPid=await value(holder,'select pg_backend_pid()');
 let acquired=false;const reverse=holder.query('select 1 from public.icash_accounts where id=$1 for update',[available.account]).then(r=>{acquired=true;return r;});
 await waitForLock(admin,holderPid);assert.equal(acquired,false);
 await research.query('rollback');await reverse;
 await recovery.query('begin');const independent=await lane(recovery,'recovery');assert(independent?.token);
 assert.equal((await ticket(recovery,independent.token)).account_id,dueRecovery.account);await recovery.query('rollback');
 await holder.query('rollback');assert.deepEqual(await snapshot(admin),upgraded);
 // The skipped oldest account remains selectable after its holder releases.
 await research.query('begin');const resumed=await lane(research,'research');assert(resumed?.token);
 const resumedAccount=(await ticket(research,resumed.token)).account_id;assert(busy.some(c=>c.account===resumedAccount));
 await research.query('rollback');assert.deepEqual(await snapshot(admin),upgraded);
 // Current Pause committed by the original holder is honored on the next poll.
 await holder.query('begin');await holder.query('update public.icash_accounts set bot_paused=true where id=any($1::uuid[])',[busy.map(c=>c.account)]);
 await research.query('begin');const whilePauseUncommitted=await lane(research,'research');
 assert.equal((await ticket(research,whilePauseUncommitted.token)).account_id,available.account);await research.query('rollback');
 await holder.query('commit');await research.query('begin');const afterPause=await lane(research,'research');
 assert.equal((await ticket(research,afterPause.token)).account_id,available.account);await research.query('rollback');
 // A held configuration row is still skipped independently of the new account lock.
 await holder.query('begin');await holder.query('select 1 from public.icash_discovery_configs where account_id=$1 for update',[available.account]);
 assert.equal(await lane(research,'research'),null);await holder.query('rollback');
 console.log(JSON.stringify({result:'PASS native acquisition account yield',postgres:await value(admin,'show server_version'),predecessorHash,afterHash,originalWait,oldTimeout:'57014',yieldMs:Math.round(yieldMs),sixBusyBeforeLaterAccount:true,acquiredAccountLockRetained:true,independentRecovery:true,oldestResumes:true,latePausePreserved:true,onlyThreeManifestHashesChanged:true}));
}catch(e){console.error(e.stack,e.where??'');process.exitCode=1;}finally{
 await Promise.allSettled(clients.map(c=>c.query('rollback')));
 await Promise.allSettled(clients.map(c=>c.end()));
}
