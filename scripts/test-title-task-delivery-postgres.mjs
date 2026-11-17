import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {installTitleTaskFixture,titleTaskMigration,titleTaskCase,claimTitleTask,finishTitleTask,cancelledTitleDeadlines} from '../tests/fixtures/title-task-delivery-fixture.mjs';
import {sendTitleCopyReply,titleCopyCase} from '../tests/fixtures/title-copy-fixture.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const connection={host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',connectionTimeoutMillis:5000};
const name='title_task_delivery_'+randomBytes(8).toString('hex'),clients=[];
const connect=async database=>{const c=new Client({...connection,database});await c.connect();await c.query("set statement_timeout='10s';set lock_timeout='8s'");c.exec=q=>c.query(q);return c;};
const admin=await connect('postgres');let pending;
try{
 await admin.query('create database '+name);const db=await connect(name),a=await connect(name),b=await connect(name);clients.push(db,a,b);
 await installTitleTaskFixture(db);
 const deadlineA=await cancelledTitleDeadlines(db),deadlineB=await cancelledTitleDeadlines(db);
 const originalDeadlines=(await db.query('select * from public.icash_title_tasks order by id')).rows;
 assert.equal(originalDeadlines.length,4);
 // A concurrent conversion of an exempt deadline or edit of its original
 // envelope cannot slip through the preserved empty-delivery cutover boundary.
 await a.query('begin');await a.query("update public.icash_title_tasks set state='scheduled' where id=$1",[deadlineA.tasks[0].id]);
 await b.query('begin');await assert.rejects(b.query(titleTaskMigration()),error=>error.code==='55P03');await b.query('rollback');await a.query('rollback');
 await a.query('begin');await a.query("update public.icash_signing_envelopes set state='voided' where id=$1",[deadlineB.purchase]);
 await b.query('begin');await assert.rejects(b.query(titleTaskMigration()),error=>error.code==='55P03');await b.query('rollback');await a.query('rollback');
 // First-rollout emptiness is checked while excluding concurrent old writers.
 // A busy budget or uncommitted title lifecycle causes a bounded safe refusal.
 await a.query('begin');await a.query('select id from public.icash_operating_budget where id=1 for update');
 await b.query('begin');await assert.rejects(b.query(titleTaskMigration()),error=>error.code==='55P03');await b.query('rollback');await a.query('rollback');
 await a.query('begin');await titleCopyCase(a);
 await b.query('begin');await assert.rejects(b.query(titleTaskMigration()),error=>error.code==='55P03');await b.query('rollback');await a.query('rollback');
 assert.equal((await db.query("select to_regnamespace('icash_title_task_delivery_private') value")).rows[0].value,null);
 await db.query('begin');await titleCopyCase(db);await assert.rejects(db.query(titleTaskMigration()),/requires an empty title lifecycle/);await db.query('rollback');
 await db.query('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key);insert into supabase_migrations.schema_migrations values(\'fixture\')');
 await db.query('begin');await db.query(titleTaskMigration());
 await assert.rejects(db.query("insert into supabase_migrations.schema_migrations values('fixture')"));await db.query('rollback');
 assert.equal((await db.query("select to_regnamespace('icash_title_task_delivery_private') value")).rows[0].value,null,'DDL rolls back with ledger');
 await db.query('begin');await db.query(titleTaskMigration());await db.query("insert into supabase_migrations.schema_migrations values('20261117035143')");await db.query('commit');
 assert.deepEqual((await db.query('select * from public.icash_title_tasks order by id')).rows,originalDeadlines,'Installation preserves exact cancelled non-delivery deadline rows');
 const pid=(await b.query('select pg_backend_pid() id')).rows[0].id;
 const waitLock=async()=>{for(let i=0;i<400;i++){if((await db.query("select wait_event_type='Lock' waiting from pg_stat_activity where pid=$1",[pid])).rows[0]?.waiting)return;await new Promise(r=>setTimeout(r,10));}throw Error('Expected native lock wait');};
 const sent=async c=>(await db.query('select count(*)::int n from public.icash_operation_spend where operation_key=$1',['title-followup:'+c.task.id])).rows[0].n;
 let c=await titleTaskCase(db);
 await a.query('begin;set local role service_role');assert((await claimTitleTask(a,c)).rows[0].value);
 await b.query('begin;set local role service_role');pending=claimTitleTask(b,c);pending.catch(()=>{});await waitLock();await a.query('commit');assert.equal((await pending).rows[0].value,null);pending=null;await b.query('commit');assert.equal(await sent(c),1);
 assert.equal((await finishTitleTask(db,c)).rows[0].value,true);
 assert.equal((await db.query('select state from public.icash_title_tasks where id=$1',[c.task.id])).rows[0].state,'done');
 // A changed task wins before final admission, without a reservation.
 c=await titleTaskCase(db);await a.query('begin');await a.query("update public.icash_title_tasks set label='Changed while claim waits' where id=$1",[c.task.id]);
 await b.query('begin;set local role service_role');pending=claimTitleTask(b,c);pending.catch(()=>{});await waitLock();await a.query('commit');assert.equal((await pending).rows[0].value,null);pending=null;await b.query('commit');assert.equal(await sent(c),0);
 // The actual inherited claim has already reserved when it reaches the final
 // envelope lock. Its subtransaction must roll all those writes back on drift.
 c=await titleTaskCase(db);await a.query('begin');await a.query("update public.icash_signing_envelopes set provider_id='202' where id=$1",[c.assignment]);
 await b.query('begin;set local role service_role');pending=claimTitleTask(b,c);pending.catch(()=>{});await waitLock();await a.query('commit');assert.equal((await pending).rows[0].value,null);pending=null;await b.query('commit');assert.equal(await sent(c),0);
 assert.equal((await db.query('select email_state from public.icash_title_tasks where id=$1',[c.task.id])).rows[0].email_state,'issued');
 // A claimed source retains its exact PDF row through commit. The later edit
 // cannot rewrite that operation, and its receipt must not complete changed work.
 c=await titleTaskCase(db);await a.query('begin;set local role service_role');assert((await claimTitleTask(a,c)).rows[0].value);
 await b.query('begin');pending=b.query("update public.icash_signing_envelopes set provider_id='202' where id=$1",[c.assignment]);pending.catch(()=>{});await waitLock();await a.query('commit');await pending;pending=null;await b.query('commit');
 assert.equal((await finishTitleTask(db,c,'native-changed-document')).rows[0].value,true);assert.equal((await db.query('select state from public.icash_title_tasks where id=$1',[c.task.id])).rows[0].state,'scheduled');assert.equal(await sent(c),1);
 // Edited business work while receipt persistence waits stays open; its original
 // accepted send remains immutable evidence and cannot be replayed.
 c=await titleTaskCase(db);assert((await claimTitleTask(db,c)).rows[0].value);await a.query('begin');await a.query("update public.icash_title_tasks set label='Added evidence',payload=payload||'{\"manual\":true}'::jsonb where id=$1",[c.task.id]);
 await b.query('begin;set local role service_role');pending=finishTitleTask(b,c,'native-edited');pending.catch(()=>{});await waitLock();await a.query('commit');assert.equal((await pending).rows[0].value,true);pending=null;await b.query('commit');
 const changed=(await db.query('select state,email_state,label from public.icash_title_tasks where id=$1',[c.task.id])).rows[0];assert.deepEqual(changed,{state:'scheduled',email_state:'sent',label:'Added evidence'});
 assert.equal((await finishTitleTask(db,c,'native-edited')).rows[0].value,true);assert.equal((await finishTitleTask(db,c,'conflict')).rows[0].value,false);
 assert.equal((await db.query('select count(*)::int n from icash_title_task_delivery_private.receipts where task_id=$1',[c.task.id])).rows[0].n,1);
 // Verified title reply first cancels the reminder before its normal claim;
 // the opposite ordering preserves its original admitted send and later cancel.
 c=await titleTaskCase(db,'follow_up');await a.query('begin');await sendTitleCopyReply(a,c,'Please stop following up.');await b.query('begin;set local role service_role');pending=claimTitleTask(b,c);pending.catch(()=>{});await waitLock();await a.query('commit');assert.equal((await pending).rows[0].value,null);pending=null;await b.query('commit');assert.equal(await sent(c),0);
 c=await titleTaskCase(db,'follow_up');await a.query('begin;set local role service_role');assert((await claimTitleTask(a,c)).rows[0].value);await b.query('begin');pending=sendTitleCopyReply(b,c,'Please stop following up.');pending.catch(()=>{});await waitLock();await a.query('commit');await pending;pending=null;await b.query('commit');assert.equal((await finishTitleTask(db,c,'native-followup')).rows[0].value,true);assert.equal((await db.query('select state from public.icash_title_tasks where id=$1',[c.task.id])).rows[0].state,'cancelled');assert.equal(await sent(c),1);
 // Permanent preparation reviews share the same source/claim fences. A manual
 // task edit, repaired PDF or admitted current worker wins over a stale failure.
 const prepare=async c=>(await db.query('select public.icash_prepare_title_task_delivery($1,$2) value',[c.account,c.task.id])).rows[0].value.preparation;
 const review=(connection,c,source)=>connection.query("select public.icash_review_title_task_preparation($1,$2,$3,'invalid_provider_id') value",[c.account,c.task.id,source]);
 for(const change of ['task','document','admitted']){
  c=await titleTaskCase(db);await db.query("update public.icash_signing_envelopes set provider_id='invalid-provider-id' where id=$1",[c.assignment]);const source=await prepare(c);
  await a.query('begin');
  if(change==='task')await a.query("update public.icash_title_tasks set label='Manually corrected task' where id=$1",[c.task.id]);
  else await a.query("update public.icash_signing_envelopes set provider_id='102' where id=$1",[c.assignment]);
  if(change==='admitted'){
   c.snapshot=(await a.query('select public.icash_title_task_delivery_snapshot($1,$2) value',[c.account,c.task.id])).rows[0].value;
   assert((await claimTitleTask(a,c)).rows[0].value);
  }
  await b.query('begin;set local role service_role');pending=review(b,c,source);pending.catch(()=>{});await waitLock();await a.query('commit');assert.equal((await pending).rows[0].value,false);pending=null;await b.query('commit');
  assert.equal((await db.query('select count(*)::int n from icash_title_task_delivery_private.preparation_reviews where task_id=$1',[c.task.id])).rows[0].n,0);
  assert.equal((await db.query('select state from public.icash_title_tasks where id=$1',[c.task.id])).rows[0].state,'scheduled');assert.equal(await sent(c),change==='admitted'?1:0);
 }
 c=await titleTaskCase(db);await db.query("update public.icash_signing_envelopes set provider_id='invalid-provider-id' where id=$1",[c.assignment]);const invalidSource=await prepare(c);
 await a.query('begin;set local role service_role');assert.equal((await review(a,c,invalidSource)).rows[0].value,true);
 await b.query('begin;set local role service_role');pending=claimTitleTask(b,c);pending.catch(()=>{});await waitLock();await a.query('commit');assert.equal((await pending).rows[0].value,null);pending=null;await b.query('commit');
 assert.equal(await sent(c),0);assert.equal((await db.query('select state from public.icash_title_tasks where id=$1',[c.task.id])).rows[0].state,'needs_review');
 console.log('PASS native title-task delivery: fail-fast empty-delivery/busy-writer cutover with unchanged original cancelled deadlines, transactional ledger rollback, one-use service-role dispatch, task/source races, post-reservation rollback, exact-document lock, original receipts and both verified reply/claim orders.');
}finally{
 for(const c of clients)await c.query('rollback').catch(()=>{});if(pending)await pending.catch(()=>{});await Promise.allSettled(clients.map(c=>c.end()));await admin.query('drop database if exists '+name+' with (force)');await admin.end();
}
