import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
import {setup,cases,directCases,deferredLifecycleCases,jointScenario,preparedOriginal,originalContractMessage} from '../tests/helpers/seller-joint-memory-fixture.mjs';
import {rpc} from '../tests/helpers/seller-atomic-memory-fixture.mjs';
import {reviewSellerAgreementMemory} from '../lib/seller-agreement-memory-proof.ts';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
globalThis.fetch=async()=>{throw Error('NO NETWORK: ordered seller source fixture only');};
const clients=[];let pending;
async function connect(name){const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',application_name:'seller-joint-'+name,connectionTimeoutMillis:5000});clients.push(c);await c.connect();await assertDisposablePostgresTarget(c);await c.query("set statement_timeout='12s';set lock_timeout='10s';set timezone='UTC'");c.exec=sql=>c.query(sql);return c;}
async function blocked(db,pid,holder){for(const deadline=Date.now()+4000;Date.now()<deadline;){const r=(await db.query('select wait_event_type,$2::int=any(pg_blocking_pids(pid)) held from pg_stat_activity where pid=$1',[pid,holder])).rows[0];if(r?.wait_event_type==='Lock'&&r.held)return;await new Promise(r=>setTimeout(r,10));}assert.fail('Original source writer did not visibly wait on exact recipient fence');}
try{
 const db=await connect('admin'),first=await connect('first'),second=await connect('second'),third=await connect('third');
 await db.exec('drop schema if exists icash_seller_call_source_private,icash_seller_agreement_memory_private,icash_seller_memory_private,icash_seller_agreement_private,icash_recorded_reception_private,icash_call_offer_private,icash_callback_private,icash_reception_private,auth cascade;drop schema public cascade;create schema public;');
 await setup(db);await cases(db);await directCases(db);await deferredLifecycleCases(db);
 const pid1=(await first.query('select pg_backend_pid() pid')).rows[0].pid,pid2=(await second.query('select pg_backend_pid() pid')).rows[0].pid;
 for(const writer of ['sms','raw-completion'])for(const order of ['claim-first','source-first']){
  const s=await jointScenario(db);await s.historical();s.args.p_memory_fingerprint=(await s.context()).fingerprint;
  await first.query('begin');await second.query('begin');
  const write=client=>writer==='sms'?s.incoming(client,'Wait, I have another mortgage.'):s.complete(undefined,x=>x,client);
  if(order==='claim-first'){
   assert((await s.claim(first))?.claimed);pending=write(second);pending.catch(()=>{});await blocked(db,pid2,pid1);
   const other=await jointScenario(db);assert((await other.claim(third))?.claimed,'unrelated phone progresses during actual raw+SMS fence wait');
   await first.query('commit');await pending;pending=null;await second.query('commit');await assert.rejects(s.begin(),/source|memory/i);
  }else{
   await write(first);pending=s.claim(second);pending.catch(()=>{});await blocked(db,pid2,pid1);
   await first.query('commit');assert.equal(await pending,null);pending=null;await second.query('commit');
  }
 }
 for(const order of ['claim-first','completion-first']){
  const s=await jointScenario(db),queued=await rpc(db,'icash_defer_seller_agreement',s.args);assert(queued?.queued);
  await first.query('begin');await second.query('begin');
  if(order==='claim-first')assert.equal(await rpc(first,'icash_claim_agreement_delivery_recovery',{}),null,'a live original is not claimed');
  await s.complete(undefined,x=>x,second);
  assert.equal(await rpc(first,'icash_claim_agreement_delivery_recovery',{}),null,'uncommitted completion is not a complete original');
  assert.equal((await db.query('select state from icash_seller_agreement_private.delivery_recovery where id=$1',[queued.id])).rows[0].state,'queued');
  await second.query('commit');
  assert.equal(await rpc(first,'icash_claim_agreement_delivery_recovery',{}),null,'a transaction predating the source commit cannot hide its clock boundary');
  await first.query('commit');
  assert.equal((await rpc(first,'icash_claim_agreement_delivery_recovery',{}))?.id,queued.id,'fresh completed source admits the original once');
  assert.equal(await rpc(second,'icash_claim_agreement_delivery_recovery',{}),null,'the same original is not claimed twice');
 }
 {
  const busy=await jointScenario(db),other=await jointScenario(db);
  const busyJob=await rpc(db,'icash_defer_seller_agreement',busy.args),otherJob=await rpc(db,'icash_defer_seller_agreement',other.args);
  await busy.complete();await other.complete();
  await db.query("update icash_seller_agreement_private.delivery_recovery set created_at=clock_timestamp()-interval '2 hours' where id=$1",[busyJob.id]);
  await first.query('begin');await second.query('begin');
  assert.equal((await rpc(first,'icash_claim_agreement_delivery_recovery',{}))?.id,busyJob.id);
  assert.equal((await rpc(second,'icash_claim_agreement_delivery_recovery',{}))?.id,otherJob.id,'a locked original yields to another completed account');
  assert.equal(await rpc(third,'icash_claim_agreement_delivery_recovery',{}),null,'concurrent workers do not duplicate either claim');
  await first.query('commit');await second.query('commit');
 }
 const prepareRecovery=async()=>{
  const s=await jointScenario(db),queued=await rpc(db,'icash_defer_seller_agreement',s.args);assert(queued?.queued);await s.complete();
  const job=await rpc(db,'icash_claim_agreement_delivery_recovery',{});assert.equal(job?.id,queued.id);
  assert(await reviewSellerAgreementMemory(s.db,job));
  const envelope=await preparedOriginal(s);
  await db.query("update public.icash_screening_jobs set result='{\"financialCheck\":{\"status\":\"eligible\"}}'::jsonb,completed_at=clock_timestamp() where id=$1",[s.screen]);
  return {...s,recovery:queued.id,envelope:envelope.id,bind:client=>rpc(client,'icash_bind_agreement_delivery_envelope',{p_account:s.account,p_recovery:queued.id,p_envelope:envelope.id})};
 };
 // The recovery expiry must still be current after every later row-lock wait.
 // These holders change no source data: only elapsed time invalidates binding.
 for(const target of ['confirmation','envelope','screening']){
  const s=await prepareRecovery();await first.query('begin');
  if(target==='confirmation')await first.query('select id from icash_seller_agreement_private.confirmations where account_id=$1 and deal_id=$2 for update',[s.account,s.deal]);
  else if(target==='envelope')await first.query('select id from public.icash_signing_envelopes where id=$1 for update',[s.envelope]);
  else await first.query('select id from public.icash_screening_jobs where id=$1 for update',[s.screen]);
  const expires=(await db.query("update icash_seller_agreement_private.delivery_recovery set expires_at=clock_timestamp()+interval '1 second' where id=$1 returning expires_at",[s.recovery])).rows[0].expires_at;
  await second.query('begin;set local role service_role');pending=s.bind(second);pending.catch(()=>{});await blocked(db,pid2,pid1);
  for(const deadline=new Date(expires).getTime()+100;Date.now()<=deadline;)await new Promise(r=>setTimeout(r,20));
  await first.query('commit');assert.equal(await pending,false,target+' wait may not bind an expired recovery');pending=null;await second.query('commit');
  const binding=(await db.query('select c.state confirmation_state,c.envelope_id confirmation_envelope,r.state recovery_state,r.envelope_id recovery_envelope,clock_timestamp()>r.expires_at expired from icash_seller_agreement_private.confirmations c join icash_seller_agreement_private.delivery_recovery r on r.request_key=\'seller-confirmed:\'||c.id::text where r.id=$1',[s.recovery])).rows[0];
  assert.deepEqual(binding,{confirmation_state:'preparing',confirmation_envelope:null,recovery_state:'claimed',recovery_envelope:null,expired:true},'expiry refusal leaves both bindings untouched');
  assert.equal(Number((await db.query('select count(*) n from public.icash_signing_envelopes where account_id=$1',[s.account])).rows[0].n),1);
  assert.equal(Number((await db.query('select count(*) n from public.icash_text_messages where account_id=$1',[s.account])).rows[0].n),0);
 }
 {
  const s=await prepareRecovery();await first.query('begin');await first.query('select id from public.icash_screening_jobs where id=$1 for update',[s.screen]);
  await second.query('begin;set local role service_role');pending=s.bind(second);pending.catch(()=>{});await blocked(db,pid2,pid1);
  await third.query("update auth.users set email='changed-during-binding@example.test' where id=$1",[s.user]);
  await first.query('commit');assert.equal(await pending,false,'the current verified owner email must be rechecked after the last row-lock wait');pending=null;await second.query('commit');
  const binding=(await db.query('select c.state confirmation_state,c.envelope_id confirmation_envelope,r.state recovery_state,r.envelope_id recovery_envelope from icash_seller_agreement_private.confirmations c join icash_seller_agreement_private.delivery_recovery r on r.request_key=\'seller-confirmed:\'||c.id::text where r.id=$1',[s.recovery])).rows[0];
  assert.deepEqual(binding,{confirmation_state:'preparing',confirmation_envelope:null,recovery_state:'claimed',recovery_envelope:null});
  const message=await originalContractMessage(s,s.envelope);
  assert.equal(await rpc(db,'icash_claim_text_before_owner_question',{p_account:s.account,p_message:message,p_sender:'+14243948384'}),null,'the original for an earlier owner email gains no text authority');
 }
 for(const order of ['bind-first','source-first']){
  const s=await prepareRecovery();await first.query('begin');await second.query('begin');
  if(order==='bind-first'){
   assert.equal(await s.bind(first),true);pending=s.incoming(second,'Actually, I have another mortgage.');pending.catch(()=>{});await blocked(db,pid2,pid1);
   await first.query('commit');await pending;pending=null;await second.query('commit');
  }else{
   await s.incoming(first,'Actually, I have another mortgage.');pending=s.bind(second);pending.catch(()=>{});await blocked(db,pid2,pid1);
   await first.query('commit');assert.equal(await pending,false,'source arriving before binding blocks admission');pending=null;await second.query('commit');
  }
  const message=await originalContractMessage(s,s.envelope);
  assert.equal(await rpc(db,'icash_claim_text_before_owner_question',{p_account:s.account,p_message:message,p_sender:'+14243948384'}),null,'either source/binding order retains the later material hold');
  assert.equal(Number((await db.query('select count(*) n from public.icash_signing_envelopes where account_id=$1',[s.account])).rows[0].n),1);
 }
 for(const order of ['text-first','source-first']){
  const s=await prepareRecovery();assert.equal(await s.bind(db),true);const message=await originalContractMessage(s,s.envelope);
  const claim=client=>rpc(client,'icash_claim_text_before_owner_question',{p_account:s.account,p_message:message,p_sender:'+14243948384'});
  await first.query('begin');await second.query('begin');
  if(order==='text-first'){
   assert.equal((await claim(first))?.messageId,message);pending=s.incoming(second,'Actually, I have another mortgage.');pending.catch(()=>{});await blocked(db,pid2,pid1);
   await first.query('commit');await pending;pending=null;await second.query('commit');
  }else{
   await s.incoming(first,'Actually, I have another mortgage.');pending=claim(second);pending.catch(()=>{});await blocked(db,pid2,pid1);
   await first.query('commit');assert.equal(await pending,null);pending=null;await second.query('commit');
  }
  assert.equal(Number((await db.query('select count(*) n from fixture_text_admissions where message_id=$1',[message])).rows[0].n),order==='text-first'?1:0,'only an admission preceding the source writer may reach the financial sentinel');
  assert.equal(await claim(db),null,'fresh later admission remains held');
 }
 {
  const s=await prepareRecovery();await first.query('begin');await second.query('begin');
  assert.equal(await s.bind(first),true);pending=s.bind(second);pending.catch(()=>{});await blocked(db,pid2,pid1);
  await first.query('commit');assert.equal(await pending,true,'the exact same original binding is idempotent');pending=null;await second.query('commit');
  const bound=(await db.query('select c.envelope_id confirmation_envelope,r.envelope_id recovery_envelope from icash_seller_agreement_private.confirmations c join icash_seller_agreement_private.delivery_recovery r on r.request_key=\'seller-confirmed:\'||c.id::text where r.id=$1',[s.recovery])).rows[0];
  assert.deepEqual(bound,{confirmation_envelope:s.envelope,recovery_envelope:s.envelope});
  assert.equal(Number((await db.query('select count(*) n from public.icash_signing_envelopes where account_id=$1',[s.account])).rows[0].n),1,'competing bindings never create another document');
  assert.equal(Number((await db.query('select count(*) n from public.icash_contract_text_deliveries where account_id=$1',[s.account])).rows[0].n),0,'binding never queues or rearms a text');
 }
 console.log('PASS native actual receipt→atomic→raw migrations, TS direct/deferred consumers, final owned-link claim, same-phone races and unrelated progress; financial/provider sentinels only.');
}catch(error){console.error(error.stack,error.where??'');process.exitCode=1;}finally{
 for(const client of clients)await client.query('rollback').catch(()=>{});if(pending)await pending.catch(()=>{});await Promise.allSettled(clients.map(c=>c.end()));
}
