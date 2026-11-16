import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {readSellerMemory,chronologicalSellerHistory} from '../../lib/seller-memory.ts';
import {sellerDialogueState,boundSellerQualification} from '../../lib/seller-offer-qualification.ts';
import {planSellerTextOffer} from '../../lib/seller-text-offer.ts';
import {processSellerTextOffer} from '../../lib/seller-text-offer-service.ts';
import {qualifiedSellerTurns} from './seller-qualification-fixture.mjs';
import {api,fixture,migration,oldHash} from './seller-memory-receipt-fixture.mjs';
const predecessor=readFileSync(new URL('../fixtures/seller-memory-before-receipts.ts.txt',import.meta.url),'utf8');
assert.equal(createHash('sha256').update(predecessor).digest('hex'),'20ece3865a27ba27b889229fe1c2ce55ee880187fd203ccb28a0e017465b5563','exact pre-migration application fixture');
export const oldConsumer=(await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(predecessor.replaceAll("from './","from '"+new URL('../../lib/',import.meta.url).href))).toString('base64'))).readSellerMemory;
const memory=async f=>{
 const raw=await f.context();if(raw){const rows=raw.conversations.find(c=>c.channel==='sms').transcript;
  for(let i=0;i<rows.length;i++)if(rows[i].role==='user'){assert.equal(rows[i-1]?.role,'agent');assert.equal(rows[i-1]?.threadId,rows[i].threadId);assert.equal(rows[i-1]?.at,rows[i].at);if(rows[i].questionUnverified)assert.equal(rows[i-1].message,'');}
 }
 return readSellerMemory(f.db,f.binding);
};
async function call(f,at,transcript=qualifiedSellerTurns){await f.query("insert into icash_live_conversations(id,account_id,screening_id,contact_key,party,state,operation_key,completed_at,result) values($1,$2,$3,encode(sha256(convert_to($4,'UTF8')),'hex'),'seller','complete',$5,$6,$7)",[randomUUID(),f.account,f.screen,f.phone,'voice:'+randomUUID(),f.at(at),{transcript}]);}
export async function baseline(pg){
 assert.equal(await api(pg).hash(),oldHash);
 const originalDefinition=(await api(pg).query("select pg_get_functiondef('public.icash_seller_memory_context(uuid,uuid,text)'::regprocedure) definition")).rows[0].definition;
 const f=await fixture(pg);await f.turn('outgoing','Are you the owner?',0,{delivery:10});await f.turn('incoming','Yes.',20,{eventTime:1});
 assert.equal((await oldConsumer(f.db,f.binding)).state.facts.ownership.value,true,'reproduce delivered-after-original-reply false ownership');
 await pg.exec('begin');await pg.exec(migration);await pg.exec('commit');
 assert.equal(await api(pg).hash(),'7a680dae86359988c3f70c705a3369b0');
 const newDefinition=(await api(pg).query("select pg_get_functiondef('public.icash_seller_memory_context(uuid,uuid,text)'::regprocedure) definition")).rows[0].definition;
 const callBlock=d=>d.slice(d.indexOf(' select coalesce(jsonb_agg(c.body'),d.indexOf(' conversations:='));
 const liveBlock=d=>d.slice(d.indexOf(" select coalesce(jsonb_agg(x),'[]')"),d.indexOf(' return jsonb_build_object'));
 assert.equal(callBlock(newDefinition),callBlock(originalDefinition));assert.equal(liveBlock(newDefinition),liveBlock(originalDefinition));
 assert.equal((await memory(f)).state.facts.ownership,undefined);
 assert.equal((await oldConsumer(f.db,f.binding)).complete,false,'actual original application fails closed after SQL change');
}
export async function cases(pg){
 // Strict receipt proof, original event provenance, and untouched statements.
 for(const options of [{delivery:5},{delivery:null},{delivery:-1},{delivery:1},{delivery:1.0001},{provider:null},{state:'accepted'},{state:'failed'}]){
  const f=await fixture(pg);await f.turn('outgoing','Are you the owner?',0,options);const u=await f.turn('incoming','Yes.',20,{eventTime:1});
  const m=await memory(f);assert.equal(m.state.facts.ownership,undefined,JSON.stringify(options));
  const exchange=m.history.find(h=>h.sourceId===u.id);assert.equal(exchange.transcript[0].message,'');assert.equal(exchange.transcript[1].message,'Yes.');assert.equal(exchange.transcript[1].questionUnverified,true);
 }
 for(const options of [{eventTime:null},{eventTime:'1577836801'},{eventTime:-1577836801},{eventTime:1e15},{eventType:'message.sent'},{eventExists:false},{eventId:null},{eventTime:400}]){
  const f=await fixture(pg);await f.turn('outgoing','Are you the owner?',0);await f.turn('incoming','I am the owner.',1,options);
  const m=await memory(f);assert.equal(m.complete,false,JSON.stringify(options));assert.equal(m.state.qualification.stop,true);assert.equal(m.state.facts.ownership.quote,'I am the owner.','untrusted clock cannot erase a saved statement');
 }
 for(const eventType of ['text.incoming.sms','text.incoming.mms']){
  const f=await fixture(pg);await f.turn('outgoing','Are you the owner?',0);const u=await f.turn('incoming','Yes.',20,{eventTime:1,eventType,provider:null});
  const m=await memory(f);assert.equal(m.state.facts.ownership.value,true);assert.equal(m.state.facts.ownership.sourceId,u.id);assert.equal(m.state.facts.ownership.at,f.at(1));assert(m.complete);
 }
 // Never skip an unconfirmed newer question to reuse an older delivered one.
 for(const state of ['ready','dispatching','accepted','failed','cancelled']){
  const f=await fixture(pg);await f.turn('outgoing','Are you the owner?',0);await f.turn('incoming','Yes.',1);
  await f.turn('outgoing','Is the property occupied?',2,{state,delivery:null});const u=await f.turn('incoming','No.',3);
  const m=await memory(f),h=m.history.find(x=>x.sourceId===u.id);assert.equal(h.transcript[0].message,'');assert.equal(m.state.facts.ownership,undefined,state+' cannot leave prior positive ownership authorized');
  await call(f,30);assert.equal((await memory(f)).state.qualification.ready,true,'later verified call resolves old ambiguous relation');
  assert.equal((await boundSellerQualification(f.db,f.binding,{transcript:[{role:'user',message:'I am calling back.'}]})).ready,true,'actual bound service recovers');
 }
 // A delayed webhook cannot turn a question sent after the answer into context.
 {const f=await fixture(pg);await f.turn('outgoing','Are you the owner?',10);await f.turn('incoming','Yes.',20,{eventTime:1});assert.equal((await memory(f)).state.facts.ownership,undefined);}
 // A separate active seller thread cannot lend its pending question.
 {const f=await fixture(pg),other=randomUUID();await f.query("insert into icash_text_threads values($1,$2,$3,$4,'seller',null)",[other,f.account,f.deal,f.phone]);await f.turn('outgoing','Are you the owner?',0,{which:other});await f.turn('incoming','Yes.',1);assert.equal((await memory(f)).state.facts.ownership,undefined);}
 // Different same-time questions, reordered delivery, and incoming ties are ambiguous.
 {const f=await fixture(pg);await f.turn('outgoing','Are you the owner?',0);await f.turn('outgoing','Is it occupied?',0);await f.turn('incoming','Yes.',1);assert.equal((await memory(f)).state.facts.ownership,undefined);}
 {const f=await fixture(pg);await f.turn('outgoing','Are you the owner?',0,{delivery:3});await f.turn('outgoing','Is it occupied?',1,{delivery:2});await f.turn('incoming','Yes.',4);assert.equal((await memory(f)).state.facts.occupancy,undefined);}
 {const f=await fixture(pg);await f.turn('outgoing','Are you the owner?',0);await f.turn('incoming','Yes.',1);await f.turn('incoming','No.',2,{eventTime:1.0001});assert.equal((await memory(f)).complete,false);}
 // Standalone facts survive, explicit refusals remain, unknown yes cannot override them.
 for(const message of ['Thank you.','The property is vacant.','I am the owner.']){const f=await fixture(pg);await call(f,0);await f.turn('incoming',message,1);assert.equal((await memory(f)).state.qualification.ready,true,'standalone/neutral reply must retain unrelated verified facts: '+message);} 
 {const f=await fixture(pg);await f.turn('incoming','I am the owner. I want to sell.',1);let m=await memory(f);assert(m.complete);assert.equal(m.state.facts.ownership.value,true);assert.equal(m.state.facts.interest.value,true);assert.equal((await oldConsumer(f.db,f.binding)).complete,false);}
 {const f=await fixture(pg);await call(f,0,[{role:'user',message:'I am not the owner. I do not want to sell.'}]);await f.turn('incoming','Yes.',1);const m=await memory(f);assert.equal(m.state.facts.ownership.value,false);assert.equal(m.state.facts.interest.value,false);assert.equal(m.state.qualification.stop,true);}
 {const f=await fixture(pg);await call(f,0);await f.turn('incoming','No.',1);const m=await memory(f);assert(!m.state.qualification.ready);assert.equal(m.state.facts.listing,undefined,'unknown no must invalidate prior not-listed authority');await call(f,2);assert((await memory(f)).state.qualification.ready);}
 // A valid current answer with unknown question timing needs clarification,
 // not permanent manual review or price acceptance. Use actual projected rows.
 {const f=await fixture(pg);await call(f,0);const q=await f.turn('outgoing','Are you the owner?',1,{delivery:4});const u=await f.turn('incoming','No.',5,{eventTime:2});
  const m=await memory(f);assert.equal(m.state.qualification.clarificationRequired,true);
  const messages=[{id:q.id,direction:'outgoing',body:'Are you the owner?',state:'delivered',providerId:'fixture',at:f.at(1),action:'cash_offer'},
   {id:u.id,direction:'incoming',body:'No.',state:'received',providerId:'fixture',at:f.at(2)}];
  const context={...f.binding,jobId:randomUUID(),threadId:f.thread,sourceId:u.id,ownerUserId:randomUUID(),ownerEmail:'owner@example.invalid',principal:'Fixture Buyer',address:'45 Oak Road',snapshot:{},terms:{},offerState:{acceptedPriceCents:6000000},offerVersion:1,messages,fingerprint:'fixture',memoryFingerprint:m.fingerprint,historyComplete:true,history:m.history};
  const plan=planSellerTextOffer(context);assert.equal(plan.kind,'message');assert.equal(plan.action,'clarify_source_answer','uncertain no must not become a cash-offer counterprice');assert.equal(plan.body,m.state.qualification.nextQuestion);assert.equal(plan.state.acceptedPriceCents,6000000,'preserve original accepted evidence while withholding authority');assert.equal(plan.terms,undefined);
  let dispatched=0,saved=0;const db=async(path,method,args)=>{
   if(path==='rpc/icash_save_seller_text_offer'){saved++;assert.equal(args.p_plan.action,'clarify_source_answer');assert.equal(args.p_fingerprint,'fixture');return {messageId:'original-clarification'};}
   return f.db(path,method,args);
  };
  const forbidden=async()=>{throw Error('No signing or agreement delivery during clarification');};
  const result=await processSellerTextOffer(context,{db,dispatch:async(account,id)=>{assert.equal(account,f.account);assert.equal(id,'original-clarification');dispatched++;return {status:'message_delivered'};},send:forbidden,text:forbidden});
  assert.equal(result.status,'message_delivered');assert.equal(saved,1);assert.equal(dispatched,1);
  const asked=[1,2].map(n=>({id:'asked-'+n,direction:'outgoing',state:'delivered',providerId:'original-'+n,body:plan.body,action:plan.action}));
  assert.equal(planSellerTextOffer({...context,messages:[...asked,...messages]}).reason,'seller_answer_unclear','normal bounded repeat limit remains');
  assert.equal(planSellerTextOffer({...context,messages:[{...messages[0],state:'dispatching',providerId:null},messages[1]]}).reason,'offer_receipt_unresolved','unknown original send is never bypassed to clarify');
  for(const reply of ['Stop texting me.','I do not want to sell.'])assert.equal(planSellerTextOffer({...context,messages:[messages[0],{...messages[1],body:reply}]}).kind,'review','explicit current refusal wins');
  await call(f,6,[...qualifiedSellerTurns,{role:'user',message:'The property is listed with an agent.'}]);const listed=await memory(f);assert.equal(listed.state.qualification.clarificationRequired,undefined);assert.equal(planSellerTextOffer({...context,history:listed.history}).reason,'seller_qualification_stopped');
 }
 {const f=await fixture(pg);await call(f,0,[...qualifiedSellerTurns,{role:'user',message:'The property is listed with a real estate agent.'}]);await f.turn('incoming','No.',1);assert.equal((await memory(f)).state.qualification.stop,true,'ambiguous negative cannot remove listed restriction');}
 // Every relevant original source mutation changes fingerprint and rejects old cache.
 {const f=await fixture(pg);const q=await f.turn('outgoing','Are you the owner?',0);const u=await f.turn('incoming','Yes.',1);const m=await memory(f);const original=await f.context();const cached=JSON.stringify(original.cached);
  for(const [sql,args] of [
   ['update icash_text_messages set last_delivery_at=$2 where id=$1',[q.id,f.at(.2)]],
   ["update icash_text_messages set body='Are you the property owner?' where id=$1",[q.id]],
   ["update icash_text_messages set provider_id='changed-provider' where id=$1",[q.id]],
   ["update icash_text_messages set state='accepted' where id=$1",[q.id]],
   ["update icash_text_messages set created_at=$2 where id=$1",[q.id,f.at(.01)]],
   ["update icash_text_events set payload=jsonb_build_object('timestamp',1577836801.001) where id=$1",[u.eventId]],
   ["update icash_text_events set type='text.incoming.mms' where id=$1",[u.eventId]],
   ["update icash_text_messages set event_id='missing-event' where id=$1",[u.id]],
  ]){const before=await f.context();await f.query(sql,args);const after=await f.context();assert.notEqual(after.fingerprint,before.fingerprint);assert.equal(await f.rpc('icash_save_seller_memory',{p_account:f.account,p_screening:f.screen,p_phone:f.phone,p_fingerprint:before.fingerprint,p_projection:original.cached}),false);}
  assert.equal(JSON.stringify((await f.query('select projection from icash_seller_memory_private.snapshots where account_id=$1 and source_fingerprint=$2',[f.account,m.fingerprint])).rows[0].projection),cached,'old cache remains immutable');
 }
 // Exact scopes survive projection; other account/deal/phone/thread cannot bind.
 {const f=await fixture(pg),g=await fixture(pg);await g.turn('outgoing','Are you the owner?',0);await f.turn('incoming','Yes.',1);assert.equal((await memory(f)).state.facts.ownership,undefined);
  assert.equal(await readSellerMemory(f.db,{...f.binding,accountId:g.account}),null);assert.equal(await readSellerMemory(f.db,{...f.binding,phone:'+12125550124'}),null);
  await f.query('update icash_text_threads set retired_at=now() where id=$1',[f.thread]);assert.equal(await memory(f),null);
 }
 // Raw 1000-message coverage is not halved by paired rows and 1001 is explicit.
 {const f=await fixture(pg);await f.turn('outgoing','Are you the owner?',0);
  await f.query("insert into icash_text_events select 'cap-'||$1||'-'||g,'text.incoming.sms',jsonb_build_object('timestamp',1577836800+g) from generate_series(1,999) g",[f.thread]);
  await f.query("insert into icash_text_messages select gen_random_uuid(),$1::uuid,$2::uuid,'incoming','received','Thank you.','fixture','cap-'||($2::uuid)::text||'-'||g,to_timestamp(1577836800+g),null from generate_series(1,999) g",[f.account,f.thread]);
  let c=await f.context();assert.equal(c.conversations[0].rawSourceCount,1000);assert.equal(c.conversations[0].transcript.length,1999);assert((await memory(f)).complete);
  await f.turn('incoming','Thank you.',1001);c=await f.context();assert.equal(c.conversations[0].rawSourceCount,1001);assert.equal((await memory(f)).complete,false);
 }
 // Malformed capability markers cannot lift the original application's hold.
 {const f=await fixture(pg);await f.turn('incoming','I am the owner.',1);const c=await f.context();for(const mutate of [x=>x.receiptProjectionVersion='unsupported',x=>x.receiptSourceComplete='true',x=>x.conversations[0].rawSourceCount=0,x=>x.conversations[0].transcript.find(t=>t.role==='user').questionUnverified='false']){const x=structuredClone(c);mutate(x);await assert.rejects(readSellerMemory(async()=>x,f.binding),/RECEIPT_PROJECTION_REQUIRED/);}}
 assert.equal((await api(pg).query("select has_function_privilege('authenticated','icash_seller_memory_context(uuid,uuid,text)','execute') allowed")).rows[0].allowed,false);
}
