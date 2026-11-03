import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {recoverTextDeliveryReceipts} from '../lib/text-delivery-recovery.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create(),q=(sql,args=[])=>pg.query(sql,args),one=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const sender='+17205550100',recipient='+12145550101',account=id(1),rate=id(2),thread=id(3);
let current;
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
 const db=async(path,method,body)=>{
  assert.equal(method,'POST');
  if(path==='rpc/icash_claim_text_delivery_rechecks')return one('select icash_claim_text_delivery_rechecks()');
  if(path==='rpc/icash_finish_text_delivery_recheck'){
   if(mode==='missing_source')delete body.p_receipt.source;
   if(mode==='wrong_source')body.p_receipt.source='other_source';
   return one('select icash_finish_text_delivery_recheck($1,$2)',[body.p_id,body.p_receipt]);
  }
  throw Error(path);
 };
 let fetches=[],mode='delivered',race=null;
 const fetcher=async(url,options)=>{
  fetches.push(url);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.headers.Authorization,'Token fixture-key');
  if(url.endsWith('/numbers/leased'))return Response.json({object:'response',data:{numbers:[{number:{e164:mode==='other_org'?'+17205550999':sender},lease_status:'active'}]}});
  const m=(await q('select * from icash_text_messages where id=$1',[current])).rows[0];
  const o=(await q('select * from icash_operation_spend where operation_key=$1',['text:'+current])).rows[0];
  const stamp=new Date(Date.parse(o.dispatched_at)+10000).toISOString();
  const data={id:m.provider_id,from:sender,to:recipient,message:m.body,timestamp:Date.parse(o.dispatched_at),attachments:[],status:mode==='failed'?'failed':'delivered',tracking:[{event:mode==='failed'?'text.delivery.failed':'text.delivery.confirmed',timestamp:stamp}]};
  if(mode==='wrong_id')data.id='text_wrong';if(mode==='wrong_to')data.to='+12145550999';if(mode==='wrong_body')data.message='Changed';
  if(mode==='no_delivery_time')data.tracking=[];if(mode==='contradictory')data.tracking.push({event:'text.delivery.failed',timestamp:stamp});
  if(mode==='future')data.tracking[0].timestamp=new Date(Date.now()+3600000).toISOString();
  if(mode==='pending')data.status='pending';if(mode==='other_attachment')data.attachments=['https://example.test/other.jpg'];
  if(race)await race();
  return Response.json({object:'response',data});
 };
 const env={VERCEL_ENV:'production',CONTIGUITY_API_KEY:'fixture-key',CONTIGUITY_WEBHOOK_SECRET:'fixture-secret'};
 for(const [n,scenario,expected] of [[10,'delivered','delivered'],[11,'failed','needs_review'],[12,'wrong_id','accepted'],[13,'wrong_to','accepted'],[14,'wrong_body','accepted'],[15,'no_delivery_time','accepted'],[16,'contradictory','accepted'],[17,'future','accepted'],[18,'pending','accepted'],[19,'other_attachment','accepted'],[20,'other_org','accepted'],[24,'missing_source','accepted'],[25,'wrong_source','accepted']]){
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
  assert.equal(fetches.length,scenario==='other_org'?1:2);
  const attempt=(await q('select * from icash_text_receipt_private.attempts where message_id=$1',[current])).rows[0];
  assert(attempt.receipt);assert.equal(await one('select icash_finish_text_delivery_recheck($1,$2)',[attempt.id,{changed:true}]),attempt.outcome,'Repeating finish retains original evidence');
  assert.deepEqual(await one('select receipt from icash_text_receipt_private.attempts where id=$1',[attempt.id]),attempt.receipt);
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
 assert.equal(await one("select count(*) from icash_text_messages where direction='incoming'"),0,'No history or AI replay');
 for(const role of ['anon','authenticated'])for(const signature of ['icash_claim_text_delivery_rechecks()','icash_finish_text_delivery_recheck(uuid,jsonb)'])assert.equal(await one("select has_function_privilege($1,$2,'execute')",[role,signature]),false);
 assert.equal(await one('select paused from icash_text_threads where id=$1',[thread]),true,'Pause preserved and original receipt reads still work');
 console.log('PASS canonical text GET recovery: exact identities/receipt time, private raw evidence, contradictory/partial receipts, changed settlement and late callbacks remain held; no sends or financial changes.');
}finally{await pg.close();}
