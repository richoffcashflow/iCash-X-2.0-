import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {recoverTextDeliveryReceipts} from '../lib/text-delivery-recovery.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create(),q=(sql,args=[])=>pg.query(sql,args),one=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const sender='+17205550100',recipient='+12145550101',account=id(1),rate=id(2),thread=id(3);
let current,persistenceFailure=null,finishWrites=0,finishBodies=[],finishSignals=[];
try{
 await pg.exec(read('tests/fixtures/text-delivery-recovery-base.sql'));
 const migration=read('config/text-delivery-recovery.sql');
 assert.equal(migration,read('supabase/migrations/20261103041331_text_delivery_recovery.sql'));
 await pg.exec(read('tests/fixtures/text-delivery-recovery-observers.sql'));
 const observers=JSON.parse(read('tests/fixtures/text-delivery-recovery-triggers.json'));
 for(const observer of observers)await pg.exec(observer.function_definition+';'+observer.definition+';');
 await pg.exec(migration);
 const sourceBinding=read('config/text-delivery-source-binding.sql');
 assert.equal(sourceBinding,read('supabase/migrations/20261103041609_text_delivery_source_binding.sql'));
 await pg.exec(sourceBinding);
 await pg.exec(read('tests/fixtures/text-delivery-recovery-callback.sql')+';');
 await q('insert into icash_text_senders values($1,false)',[sender]);
 await q('insert into icash_text_threads(id,account_id,sender,recipient,paused) values($1,$2,$3,$4,true)',[thread,account,sender,recipient]);
 await q("insert into icash_operation_rates values($1,'sms_send')",[rate]);
 await q('insert into icash_accounts values($1)',[account]);
 await q("insert into icash_deal_files values($1,$2,$3,'draft')",[id(4),account,id(5)]);
 await q('insert into icash_meta_leads values($1,$2,null)',[id(6),account]);
 await q('update icash_text_threads set deal_id=$1,seller_intake_id=$2 where id=$3',[id(4),id(6),thread]);
 const seed=async n=>{
  current=id(n);
  await pg.exec('alter table icash_text_messages disable trigger user');
  await q("insert into icash_text_messages(id,thread_id,account_id,direction,body,state,provider_id,created_at) values($1,$2,$3,'outgoing','Original fixture?','accepted',$4,now()-interval '1 hour')",[current,thread,account,'text_fixture_'+n]);
  await q("insert into icash_operation_spend values($1,$2,$3,'settled',now()-interval '1 hour',now()-interval '59 minutes',2)",['text:'+current,account,rate]);
  await pg.exec('alter table icash_text_messages enable trigger user');
  await q("insert into icash_seller_opener_assignments(thread_id,account_id,body,message_id) values($1,$2,'Original fixture?',$3)",[thread,account,current]);
  await pg.exec('update icash_text_receipt_private.control set next_run_at=now()');
 };
 const db=async(path,method,body,signal)=>{
  assert.equal(method,'POST');
  if(path==='rpc/icash_claim_text_delivery_rechecks')return one('select icash_claim_text_delivery_rechecks()');
  if(path==='rpc/icash_finish_text_delivery_recheck'){
   finishWrites++;finishBodies.push(structuredClone(body));finishSignals.push(signal);
   if(persistenceFailure==='persistent_failure'||(persistenceFailure==='precommit_failure'&&finishWrites===1))throw Error('Fixture original receipt write unavailable');
   if(persistenceFailure==='callback_between_attempts'&&finishWrites===1){
    await one('select icash_ingest_text_event_before_operational($1,false)',[{id:'evt_callback_before_retry',type:'text.delivery.confirmed',timestamp:Date.now()/1000,data:{message_id:body.p_receipt.message.raw.data.id,from:sender,to:recipient}}]);
    throw Error('Fixture failed receipt save while callback arrives');
   }
   if(mode==='missing_source')delete body.p_receipt.source;
   if(mode==='wrong_source')body.p_receipt.source='other_source';
   if(mode==='missing_tracking_query')body.p_receipt.message.url=body.p_receipt.message.url.replace('?tracking=true','');
   if(mode==='false_tracking_query')body.p_receipt.message.url=body.p_receipt.message.url.replace('?tracking=true','?tracking=false');
   const outcome=await one('select icash_finish_text_delivery_recheck($1,$2)',[body.p_id,body.p_receipt]);
   if(persistenceFailure==='lost_commit_ack'&&finishWrites===1)throw Error('Fixture commit succeeded; response lost');
   if(persistenceFailure==='malformed_ack'&&finishWrites===1||persistenceFailure==='persistent_malformed_ack')return null;
   return outcome;
  }
  throw Error(path);
 };
 let fetches=[],mode='delivered',race=null;
 const fetcher=async(url,options)=>{
  fetches.push(url);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.headers.Authorization,'Token fixture-key');
  if(url.endsWith('/numbers/leased')){
   if(mode==='lease_unreachable')throw Error('fixture lease unavailable');
   if(mode==='lease_forbidden')return Response.json({error:'forbidden'},{status:403});
   if(mode==='lease_malformed')return new Response('not json');
   return Response.json({object:'response',data:{numbers:[{number:{e164:mode==='other_org'?'+17205550999':sender},lease_status:'active'}]}});
  }
  const m=(await q('select * from icash_text_messages where id=$1',[current])).rows[0];
  const o=(await q('select * from icash_operation_spend where operation_key=$1',['text:'+current])).rows[0];
  const stamp=new Date(Date.parse(o.dispatched_at)+10000).toISOString();
  const data={id:m.provider_id,from:sender,to:recipient,message:m.body,timestamp:Date.parse(o.dispatched_at),attachments:[],status:mode==='failed'?'failed':'delivered',tracking:[{event:mode==='failed'?'text.delivery.failed':'text.delivery.confirmed',timestamp:stamp}]};
  if(mode.startsWith('carrier_wait')){data.tracking=[{event:'carrier.handed_off',timestamp:stamp},{event:'delivery.awaiting_confirmation',timestamp:stamp}];if(mode==='carrier_wait_wrong')data.to='+12145550999';}
  if(mode==='wrong_id')data.id='text_wrong';if(mode==='wrong_to')data.to='+12145550999';if(mode==='wrong_body')data.message='Changed';
  if(mode==='no_delivery_time')data.tracking=[];if(mode==='contradictory')data.tracking.push({event:'text.delivery.failed',timestamp:stamp});
  if(mode==='future')data.tracking[0].timestamp=new Date(Date.now()+3600000).toISOString();
  if(mode==='pending')data.status='pending';if(mode==='other_attachment')data.attachments=['https://example.test/other.jpg'];
  // The provider omits tracking by default even when its status is delivered.
  if(new URL(url).searchParams.get('tracking')!=='true'||mode==='omitted_tracking')delete data.tracking;
  if(race)await race();
  return Response.json({object:'response',data});
 };
 const env={VERCEL_ENV:'production',CONTIGUITY_API_KEY:'fixture-key',CONTIGUITY_WEBHOOK_SECRET:'fixture-secret'};
 // Reproduce the first live response before the URL fix: valid delivered status,
 // no timeline because the legacy exact-ID GET omitted the opt-in query.
 await seed(9);
 const legacyClaim=(await one('select icash_claim_text_delivery_rechecks()'))[0];
 const originalUrl='https://api.contiguity.com/conversations/history/message/'+legacyClaim.request.provider_id;
 const observe=async url=>{const response=await fetcher(url,{method:'GET',redirect:'error',credentials:'omit',headers:{Authorization:'Token fixture-key'}});const rawText=await response.text();return {url,status:response.status,rawText,raw:JSON.parse(rawText),checkedAt:new Date().toISOString()};};
 const legacyReceipt={source:'contiguity_canonical_get',lease:await observe('https://api.contiguity.com/numbers/leased'),message:await observe(originalUrl)};
 assert.equal(legacyReceipt.message.raw.data.status,'delivered');
 assert.equal(Object.hasOwn(legacyReceipt.message.raw.data,'tracking'),false,'Real provider default omits the timeline');
 assert.equal(await one('select icash_finish_text_delivery_recheck($1,$2)',[legacyClaim.id,legacyReceipt]),'held');
 assert.equal(await one('select state from icash_text_messages where id=$1',[current]),'accepted');
 const existingEvidence=await one('select to_jsonb(a) from icash_text_receipt_private.attempts a where id=$1',[legacyClaim.id]);
 const existingSchedule=await one('select to_jsonb(s) from icash_text_receipt_private.schedule s where message_id=$1',[current]);
 const existingControl=await one('select to_jsonb(c) from icash_text_receipt_private.control c');
 const trackingMigration=read('config/text-delivery-tracking.sql');
 assert.equal(trackingMigration,read('supabase/migrations/20261103050331_text_delivery_tracking.sql'));
 await pg.exec(trackingMigration);
 const carrierBackoff=read('config/carrier-confirmation-backoff.sql');assert.equal(carrierBackoff,read('supabase/migrations/20261118195000_carrier_confirmation_backoff.sql'));await pg.exec(carrierBackoff);
 assert.deepEqual(await one('select to_jsonb(a) from icash_text_receipt_private.attempts a where id=$1',[legacyClaim.id]),existingEvidence,'The URL fix preserves original held evidence');
 assert.deepEqual(await one('select to_jsonb(s) from icash_text_receipt_private.schedule s where message_id=$1',[current]),existingSchedule,'The URL fix never resets backoff or attempt counts');
 assert.deepEqual(await one('select to_jsonb(c) from icash_text_receipt_private.control c'),existingControl,'The global read quota is unchanged');
 assert.equal(await one('select icash_finish_text_delivery_recheck($1,$2)',[legacyClaim.id,{source:'changed'}]),'held','Old attempts remain immutable');

 for(const [n,scenario,expected] of [[10,'delivered','delivered'],[11,'failed','needs_review'],[12,'wrong_id','accepted'],[13,'wrong_to','accepted'],[14,'wrong_body','accepted'],[15,'no_delivery_time','accepted'],[16,'contradictory','accepted'],[17,'future','accepted'],[18,'pending','accepted'],[19,'other_attachment','accepted'],[20,'other_org','accepted'],[24,'missing_source','accepted'],[25,'wrong_source','accepted'],[26,'missing_tracking_query','accepted'],[27,'false_tracking_query','accepted'],[28,'omitted_tracking','accepted']]){
  await seed(n);mode=scenario;fetches=[];
  const before=await one('select to_jsonb(o) from icash_operation_spend o where operation_key=$1',['text:'+current]);
  const result=await recoverTextDeliveryReceipts(db,env,fetcher);
  assert.equal(result.checked,1,scenario);assert.equal(result.errors,0,scenario);
  assert.equal(await one('select state from icash_text_messages where id=$1',[current]),expected,scenario);
  if(scenario==='missing_source'||scenario==='wrong_source'){
   assert.equal(result.held,1,scenario);
   assert.equal(await one('select count(*) from fixture_opened_gaps'),0,scenario+' cannot create historical follow-up');
   assert.equal(await one('select first_outreach_at from icash_meta_leads'),null,scenario+' cannot retime Meta follow-up');
   assert.equal(await one('select last_delivery_at from icash_text_messages where id=$1',[current]),null,scenario+' cannot mutate delivery time');
  }
  assert.deepEqual(await one('select to_jsonb(o) from icash_operation_spend o where operation_key=$1',['text:'+current]),before,'Financial history stays unchanged');
  assert.equal(fetches.length,2,'A missing current lease cannot prevent collection of the original message receipt');
  assert.equal(new URL(fetches[1]).search,'?tracking=true','Collector requests the exact original timeline explicitly');
  const attempt=(await q('select * from icash_text_receipt_private.attempts where message_id=$1',[current])).rows[0];
  assert(attempt.receipt);assert.equal(await one('select icash_finish_text_delivery_recheck($1,$2)',[attempt.id,{changed:true}]),attempt.outcome,'Repeating finish retains original evidence');
  assert.deepEqual(await one('select receipt from icash_text_receipt_private.attempts where id=$1',[attempt.id]),attempt.receipt);
  if(scenario==='other_org'){
   assert.equal(attempt.receipt.message.raw.data.id,'text_fixture_'+n);
   assert.equal(attempt.receipt.reason,'leased_identity_unverified');
   assert.equal(result.held,1,'Saving exact provider evidence is not permission to bypass the lease verification gate');
  }
 }
 for(const [n,scenario,expectBackoff] of [[35,'carrier_wait',true],[36,'carrier_wait_wrong',false]]){
  await seed(n);mode=scenario;fetches=[];
  await q("insert into icash_text_receipt_private.schedule(message_id,next_check_at,attempts) values($1,now()-interval '2 hours',1)",[current]);
  assert.equal((await recoverTextDeliveryReceipts(db,env,fetcher)).held,1);
  assert.equal(await one("select next_check_at>now()+interval '3 hours' from icash_text_receipt_private.schedule where message_id=$1",[current]),expectBackoff);
  assert.equal(await one("select state from icash_text_messages where id=$1",[current]),'accepted');
  assert.equal(await one("select attempts from icash_text_receipt_private.schedule where message_id=$1",[current]),2);
 }
 for(const [n,scenario] of [[50,'lease_unreachable'],[51,'lease_forbidden'],[52,'lease_malformed']]){
  await seed(n);mode=scenario;fetches=[];
  const before=await one('select to_jsonb(o) from icash_operation_spend o where operation_key=$1',['text:'+current]);
  const result=await recoverTextDeliveryReceipts(db,env,fetcher);
  assert.equal(result.checked,1);assert.equal(result.held,1);assert.equal(result.errors,0);
  assert.equal(fetches.length,2,'Lease lookup failure must not suppress the bounded exact-ID GET');
  const saved=await one('select receipt from icash_text_receipt_private.attempts where message_id=$1',[current]);
  assert.equal(saved.reason,'leased_identity_unverified');
  assert.equal(saved.message.raw.data.id,'text_fixture_'+n);
  assert.equal(saved.message.raw.data.tracking[0].event,'text.delivery.confirmed');
  assert.equal(await one('select state from icash_text_messages where id=$1',[current]),'accepted','Unverified identity remains held despite matching terminal evidence');
  assert.equal(await one('select last_delivery_at from icash_text_messages where id=$1',[current]),null);
  assert.deepEqual(await one('select to_jsonb(o) from icash_operation_spend o where operation_key=$1',['text:'+current]),before);
  assert.equal(await one('select attempts from icash_text_receipt_private.schedule where message_id=$1',[current]),1,'No retry-counter reset');
  assert.equal(await one('select count(*) from fixture_opened_gaps'),0,'Receipt collection cannot create historical follow-up');
 }
 // Resume only the exact original database acknowledgment. Real SQL and its
 // observers must journal once even when the response disappears after commit.
 for(const [index,scenario] of ['lost_commit_ack','precommit_failure','malformed_ack','persistent_malformed_ack','persistent_failure','callback_between_attempts'].entries()){
  await pg.exec('begin');
  try{
   await seed(70+index);mode='delivered';fetches=[];finishWrites=0;finishBodies=[];finishSignals=[];persistenceFailure=scenario;
   const before=await one('select to_jsonb(o) from icash_operation_spend o where operation_key=$1',['text:'+current]);
   const result=await recoverTextDeliveryReceipts(db,env,fetcher);
   assert.equal(fetches.length,2,scenario+' must not repeat provider reads, sends or cancellations');
   assert.equal(finishWrites,2,scenario+' has one bounded original acknowledgment retry');
   assert.deepEqual(finishBodies[0],finishBodies[1],scenario+' retries the exact original attempt and evidence');
   assert.equal(finishSignals[0],finishSignals[1],scenario+' shares one database deadline');
   const attempts=(await q('select * from icash_text_receipt_private.attempts where message_id=$1',[current])).rows;
   assert.equal(attempts.length,1,scenario+' never creates a replacement attempt');
   assert.equal(await one('select attempts from icash_text_receipt_private.schedule where message_id=$1',[current]),1,'Original retry counter is unchanged');
   assert.deepEqual(await one('select to_jsonb(o) from icash_operation_spend o where operation_key=$1',['text:'+current]),before,'A repeated acknowledgment never changes financial history');
   assert.equal(await one('select sender from icash_text_threads where id=$1',[thread]),sender);
   const failed=scenario.startsWith('persistent_'),callback=scenario==='callback_between_attempts';
   assert.equal(result.errors,failed?1:0);assert.equal(result.delivered,!failed&&!callback?1:0);
   assert.equal(result.changed,callback?1:0);
   assert.equal(result.status,failed?'receipt_write_unavailable':'checked','Unconfirmed acknowledgment remains visible');
   assert.equal(await one('select state from icash_text_messages where id=$1',[current]),scenario==='persistent_failure'?'accepted':'delivered');
   if(scenario==='persistent_failure')assert.equal(attempts[0].finished_at,null,'Both failed writes retain an unfinished journal');
   else{
    assert.equal(attempts[0].outcome,callback?'changed':'delivered');
    assert.deepEqual(attempts[0].receipt,finishBodies[0].p_receipt,'Saved original provider evidence is immutable');
   }
   if(!callback){
    assert.equal(await one('select count(*) from fixture_opened_gaps'),0,'A lost acknowledgment cannot create historical outreach');
    assert.equal(await one('select first_outreach_at from icash_meta_leads'),null);
   }
  }finally{persistenceFailure=null;await pg.exec('rollback');}
 }
 await seed(21);mode='delivered';race=async()=>q("update icash_text_messages set state='needs_review',last_delivery_at=now() where id=$1",[current]);
 assert.equal((await recoverTextDeliveryReceipts(db,env,fetcher)).changed,1,'Late callback wins without being overwritten');
 assert.equal(await one('select state from icash_text_messages where id=$1',[current]),'needs_review');race=null;
 await seed(22);mode='delivered';race=async()=>q('update icash_operation_spend set charged_cents=3 where operation_key=$1',['text:'+current]);
 assert.equal((await recoverTextDeliveryReceipts(db,env,fetcher)).changed,1,'Changed original settlement blocks apply');race=null;
 await seed(23);mode='delivered';
 const claims=await one('select icash_claim_text_delivery_rechecks()');assert.equal(claims.length,1);
 assert.deepEqual(await one('select icash_claim_text_delivery_rechecks()'),[],'Global quota prevents another concurrent batch');
 for(const n of [30,31,32,33])await seed(n);
 assert.equal((await one('select icash_claim_text_delivery_rechecks()')).length,3,'Bounded three claims');
 assert.equal(await one('select count(*) from icash_text_events'),0,'Canonical GET is never forged into a webhook');
 assert.equal(await one('select count(*) from fixture_opened_gaps'),1,'Only the real intervening failed callback opens its existing review, never canonical recovery');
 assert.equal(await one('select first_outreach_at from icash_meta_leads'),null,'Historical receipts cannot start a fresh Meta follow-up window');
 assert(await one('select count(*) from icash_learning_queue')>0,'Real learning observations stay active');
 assert(await one('select count(*) from icash_seller_opener_assignments where delivered_at is not null')>0,'Delivery observation remains active');
 const recovered=(await q('select * from icash_text_messages where id=$1',[id(10)])).rows[0];
 await one('select icash_ingest_text_event_before_operational($1,false)',[{id:'evt_later_duplicate',type:'text.delivery.confirmed',timestamp:Date.now()/1000,data:{message_id:recovered.provider_id,from:sender,to:recipient}}]);
 assert.equal(await one('select count(*) from fixture_opened_gaps'),1,'A later real delivered callback still cannot wake a recovered historical question');
 assert.equal(await one('select first_outreach_at from icash_meta_leads'),null);
 // An ordinary new delivery still follows the original trigger behavior.
 await seed(40);
 await q("update icash_text_messages set state='delivered',last_delivery_at=now() where id=$1",[current]);
 assert.equal(await one('select count(*) from fixture_opened_gaps'),2,'Unrecovered new messages keep normal follow-up behavior');
 assert.notEqual(await one('select first_outreach_at from icash_meta_leads'),null);
 await seed(41);
 const beforeDelay=(await q('select * from icash_text_messages where id=$1',[current])).rows[0];
 const delay={id:'evt_fixture_temporary_unavailable',type:'numbers.delayed',timestamp:Date.now()/1000,
  data:{original_number:sender,affected_id:beforeDelay.provider_id,reason:'number_temporary_unavailable'}};
 for(let retry=0;retry<2;retry++)await one('select icash_ingest_text_event_before_operational($1,false)',[delay]);
 assert.equal(await one('select count(*) from icash_text_events where id=$1',[delay.id]),1);
 assert.deepEqual((await q('select * from icash_text_messages where id=$1',[current])).rows[0],beforeDelay);
 assert.equal(await one('select count(*) from fixture_opened_gaps'),2,'Delay does not start a follow-up');
 assert.equal(await one("select count(*) from icash_text_messages where direction='incoming'"),0,'No history or AI replay');
 for(const role of ['anon','authenticated'])for(const signature of ['icash_claim_text_delivery_rechecks()','icash_finish_text_delivery_recheck(uuid,jsonb)'])assert.equal(await one("select has_function_privilege($1,$2,'execute')",[role,signature]),false);
 assert.equal(await one('select paused from icash_text_threads where id=$1',[thread]),true,'Pause preserved and original receipt reads still work');
 console.log('PASS canonical text GET recovery: exact identities/receipt time, private raw evidence, contradictory/partial receipts, changed settlement and late callbacks remain held; no sends or financial changes.');
}finally{await pg.close();}
