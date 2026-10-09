// In-memory integration test only. No live owner contacts, signatures or providers.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(p,'utf8');
export async function testOwnerBuyerDelivery(f,{link,realBuyerThread,realBuyerEmail,emailRate,session}){
 const {pg,q,one,rpc,account,user,other,deal,sms,timezone}=f;
 await pg.exec(`alter table public.icash_text_threads add column if not exists seller_intake_id uuid;
 alter table public.icash_text_threads drop constraint icash_text_threads_sender_recipient_key;
 alter table public.icash_text_threads add column if not exists manual_only boolean not null default false;
 alter table public.icash_text_threads add column if not exists sender_pool_assigned boolean not null default false;
 alter table icash_recorded_reception_private.sessions add recording_authorized_at timestamptz,add configuration jsonb default '{}';
 create table public.icash_owner_voice_acceptance_config(account_id uuid,owner_user_id uuid,phone text);
 create unique index icash_text_threads_active_number on public.icash_text_threads(sender,recipient) where retired_at is null;`);
 await pg.exec(`do $$declare definition text;begin
 definition:=pg_get_functiondef('public.icash_ingest_text_event_before_operational(jsonb,boolean)'::regprocedure);
 execute replace(definition,'where sender=v->>','where retired_at is null and sender=v->>');
 end $$;`);
 const routing=read('config/sms-property-routing.sql');
 // Thread/message routing core; later provisioning rewrites need acquisition fixtures.
 await pg.exec(routing.slice(0,routing.indexOf('-- Change all current insert conflict targets'))+'commit;');
 const continuation=read('config/seller-text-continuation.sql');
 await pg.exec(continuation.slice(0,continuation.indexOf('create function public.icash_remember_sms_property'))+'commit;');
 await pg.exec(read('config/reception-contact-continuity.sql'));
 await pg.exec('alter function public.icash_recorded_reception_property_context(uuid,text) rename to icash_reception_context_before_agreement;');
 const factual=read('config/buyer-factual-text-replies.sql');
 await pg.exec(factual.slice(0,factual.indexOf('-- Seller acquisition mode'))+'commit;');
 await pg.exec(read('config/owner-buyer-delivery-test.sql'));
 await pg.exec(read('config/owner-buyer-test-routing.sql'));
 const ownerPhone='+12145550188',sender='+14245550188',run=randomUUID(),thread=randomUUID(),seller=randomUUID(),oldDeal=randomUUID(),oldScreen=randomUUID();
 await q('update auth.users set email_confirmed_at=now() where id=$1',[user]);
 await q('insert into icash_owner_voice_acceptance_config values($1,$2,$3)',[account,user,ownerPhone]);
 await q('insert into icash_text_senders(phone,enabled) values($1,true)',[sender]);
 await q("insert into icash_screening_jobs(id,account_id,event_key,state,snapshot) values($1,$2,'SIMULATION older owner test','complete','{\"propertyId\":\"old-fixture\"}')",[oldScreen,account]);
 await q("insert into icash_deal_files(id,account_id,screening_id,stage,terms) values($1,$2,$3,'draft','{\"address\":\"500 Other Street\"}')",[oldDeal,account,oldScreen]);
 await q("insert into icash_text_threads(id,account_id,deal_id,party,sender,recipient,timezone,sms_rate_id,paused) values($1,$2,$3,'seller',$4,$5,$6,$7,false)",[seller,account,oldDeal,sender,ownerPhone,timezone,sms]);
 await rpc('icash_set_buyer_outreach_hold',{p_account:account,p_deal:deal,p_actor:user,p_held:true,p_reason:'SIMULATION owner delivery test only'});
 await q('begin');
 await q("insert into icash_owner_buyer_tests(id,account_id,deal_id,owner_user_id,thread_id,sender,phone,email,sms_rate_id,email_rate_id,asking_price_cents,approval_reference,expires_at) values($1,$2,$3,$4,$5,$6,$7,'operational-sms@example.invalid',$8,$9,$10,'SIMULATION explicit self test',now()+interval '2 hours')",[run,account,deal,user,thread,sender,ownerPhone,sms,emailRate,link.askingPriceCents]);
 await q("insert into icash_text_threads(id,account_id,deal_id,party,sender,recipient,timezone,sms_rate_id,paused,ai_mode,sender_pool_assigned) values($1,$2,$3,'buyer',$4,$5,$6,$7,false,'auto',true)",[thread,account,deal,sender,ownerPhone,timezone,sms]);
 await q('commit');
 const current=()=>rpc('icash_owner_buyer_test_current',{p_id:run});
 const review=()=>rpc('icash_sms_thread_review_current',{p_account:account,p_thread:thread,p_check_hour:false});
 assert.equal(await current(),true);assert.equal(await review(),true);
 assert.equal((await one('select dnc_clear from icash_text_threads where id=$1',[thread])).dnc_clear,false,'test does not invent DNC evidence');
 const content=await rpc('icash_owner_buyer_test_content',{p_id:run});
 assert(content.sms.includes('$48,937.00'));assert(content.email.includes('$10,000.00'));assert(content.sms.length<=160);
 const message=await rpc('icash_queue_buyer_package_text',{p_account:account,p_thread:thread,p_body:content.sms});assert(message);
 assert.equal(await rpc('icash_queue_buyer_package_text',{p_account:account,p_thread:thread,p_body:content.sms}),message);
 const sendArgs={p_account:account,p_message:message,p_sender:sender};
 assert.equal(await rpc('icash_claim_text',{...sendArgs,p_account:other}),null);
 assert.equal(await rpc('icash_claim_text',{...sendArgs,p_sender:f.sender}),null);
 assert.equal(await rpc('icash_claim_customer_text',sendArgs),null,'manual buyer claim remains held');
 for(const change of [
  ["update auth.users set email='wrong@example.invalid' where id=$1",[user]],
  ['update icash_accounts set owner_user_id=$2 where id=$1',[account,f.newOwner]],
  ["update icash_owner_buyer_tests set created_at=now()-interval '3 hours',expires_at=now()-interval '1 hour' where id=$1",[run]],
  ["insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION STOP')",[ownerPhone]],
  ['update icash_owner_buyer_tests set asking_price_cents=asking_price_cents+1 where id=$1',[run]],
  ['update icash_owner_buyer_tests set revoked_at=now() where id=$1',[run]],
  ['update icash_text_threads set paused=true where id=$1',[thread]],
 ]){
  await q('begin');try{await q(...change);assert.equal(await review(),false);assert.equal(await rpc('icash_claim_text',sendArgs),null);}finally{await q('rollback');}
 }
 await q('begin');try{await q("update icash_text_messages set body='Different price' where id=$1",[message]);assert.equal(await rpc('icash_claim_text',sendArgs),null);}finally{await q('rollback');}
 assert.equal(await rpc('icash_queue_buyer_package_text',{p_account:account,p_thread:realBuyerThread,p_body:content.sms}),null);
 assert.equal(await rpc('icash_claim_deal_email',{p_account:account,p_id:realBuyerEmail}),null);
 assert.deepEqual(await rpc('icash_buyer_package_text_targets',{p_account:account,p_deal:deal}),[]);
 const key={p_account:account,p_actor:user,p_deal:deal,p_contact:'owner-buyer-test:'+run,p_key:run,p_subject:content.subject,p_body:content.email,p_rate:emailRate};
 const email=await rpc('icash_queue_deal_email',key);assert.equal(await rpc('icash_queue_deal_email',key),email);
 for(const subject of ['Buyer\rHeader: bad','Buyer\nHeader: bad'])await assert.rejects(rpc('icash_queue_deal_email',{...key,p_key:randomUUID(),p_subject:subject}),/Invalid email/);
 assert.equal((await rpc('icash_claim_deal_email',{p_account:account,p_id:email})).to,'operational-sms@example.invalid');
 assert.equal(await rpc('icash_claim_deal_email',{p_account:account,p_id:email}),null);
 assert.equal((await rpc('icash_claim_text',sendArgs)).to,ownerPhone);
 assert.equal(await rpc('icash_claim_text',sendArgs),null,'no duplicate paid transport');
 // No synthetic event enters production: local receipt unlocks only the local route.
 const focus=()=>one('select icash_recorded_reception_private.return_call_focus($1,$2,now()) id',[account,ownerPhone]);
 assert.equal((await focus()).id,null,'no buyer call context before real transport acceptance');
 await q("update icash_text_messages set state='accepted',provider_id='SIMULATED-owner-package' where id=$1",[message]);
 assert.equal((await focus()).id,thread);
 assert.equal(await rpc('icash_sms_resolve_property',{p_sender:sender,p_recipient:ownerPhone,p_body:"What's the price?"}),thread);
 await q('update icash_recorded_reception_private.sessions set from_phone=$2 where id=$1',[session,ownerPhone]);
 const call=await rpc('icash_reception_context_before_agreement',{p_id:session,p_nonce_hash:'fixture-nonce'});
 assert.equal(call.status,'buyer');assert.equal(call.askingPriceCents,link.askingPriceCents);assert.equal(call.returningName,'SIMULATION');assert(!('smsContext' in call));
 assert.equal(await rpc('icash_reception_context_before_agreement',{p_id:session,p_nonce_hash:'wrong'}),null);
 // A simulated provider receipt enters the real ingestion/routing path. Only
 // the analysis result is supplied locally; the reply and final claim are real SQL.
 const event={id:'SIMULATION-owner-reply',type:'text.incoming.sms',data:{from:ownerPhone,to:sender,body:"What's the price?",message_id:'SIMULATION-owner-incoming'}};
 await rpc('icash_ingest_text_event',{p_event:event,p_optout:false});
 const incoming=await one('select id,thread_id from icash_text_messages where event_id=$1',[event.id]);assert.equal(incoming.thread_id,thread);
 const job=await one('select id from icash_text_ai_jobs where message_id=$1',[incoming.id]);
 await q("update icash_text_ai_jobs set state='drafted',analysis='{\"action\":\"review\"}' where id=$1",[job.id]);
 const reply=await rpc('icash_queue_buyer_factual_reply',{p_account:account,p_job:job.id});assert(reply);
 const replyPayload=await rpc('icash_claim_text',{p_account:account,p_message:reply,p_sender:sender});
 assert.equal(replyPayload.to,ownerPhone);assert(replyPayload.message.includes('$48,937.00'));
 assert.equal(await rpc('icash_claim_text',{p_account:account,p_message:reply,p_sender:sender}),null);
 await q('begin');try{
  await q("update icash_owner_buyer_tests set created_at=now()-interval '3 hours',expires_at=now()-interval '1 hour' where id=$1",[run]);
  assert.equal((await focus()).id,null);assert.equal(await review(),false);
  assert.equal(await rpc('icash_sms_resolve_property',{p_sender:sender,p_recipient:ownerPhone,p_body:"What's the price?"}),null,'expired test reply is not attached to a seller');
 }finally{await q('rollback');}
 assert.equal((await one('select party from icash_text_threads where id=$1',[seller])).party,'seller');
 for(const role of ['anon','authenticated']){
  assert.equal((await one("select has_table_privilege($1,'icash_owner_buyer_tests','select') ok",[role])).ok,false);
  assert.equal((await one("select has_function_privilege($1,'icash_owner_buyer_test_current(uuid)','execute') ok",[role])).ok,false);
 }
 assert.equal(await rpc('icash_buyer_outreach_held',{p_account:account,p_deal:deal}),true);
 console.log('PASS owner buyer delivery: exact verified owner, signed price, real buyer hold, no fabricated DNC, one-time claims, header guard, STOP/expiry/tenant isolation, separate reply and inbound buyer context.');
}
