// Synthetic native transactions only. No provider or production connection.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setup,migration,seed,receipt,value,sourceHash,metadata,financialState,sourceState,id} from '../tests/helpers/missing-receipt-settlement-fixture.mjs';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg'),clients=[];
const connect=async name=>{
 const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',application_name:'missing-receipt-'+name,connectionTimeoutMillis:5000});
 clients.push(c);await c.connect();await assertDisposablePostgresTarget(c);
 await c.query("set statement_timeout='5s';set lock_timeout='3s';set timezone='UTC'");return c;
};
async function waiting(db,pid){
 for(let i=0;i<200;i++){
  if(await value(db,"select wait_event_type='Lock' from pg_stat_activity where pid=$1",[pid]))return;
  await new Promise(r=>setTimeout(r,10));
 }assert.fail('Expected synthetic lock contention');
}
const call=(db,key)=>value(db,'select public.icash_settle_estimate_before_sms_tokens($1)',[key]);
try{
 const admin=await connect('admin'),holder=await connect('holder'),poller=await connect('poller'),writer=await connect('writer');
 await admin.query('drop schema if exists icash_reliability_private cascade;drop schema if exists icash_research_private cascade;drop schema if exists icash_owner_review_private cascade;drop schema public cascade;create schema public;');
 await admin.query(setup);
 assert.equal(await sourceHash(admin),'d463afb80ef551b673a1f7c43710117f');
 const missing=await seed(admin,1),search=await seed(admin,2,'property_search'),buyer=await seed(admin,3,'buyer_discovery');
 const other=await seed(admin,4,'sms_send'),reserved=await seed(admin,5,'owner_enrichment','reserved'),settled=await seed(admin,6,'owner_enrichment','settled');
 const before=await financialState(admin),beforeMetadata=await metadata(admin);
 await holder.query('begin;select 1 from public.icash_operating_budget where id=1 for update');
 await poller.query("set statement_timeout='250ms'");
 await assert.rejects(call(poller,missing.operation),e=>e.code==='57014','Old missing-receipt check waits for the global budget');
 await holder.query('rollback');
 assert.deepEqual(await financialState(admin),before);
 // Serialize installation and reject a second installer after source changes.
 await holder.query('begin;'+migration);
 await poller.query("set statement_timeout='5s';begin");
 const pollerPid=await value(poller,'select pg_backend_pid()');
 const replay=poller.query(migration).then(()=>({installed:true}),error=>({error}));
 await waiting(admin,pollerPid);await holder.query('commit');
 assert.match((await replay).error?.message??'',/predecessor changed/);await poller.query('rollback');
 assert.deepEqual(await metadata(admin),beforeMetadata);
 console.log('Installed settlement MD5:',await sourceHash(admin));
 await holder.query('begin;select 1 from public.icash_operating_budget where id=1 for update');
 await poller.query("set statement_timeout='250ms'");
 for(const item of [missing,search,buyer]){
  assert.equal(await call(poller,item.operation),false);
  await receipt(admin,item,{account:id(8000+Number(item.operation.split(':')[1])),source:false});
  assert.equal(await call(poller,item.operation),false,'Unrelated account/deal receipts remain absent for this original');
 }
 for(const key of [other.operation,reserved.operation,settled.operation,'synthetic:missing-operation']){
  await assert.rejects(call(poller,key),e=>e.code==='57014','Other kinds, states and missing operations retain their original lock path');
 }
 const batch=await value(poller,'select public.icash_settle_pending_estimates($1,25)',[missing.account]);
 assert.deepEqual(batch,{settled:0,held:1,costBasis:'estimated'});
 assert(await value(admin,'select estimate_checked_at is not null from icash_operation_spend where operation_key=$1',[missing.operation]));
 assert.deepEqual(await financialState(admin),before,'Original hold/ledger/account state stays unchanged; retry cursor still advances');
 // A not-yet-committed receipt cannot authorize settlement. Its normal next
 // check sees the committed original and retains the original budget lock.
 await writer.query('begin');await receipt(writer,missing);
 assert.equal(await call(poller,missing.operation),false);
 await writer.query('commit');
 const committedSources=await sourceState(admin);
 await poller.query("set statement_timeout='5s'");
 const settlement=call(poller,missing.operation).then(result=>({result}),error=>({error}));
 await waiting(admin,pollerPid);
 assert.equal(await value(admin,'select state from icash_operation_spend where operation_key=$1',[missing.operation]),'dispatched');
 await holder.query('commit');
 assert.deepEqual(await settlement,{result:true});
 assert.equal(Number(await value(admin,'select charged_cents from icash_operation_spend where operation_key=$1',[missing.operation])),80);
 assert.equal(Number(await value(admin,'select balance_cents from icash_wallets where account_id=$1',[missing.account])),920);
 assert.equal(await value(admin,'select count(*)::int from icash_credit_ledger'),1);
 assert.deepEqual(await sourceState(admin),committedSources);
 assert.equal(await call(poller,missing.operation),true);
 assert.equal(await value(admin,'select count(*)::int from icash_credit_ledger'),1,'Repeated settlement remains idempotent');
 // Receipt-present invalid evidence retains the locked, fail-closed path too.
 await receipt(admin,search,{credits:'unknown',source:false});
 await holder.query('begin;select 1 from public.icash_operating_budget where id=1 for update');
 await poller.query("set statement_timeout='250ms'");
 await assert.rejects(call(poller,search.operation),e=>e.code==='57014');
 await holder.query('commit');assert.equal(await call(poller,search.operation),false);
 // A receipt can disappear after the optimistic read. The locked original
 // adapter must re-read it and keep the original hold, without ledger writes.
 await receipt(admin,buyer);
 const beforeDeletion=await financialState(admin);
 await holder.query('begin;select 1 from public.icash_operating_budget where id=1 for update');
 await poller.query("set statement_timeout='5s'");
 const deletedReceipt=call(poller,buyer.operation).then(result=>({result}),error=>({error}));
 await waiting(admin,pollerPid);
 await writer.query('delete from icash_buyer_search_receipts where operation_key=$1 and deal_id=$2',[buyer.operation,buyer.deal]);
 await holder.query('commit');assert.deepEqual(await deletedReceipt,{result:false});
 assert.deepEqual(await financialState(admin),beforeDeletion);
 console.log('PASS native missing receipt settlement: old global-budget wait reproduced; missing original checks stay held promptly; normal retry cursor preserved; a concurrent receipt waits for final budget admission and settles once; malformed receipt retains locked refusal; concurrent migration replay rejected.');
}finally{await Promise.allSettled(clients.map(async c=>{await c.query('rollback').catch(()=>{});await c.end();}));}
