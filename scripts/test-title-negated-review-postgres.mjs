// Actual title ingestion and trigger races on the fixed disposable database only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
import {runTitleNegatedReview,titleReviewCase,sendTitleReview,reviewMetadata} from '../tests/fixtures/title-negated-review-fixture.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const clients=[];
async function connect(name){
 const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',application_name:'title-review-'+name,connectionTimeoutMillis:5000});
 clients.push(c);await c.connect();await assertDisposablePostgresTarget(c);
 await c.query("set statement_timeout='10s';set lock_timeout='8s';set timezone='UTC'");c.exec=sql=>c.query(sql);return c;
}
let pending;
try{
 const db=await connect('admin'),first=await connect('first'),second=await connect('second');
 await db.exec('drop schema public cascade;create schema public');
 await runTitleNegatedReview(db,{beforeMigration:async(migration,before)=>{
  await first.query('begin;select pg_advisory_xact_lock(726341927)');
  await assert.rejects(db.exec('begin;'+migration+'commit;'),error=>error.code==='55P03','Migration yields under its real lock timeout');
  await db.query('rollback');await first.query('rollback');
  assert.deepEqual(await reviewMetadata(db),before,'Busy migration leaves the exact predecessor and permissions unchanged');
 }});
 const firstPid=(await first.query('select pg_backend_pid() pid')).rows[0].pid;
 const secondPid=(await second.query('select pg_backend_pid() pid')).rows[0].pid;
 for(const positiveFirst of [true,false]){
  const c=await titleReviewCase(db);
  await first.query('begin');await second.query('begin');
  const firstReply=await sendTitleReview(first,c.request,positiveFirst?'There is a lien.':'There is no lien.');
  pending=sendTitleReview(second,c.request,positiveFirst?'There is no lien.':'There is a lien.');pending.catch(()=>{});
  let observed=false;
  for(const limit=Date.now()+4000;Date.now()<limit;){
   const row=(await db.query("select wait_event_type,$2::int=any(pg_blocking_pids(pid)) held from pg_stat_activity where pid=$1",[secondPid,firstPid])).rows[0];
   if(row?.wait_event_type==='Lock'&&row.held){observed=true;break;}
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert(observed,'Concurrent actual reply triggers must visibly contend before the first transaction commits');
  await first.query('commit');const secondReply=await pending;pending=null;await second.query('commit');
  const state=await c.state();
  assert.equal(state.control?.manual,true,'A concurrent negative must never clear a real title issue, in either commit order');
  assert.equal(state.setup?.review_reason,'title_issue');assert.equal(state.setup?.reply_id,positiveFirst?firstReply.id:secondReply.id);
  assert.equal(state.deal.stage,'under_contract');
  assert.equal(state.tasks.filter(t=>t.kind==='reply_review'&&t.state==='needs_review').length,2,'Both original replies remain reviewable');
 }
 console.log('PASS native title review: observed overlapping positive/negative reply triggers in both orders, exact issue source retained, manual hold preserved, no milestone advancement.');
}catch(error){console.error(error.stack,error.where??'');process.exitCode=1;}finally{
 // Roll back the lock holder before awaiting a potentially blocked second query.
 if(clients[1])await clients[1].query('rollback').catch(()=>{});
 if(pending)await pending.catch(()=>{});
 await Promise.allSettled(clients.map(async c=>{try{await c.query('rollback');}finally{await c.end();}}));
}
