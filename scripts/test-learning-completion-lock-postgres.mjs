// Native synthetic interleavings through the exact screening RPCs and trigger.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setup,screeningSetup,migration,id,refreshDefinition,value,reset,sourceHash} from '../tests/helpers/learning-completion-fixture.mjs';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg'),clients=[];
const connect=async name=>{
 const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',application_name:'learning-completion-'+name,connectionTimeoutMillis:5000});
 clients.push(c);await c.connect();await assertDisposablePostgresTarget(c);
 await c.query("set statement_timeout='8s';set lock_timeout='3s';set timezone='UTC'");return c;
};
async function waitForLock(admin,pid){
 for(let n=0;n<200;n++){
  if(await value(admin,"select wait_event_type='Lock' from pg_stat_activity where pid=$1",[pid]))return;
  await new Promise(r=>setTimeout(r,10));
 }
 assert.fail('Expected native fixture lock contention');
}
try{
 const admin=await connect('admin'),holder=await connect('holder'),runner=await connect('runner'),screen=await connect('screen');
 await admin.query('drop schema if exists icash_learning_private cascade;drop schema if exists icash_learning_policy_private cascade;drop schema if exists icash_research_private cascade;drop schema if exists icash_reliability_private cascade;drop schema public cascade;create schema public;');
 await admin.query("do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end$$;");
 await admin.query(setup.replace(/create role (anon|authenticated|service_role);/g,'')+screeningSetup);
 assert.equal(await sourceHash(admin),'62d7625004e807cd463088b173dbba5d');
 const original=await value(admin,"select pg_get_functiondef('icash_refresh_shared_learning(integer)'::regprocedure)");
 const runnerPid=await value(runner,'select pg_backend_pid()');
 await screen.query("set statement_timeout='250ms'");
 const slowSecond=refreshDefinition(`if p_account='${id(2)}' then perform 1 from public.fixture_outcomes where account_id=p_account for update;end if;`);
 // Holds represent a real aggregate waiting on the next account, or the
 // global operation-review boundary. No provider traffic occurs in either.
 for(const phase of ['account','review'])for(const operation of ['claim','finish'])for(const fixed of [false,true]){
  await admin.query(original);if(fixed)await admin.query('begin;'+migration+'commit;');
  await admin.query('delete from icash_research_private.screening_attempts;delete from icash_screening_jobs;');
  await admin.query(`insert into icash_screening_jobs(id,account_id,event_key,snapshot,state,attempts,lease_token,lease_until)
   values($1,$2,'synthetic', '{}',$3,$4,$5,now()+interval '60 seconds')`,[id(90),id(1),operation==='claim'?'queued':'running',operation==='claim'?0:1,operation==='claim'?null:id(91)]);
  await admin.query(reset+slowSecond+`create or replace function public.icash_review_learning_operations() returns jsonb language plpgsql as $$begin ${phase==='review'?'perform pg_advisory_xact_lock(92634101);':''}return '{}'::jsonb;end$$;`);
  const beforeRevision=await value(admin,'select revision from icash_workspace_revisions where account_id=$1',[id(1)]);
  await holder.query('begin');
  if(phase==='account')await holder.query('select 1 from fixture_outcomes where account_id=$1 for update',[id(2)]);
  else await holder.query('select pg_advisory_xact_lock(92634101)');
  let settled=false;
  const refresh=value(runner,'select icash_refresh_shared_learning(2)').then(r=>{settled=true;return r;});
  await waitForLock(admin,runnerPid);
  const action=()=>operation==='claim'?value(screen,'select icash_claim_screening()'):value(screen,'select icash_finish_screening($1,$2,$3)',[id(90),id(91),{synthetic:true}]);
  if(!fixed){
   await assert.rejects(action(),e=>e.code==='57014'&&/statement timeout/.test(e.message));
   assert.equal(await value(admin,'select revision from icash_workspace_revisions where account_id=$1',[id(1)]),beforeRevision,'Timed-out source transaction rolls back');
  }else{
   const result=await action();if(operation==='claim')assert.equal(result.id,id(90));else assert.equal(result,true);
   assert.equal(await value(admin,'select revision from icash_workspace_revisions where account_id=$1',[id(1)]),String(Number(beforeRevision)+1));
   assert.equal(await value(admin,'select generation from icash_learning_queue where account_id=$1',[id(1)]),'2');
  }
  assert.equal(settled,false,'Foreground screening completes while the optional refresh is still blocked');
  await holder.query('rollback');
  assert.deepEqual(await refresh,{refreshed:2,failed:0,due:fixed?2:1});
  if(fixed){
   assert.equal(await value(admin,'select last_refreshed_at from icash_learning_queue where account_id=$1',[id(1)]),null,'New source generation must remain due');
   assert.equal(await value(admin,'select state from icash_screening_jobs where id=$1',[id(90)]),operation==='claim'?'running':'complete');
   assert.equal(await value(admin,'select count(*)::int from icash_research_private.screening_attempts'),operation==='claim'?0:1);
  }
 }
 // Real statement cancellation retains earlier aggregate output, per-account
 // error receipt and untouched later work after the checkpoint reordering.
 await admin.query(original+';\nbegin;'+migration+'commit;'+reset+refreshDefinition(`if p_account='${id(2)}' then perform pg_sleep(2);end if;`));
 await runner.query("set statement_timeout='250ms'");
 assert.deepEqual(await value(runner,'select icash_refresh_shared_learning(3)'),{refreshed:1,failed:1,due:1,canceled:true});
 assert.deepEqual(await value(admin,'select array_agg(value order by account_id) from fixture_outcomes'),[1,0,0]);
 assert.equal(await value(admin,'select last_error_code from icash_learning_queue where account_id=$1',[id(2)]),'57014');
 console.log('PASS native learning completion: original claim/finish timeouts reproduced in both later-account and global-review waits; fixed foreground work completes and preserves concurrent generations, exact screening attempts and real cancellation receipts.');
}finally{await Promise.allSettled(clients.map(c=>c.end()));}
