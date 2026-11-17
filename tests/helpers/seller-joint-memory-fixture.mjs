import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {setup as atomicSetup,scenario,ownedContract,textScenario,rpc,atomicMigration} from './seller-atomic-memory-fixture.mjs';
import {sellerCallSource} from '../../lib/seller-call-source.ts';
import {readSellerMemory} from '../../lib/seller-memory.ts';
import {sellerCallPrefix,reviewSellerAgreementMemory} from '../../lib/seller-agreement-memory-proof.ts';
import {sellerAgreementAction} from '../../lib/seller-agreement-service.ts';
import {processSellerTextOffer} from '../../lib/seller-text-offer-service.ts';
import {qualifiedSellerTurns} from './seller-qualification-fixture.mjs';
import {sha} from '../../lib/required-call-recording.ts';

const rawMigration=readFileSync(new URL('../../config/seller-call-source-completeness.sql',import.meta.url),'utf8');
export async function setup(pg){
 await atomicSetup(pg); // Actual receipt predecessor and receipt migration.
 await pg.exec('begin;'+atomicMigration()+'commit;');
 assert.equal((await pg.query("select md5(pg_get_functiondef('public.icash_save_live_result(uuid,jsonb)'::regprocedure)) h")).rows[0].h,'82af3a7c40a85cb346ad37f571b3fdca');
 await pg.exec(`alter table icash_live_conversations add agent_id text;
 alter table icash_call_recordings add agent_id text;
 alter table icash_recorded_reception_private.sessions add agent_id text,add contact_key text;`);
 await pg.exec('begin;'+rawMigration+'commit;');
 assert.equal((await pg.query("select md5(pg_get_functiondef('public.icash_seller_memory_context(uuid,uuid,text)'::regprocedure)) h")).rows[0].h,'3aa28aa3e791861975e1fba6da67db2b');
 await pg.exec("update icash_seller_call_source_private.policy set enabled=true,activated_at=clock_timestamp(),release_sha=repeat('a',40)");
}

let counter=600;
export async function jointScenario(pg){
 const s=await scenario(pg,{phone:'+12125550'+String(++counter)});
 const now=Date.now(),started=Math.floor(now/1000)-60;
 const turns=[...qualifiedSellerTurns,{role:'agent',message:'What is your full legal name for the agreement?'},{role:'user',message:'Jane Seller.'},{role:'agent',message:'Are you the only owner and decision maker?'},{role:'user',message:'Yes, just me.'},{role:'agent',message:`The purchase price is $90,000 cash, closing ${s.terms.closingDate}, with a ten-day inspection period. May I text the agreement now?`},{role:'user',message:'Yes, please.'}].map((t,index)=>({...t,time_in_call_secs:index}));
 const live={conversation_id:s.conversation,agent_id:'agent_joint_fixture',status:'in-progress',metadata:{start_time_unix_secs:started},transcript:turns};
 await pg.query("update icash_live_conversations set agent_id=$2 where id=$1",[s.call,live.agent_id]);
 await pg.query("update icash_call_recordings set agent_id=$2,provider_started_at=to_timestamp($3) where account_id=$1",[s.account,live.agent_id,started]);
 const binding={accountId:s.account,screeningId:s.screen,dealId:s.deal,phone:s.phone};
 const db=(path,_method,args)=>rpc(pg,path.slice(4),args);
 const complete=async(extra=[{role:'agent',message:'Thank you.',time_in_call_secs:turns.length},{role:'user',message:'Goodbye.',time_in_call_secs:turns.length+1}],mutate=x=>x,client=pg)=>{
  const raw=mutate({...live,status:'done',transcript:[...turns,...extra]});
  await rpc(client,'icash_save_live_result_with_source',{p_call:s.call,p_result:{party:'seller',summary:'Fictional original completed call',humanRequested:false,optedOut:false,transcript:raw.transcript},p_evidence:sellerCallSource(raw)});
  return raw;
 };
 const historical=async(transcript=turns)=>{
  const id=randomUUID(),conversation='conv_'+id.replaceAll('-',''),operation='voice:'+id;
  await pg.query("insert into icash_live_conversations(id,account_id,screening_id,contact_key,party,state,operation_key,conversation_id,agent_id) select $2,account_id,screening_id,contact_key,party,'waiting',$3,$4,agent_id from icash_live_conversations where id=$1",[s.call,id,operation,conversation]);
  await pg.query("insert into icash_call_recordings(account_id,operation_key,provider_started_at,screening_id,contact_key,party,conversation_id,to_phone,agent_id) select account_id,$2,provider_started_at,screening_id,contact_key,party,$3,to_phone,agent_id from icash_call_recordings where account_id=$1 and operation_key='voice:'||$4::text",[s.account,operation,conversation,s.call]);
  const raw={...live,conversation_id:conversation,status:'done',transcript};
  await rpc(pg,'icash_save_live_result_with_source',{p_call:id,p_result:{party:'seller',summary:'Fictional historical call',humanRequested:false,optedOut:false,transcript},p_evidence:sellerCallSource(raw)});
  return raw;
 };
 s.args.p_call_prefix=sellerCallPrefix(live,s.conversation,now);assert(s.args.p_call_prefix);
 s.args.p_memory_fingerprint=(await s.context()).fingerprint;
 return {...s,now,live,turns,binding,db,complete,historical};
}

export async function cases(pg){
 {
  const s=await jointScenario(pg);await s.historical();
  const source=await s.context();assert.equal(source.complete,false);assert.equal(source.receiptSourceComplete,false);assert.equal(source.callSourceComplete,true);
  const memory=await readSellerMemory(s.db,s.binding);assert.equal(memory.complete,true);assert.equal(memory.state.qualification.ready,true);
  // Create from an unchanged fully completed raw source and its exact receipt.
  s.args.p_memory_fingerprint=source.fingerprint;
  const c=await s.claim();assert(c?.claimed,'actual raw projection reaches actual atomic claim');
  const e=await s.begin();assert(e?.id);
  const message=await ownedContract(s,c,e);
  assert.equal(await rpc(pg,'icash_confirmed_seller_contract_text_current',{p_account:s.account,p_message:message}),true,'owned link preserves real raw fingerprint');
  assert.equal((await rpc(pg,'icash_claim_text_before_owner_question',{p_account:s.account,p_message:message,p_sender:'+14243948384'}))?.messageId,message);
  await s.incoming(pg,'Actually, do not send that contract.');
  assert.equal(await rpc(pg,'icash_confirmed_seller_contract_text_current',{p_account:s.account,p_message:message}),false);
  assert.equal(await rpc(pg,'icash_claim_text_before_owner_question',{p_account:s.account,p_message:message,p_sender:'+14243948384'}),null);
  assert.equal(Number((await pg.query('select count(*) n from fixture_text_admissions where message_id=$1',[message])).rows[0].n),1);
  assert.equal((await pg.query('select provider_id from icash_signing_envelopes where id=$1',[e.id])).rows[0].provider_id,'original-fixture-document');
 }
 {
  const s=await jointScenario(pg),c=await s.claim();assert(c?.claimed);
  await s.incoming(pg,'Wait, I have another mortgage.');
  await assert.rejects(s.begin(),/source|memory/i);
  assert.equal(Number((await pg.query('select count(*) n from icash_signing_envelopes where account_id=$1',[s.account])).rows[0].n),0);
 }
 {
  const s=await textScenario(pg,{phone:'+12125550690'}),memory=await readSellerMemory((path,_method,args)=>rpc(pg,path.slice(4),args),{accountId:s.account,screeningId:s.screen,dealId:s.deal,phone:s.phone});
  assert.equal(memory.complete,true);assert((await s.textClaim())?.claimId);assert((await s.begin())?.id,'text-only raw-enabled atomic path stays live');
 }
 for(const variant of ['neutral','material','trailing-agent','changed-prefix','old-v1','unknown-clock','new-sms']){
  const s=await jointScenario(pg);if(variant==='old-v1')s.args.p_call_prefix={...s.args.p_call_prefix,version:'seller-call-prefix-v1'};
  const queued=await rpc(pg,'icash_defer_seller_agreement',s.args);
  if(variant==='old-v1'){assert.equal(queued,null);continue;}
  assert(queued?.queued,variant+' queues original only');
  // Terminal completion without its full original source never consumes recovery.
  await pg.query('update icash_call_recordings set call_ended_at=clock_timestamp() where account_id=$1',[s.account]);
  assert.equal(await rpc(pg,'icash_claim_agreement_delivery_recovery',{}),null);
  const extra=variant==='material'?[{role:'user',message:'I have another mortgage.',time_in_call_secs:s.turns.length}]:variant==='trailing-agent'?[{role:'agent',message:'Actually the price is now $100,000.',time_in_call_secs:s.turns.length}]:undefined;
  await s.complete(extra,x=>variant==='changed-prefix'?{...x,transcript:x.transcript.map((t,i)=>i===0?{...t,message:'Changed original question.'}:t)}:variant==='unknown-clock'?{...x,transcript:x.transcript.map(t=>t.role==='user'?{...t,time_in_call_secs:null}:t)}:x);
  if(variant==='new-sms')await s.incoming(pg,'Wait until tomorrow.');
  const job=await rpc(pg,'icash_claim_agreement_delivery_recovery',{});
  if(variant==='new-sms'){
   assert.equal(job,null,'changed nonoriginal source never consumes the original queue');
   assert.equal((await pg.query('select state from icash_seller_agreement_private.delivery_recovery where id=$1',[queued.id])).rows[0].state,'queued');
   assert.equal(Number((await pg.query('select count(*) n from icash_seller_agreement_memory_private.reviews where confirmation_id in(select id from icash_seller_agreement_private.confirmations where account_id=$1)',[s.account])).rows[0].n),0);
   continue;
  }
  assert.equal(job?.id,queued.id,variant+' owns original recovery');
  const ok=await reviewSellerAgreementMemory(s.db,job,Date.now());
  assert.equal(ok,variant==='neutral','actual raw + atomic + TS review: '+variant);
  const journals=Number((await pg.query('select count(*) n from icash_seller_agreement_memory_private.reviews where confirmation_id in(select id from icash_seller_agreement_private.confirmations where account_id=$1)',[s.account])).rows[0].n);
  assert.equal(journals,variant==='neutral'?1:0);
  if(ok)assert((await s.begin())?.id,'neutral completion permits the one original document');
  else assert.equal(Number((await pg.query('select count(*) n from icash_signing_envelopes where account_id=$1',[s.account])).rows[0].n),0);
 }
 {
  const s=await scenario(pg,{phone:'+12125550691',enabled:false}),old={...s.args};delete old.p_memory_fingerprint;delete old.p_call_prefix;
  assert((await rpc(pg,'icash_claim_seller_agreement',old))?.claimed);assert((await s.begin())?.id);
  await pg.exec('update icash_seller_memory_private.settings set enabled=true');
 }
}

export async function directCases(pg){
 const declarations=['I have another mortgage so can you still buy it?','I sold the house so what happens next?','The property has fire damage can you still buy it?',"I'd like to speak to a person.","I'd prefer a human.",'I need to speak with somebody.'];
 const readbacks=['mixed-price','mixed-date','mixed-inspection','changed-price','changed-date','changed-inspection','negated-price'];
 for(const {changed=false,held=null,clocked=true,readback=null} of [{},{changed:true},...declarations.flatMap(held=>[{held},{held,clocked:false}]),...readbacks.map(readback=>({readback}))]){
  const s=await jointScenario(pg),token='f'.repeat(64),hash=sha(token);
  if(readback){
   const date=new Date(s.terms.closingDate+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+1);const changedDate=date.toISOString().slice(0,10);
   if(readback==='negated-price')s.live.transcript=s.turns.map((turn,index)=>index===s.turns.length-2?{...turn,message:String(turn.message).replace('price is $90,000','price is not $90,000')}:turn);
   else if(readback.startsWith('mixed-'))s.live.transcript=s.turns.map((turn,index)=>index===s.turns.length-2?{...turn,message:String(turn.message).replace('$90,000 cash',readback==='mixed-price'?'$90,000 cash, but the purchase price is $60,000':'$90,000 cash').replace(s.terms.closingDate,readback==='mixed-date'?s.terms.closingDate+', but now closing '+changedDate:s.terms.closingDate).replace('ten-day inspection',readback==='mixed-inspection'?'ten-day inspection, but now a five-day inspection':'ten-day inspection')}:turn);
   else s.live.transcript=[...s.turns,{role:'agent',message:readback==='changed-price'?'The purchase price is now $60,000.':readback==='changed-date'?'Closing is now '+changedDate+'.':'The inspection period is now five days.',time_in_call_secs:s.turns.length}];
  }
  await pg.query('update icash_live_conversations set tool_token_hash=$2 where id=$1',[s.call,hash]);
  await pg.query('update icash_call_recordings set stop_token_hash=$2 where account_id=$1',[s.account,hash]);
  const propertyId='prop_'+counter;
  const snapshot={propertyId,propertyType:'house',fetchedAt:new Date().toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:propertyId,full_address:s.terms.address,legal_description:'Lot 1 Block 2',estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:20000,estimated_equity_percentage:90}}};
  await pg.query('update icash_screening_jobs set snapshot=$2 where id=$1',[s.screen,snapshot]);
  await pg.query('update icash_call_offer_private.offers set snapshot=$2 where deal_id=$1',[s.deal,snapshot]);
  if(held){
   const turns=[{role:'agent',message:'Anything else?'},{role:'user',message:held},...s.turns].map((t,index)=>({...t,time_in_call_secs:clocked?index:null}));
   await s.historical(turns);
   const memory=await readSellerMemory(s.db,s.binding);assert(memory.sourceHold,held);assert.equal(memory.state.qualification.ready,false);
   assert.equal((await processSellerTextOffer(s.binding,{db:s.db,send:async()=>assert.fail('No document'),text:async()=>assert.fail('No text'),dispatch:async()=>assert.fail('No dispatch')})).status,'seller_memory_source_review_required');
  }
  let claims=0,creates=0,texts=0,claim;
  const db=async(path,method,args)=>{
   if(path==='rpc/icash_call_offer_context')return null; // Existing calculator authority, not source admission, is a fixture boundary.
   if(path==='rpc/icash_sms_thread_review_current')return true;
   if(path==='rpc/icash_finish_seller_agreement')return true; // Provider save is recorded in send fixture below.
   if(path==='rpc/icash_claim_seller_agreement'){
    claims++;if(changed)await s.incoming(pg,'Stop.');claim=await rpc(pg,path.slice(4),args);return claim;
   }
   if(path.startsWith('rpc/'))return rpc(pg,path.slice(4),args);
   if(path.startsWith('icash_signing_envelopes?'))return [];
   if(path.startsWith('icash_deal_files?'))return (await pg.query('select terms,stage from icash_deal_files where id=$1',[s.deal])).rows;
   if(path.startsWith('icash_screening_jobs?'))return [{snapshot}];
   if(path.startsWith('icash_customer_identities?'))return [{principal:s.terms.buyer}];
   if(path.startsWith('icash_text_threads?'))return [{id:s.thread}];
   if(path.startsWith('icash_text_suppressions?'))return [];
   throw Error(path);
  };
  const action=()=>sellerAgreementAction(token,{action:'confirm_and_send',conversationId:s.conversation,confirmation:s.confirmation},{db,bind:async()=>{},history:async()=>s.live,now:()=>Date.now(),send:async()=>{const envelope=await s.begin();assert(envelope?.id);creates++;await ownedContract(s,claim,envelope);return {id:envelope.id,testMode:false};},text:async()=>{const message=(await pg.query('select message_id from icash_contract_text_deliveries where account_id=$1',[s.account])).rows[0].message_id;const result=await rpc(pg,'icash_claim_text_before_owner_question',{p_account:s.account,p_message:message,p_sender:'+14243948384'});assert(result);texts++;return {sent:true,status:'accepted',instruction:'Fictional provider sentinel only'};},refresh:async()=>assert.fail('No live poll')});
  if(readback){const result=await action();assert.equal(result.sent,false,readback);assert.equal(result.status,'confirmation_needed');assert.equal(claims,0);assert.equal(creates,0);assert.equal(texts,0);continue;}
  if(held){const result=await action();assert.equal(result.sent,false);assert.equal(claims,0);assert.equal(creates,0);assert.equal(texts,0);continue;}
  if(changed){await assert.rejects(action(),/agreement_in_progress/);assert.equal(creates,0);assert.equal(texts,0);}
  else {const result=await action();assert.equal(result.sent,true);assert.equal(creates,1);assert.equal(texts,1);}
  assert.equal(claims,1);
 }
}
