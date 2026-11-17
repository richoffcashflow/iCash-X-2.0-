// Native synthetic transactions only: no production credentials or providers.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setup,migration,id,value,sourceHash,metadata,progress} from '../tests/helpers/learning-estimate-fixture.mjs';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg'),clients=[];
const connect=async name=>{
 const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',application_name:'learning-estimate-'+name,connectionTimeoutMillis:5000});
 clients.push(c);await c.connect();await assertDisposablePostgresTarget(c);
 await c.query("set statement_timeout='5s';set lock_timeout='3s';set timezone='UTC'");return c;
};
async function waiting(admin,pid){
 for(let i=0;i<200;i++){
  if(await value(admin,"select wait_event_type='Lock' from pg_stat_activity where pid=$1",[pid]))return;
  await new Promise(r=>setTimeout(r,10));
 }assert.fail('Expected synthetic row-lock contention');
}
try{
 const admin=await connect('admin'),holder=await connect('holder'),poller=await connect('poller'),receipt=await connect('receipt');
 await admin.query('drop schema if exists fixture_other cascade;drop schema public cascade;create schema public;');
 await admin.query(setup);
 assert.equal(await sourceHash(admin),'821d84ea09d109cfdd5b1272a0745509');
 const beforeMetadata=await metadata(admin);
 await holder.query('begin');await holder.query('select 1 from icash_learning_queue where account_id=$1 for update',[id(1)]);
 await poller.query("set statement_timeout='250ms'");
 await assert.rejects(poller.query("update icash_operation_spend set estimate_checked_at=clock_timestamp() where operation_key='synthetic-operation'"),e=>e.code==='57014');
 await holder.query('rollback');
 // Concurrent installers must re-check the predecessor after the shared
 // migration lock, including while the first install awaits schema history.
 await holder.query('begin;'+migration);
 const pollerPid=await value(poller,'select pg_backend_pid()');
 await poller.query("set statement_timeout='5s';begin");
 const replay=poller.query(migration).then(()=>({installed:true}),error=>({error}));
 await waiting(admin,pollerPid);
 await holder.query('commit');
 const replayResult=await replay;
 assert.match(replayResult.error?.message??'',/predecessor changed/,'Concurrent replay rejects the already replaced predecessor');
 await poller.query('rollback');
 assert.deepEqual(await metadata(admin),beforeMetadata);
 console.log('Installed trigger MD5:',await sourceHash(admin));
 await poller.query("set statement_timeout='250ms'");
 const before=await progress(admin);
 await holder.query('begin');await holder.query('select 1 from icash_learning_queue where account_id=$1 for update',[id(1)]);
 await poller.query("update icash_operation_spend set estimate_checked_at=clock_timestamp() where operation_key='synthetic-operation'");
 assert.deepEqual(await progress(admin),before,'Polling completes while learning queue is locked without false activity');
 const receiptPid=await value(receipt,'select pg_backend_pid()');
 let completed=false;
 const receiptWrite=receipt.query("update icash_operation_spend set receipt='{\"new\":true}',estimate_checked_at=clock_timestamp() where operation_key='synthetic-operation'").then(r=>{completed=true;return r;});
 await waiting(admin,receiptPid);assert.equal(completed,false,'Real receipts retain queue synchronization');
 await holder.query('commit');await receiptWrite;
 const afterReceipt=await progress(admin);
 assert.equal(Number(afterReceipt.queue.generation),Number(before.queue.generation)+1);
 assert.equal(Number(afterReceipt.revision.revision),Number(before.revision.revision)+1);
 await admin.query('update icash_learning_queue set due_at=case when generation=$1 then now()+interval \'1 hour\' else due_at end,last_refreshed_at=case when generation=$1 then now() else last_refreshed_at end where account_id=$2',[before.queue.generation,id(1)]);
 assert.equal((await progress(admin)).queue.last_refreshed_at,null,'Old refresh cannot consume the later receipt generation');
 // Receipt and cursor updates to the same original row serialize normally.
 await poller.query('begin');await poller.query("update icash_operation_spend set estimate_checked_at=clock_timestamp() where operation_key='synthetic-operation'");
 const stateWrite=receipt.query("update icash_operation_spend set state='settled',actual_micros=100,settlement_evidence='synthetic receipt',estimate_checked_at=clock_timestamp() where operation_key='synthetic-operation'");
 await waiting(admin,receiptPid);await poller.query('commit');await stateWrite;
 assert.equal(Number((await progress(admin)).queue.generation),Number(before.queue.generation)+2);
 console.log('PASS native learning estimate bookkeeping: concurrent migration replay rejected after shared lock; baseline false-wake lock timeout reproduced; cursor completes behind a locked learning row; simultaneous receipt and settlement preserve row locking, exact revisions and newer generations.');
}finally{await Promise.allSettled(clients.map(async c=>{await c.query('rollback').catch(()=>{});await c.end();}));}
