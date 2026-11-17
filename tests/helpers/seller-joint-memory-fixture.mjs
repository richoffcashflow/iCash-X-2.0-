import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {setup as atomicSetup,scenario,ownedContract,textScenario,rpc,atomicMigration} from './seller-atomic-memory-fixture.mjs';
import {sellerCallSource} from '../../lib/seller-call-source.ts';
import {readSellerMemory} from '../../lib/seller-memory.ts';
import {sellerCallPrefix,reviewSellerAgreementMemory} from '../../lib/seller-agreement-memory-proof.ts';
import {sellerAgreementAction} from '../../lib/seller-agreement-service.ts';
import {processSellerTextOffer} from '../../lib/seller-text-offer-service.ts';
import {recoverAgreementDelivery} from '../../lib/agreement-delivery-recovery.ts';
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

// A provider creation result does not attach its confirmation. Keep these
// operations separate so a recovery fixture cannot hide that handoff gap.
export async function preparedOriginal(s){
 const e=await s.begin();assert(e?.id);
 await s.pg.query("update public.icash_signing_envelopes set state='awaiting_counterparty',provider_id='original-fixture-document' where id=$1",[e.id]);
 return e;
}
export async function originalContractMessage(s,envelopeId){
 const prior=(await s.pg.query('select message_id from public.icash_contract_text_deliveries where account_id=$1 and envelope_id=$2',[s.account,envelopeId])).rows;
 assert(prior.length<=1);if(prior.length)return prior[0].message_id;
 const message=randomUUID();
 await s.pg.query("insert into public.icash_text_messages(id,account_id,thread_id,direction,state,body) values($1,$2,$3,'outgoing','ready','Review your contract: https://docuseal.com/s/original-fixture')",[message,s.account,s.thread]);
 await s.pg.query("insert into public.icash_contract_text_deliveries values($1,$2,'seller',$3,$4)",[s.account,envelopeId,message,s.thread]);
 return message;
}

/** Actual recovery service and original SQL; only provider creation/transport,
 * financial admission and unrelated receipt reconciliation are sentinels. */
export async function deferredLifecycleCases(pg){
 const queuedIds=[];
 const queue=async s=>{const queued=await rpc(pg,'icash_defer_seller_agreement',s.args);assert(queued?.queued);queuedIds.push(queued.id);return queued.id;};
 const row=id=>pg.query('select state,result,envelope_id from icash_seller_agreement_private.delivery_recovery where id=$1',[id]).then(r=>r.rows[0]);
 const eligible=s=>pg.query("update public.icash_screening_jobs set result='{\"financialCheck\":{\"status\":\"eligible\"}}'::jsonb,completed_at=clock_timestamp() where id=$1",[s.screen]);
 const harness=(scenarios,{afterCreate,beforeText}={})=>{
  const byAccount=new Map(scenarios.map(s=>[s.account,s]));
  const observed={creates:[],bindings:[],textAttempts:[],textClaims:[],finalizations:[]};
  const db=async(path,_method,args)=>{
   // No saved provider receipts exist in these prospective fixture scenarios.
   if(path==='rpc/icash_reconcile_agreement_delivery_receipts')return 0;
   if(path.startsWith('rpc/')){
    if(path==='rpc/icash_finish_agreement_delivery_recovery')observed.finalizations.push(structuredClone(args));
    if(path==='rpc/icash_bind_agreement_delivery_envelope')observed.bindings.push(structuredClone(args));
    return rpc(pg,path.slice(4),args);
   }
   if(path.startsWith('icash_signing_envelopes?')){
    const params=new URLSearchParams(path.slice(path.indexOf('?')+1));
    const account=params.get('account_id')?.replace(/^eq\./,''),deal=params.get('deal_id')?.replace(/^eq\./,'');
    assert(byAccount.has(account));assert.equal(byAccount.get(account).deal,deal);
    return (await pg.query("select id,state,terms,recipients,provider_id from public.icash_signing_envelopes where account_id=$1 and deal_id=$2 and kind='purchase' and not test_mode limit 2",[account,deal])).rows;
   }
   throw Error('Unexpected recovery fixture path: '+path);
  };
  const deps={db,send:async input=>{
   const s=byAccount.get(input.accountId);assert(s);assert.equal(input.dealId,s.deal);assert.deepEqual(input.signers,[{name:s.terms.seller,phone:s.phone}]);
   const envelope=await preparedOriginal(s);observed.creates.push({accountId:s.account,id:envelope.id});
   if(afterCreate)await afterCreate(s);
   return {id:envelope.id,testMode:false};
  },text:async(accountId,envelopeId,phone)=>{
   const s=byAccount.get(accountId);assert(s);assert.equal(phone,s.phone);
   observed.textAttempts.push({accountId,envelopeId});
   const c=(await pg.query('select state,envelope_id from icash_seller_agreement_private.confirmations where account_id=$1 and deal_id=$2',[accountId,s.deal])).rows[0];
   assert.equal(c?.state,'ready','actual service must bind the original confirmation before its first text');
   assert.equal(c.envelope_id,envelopeId);
   const recovery=(await pg.query("select envelope_id from icash_seller_agreement_private.delivery_recovery where account_id=$1 and deal_id=$2 and state='claimed'",[accountId,s.deal])).rows[0];
   assert.equal(recovery?.envelope_id,envelopeId,'the original recovery stays attached to that same envelope');
   if(beforeText)await beforeText(s);
   const message=await originalContractMessage(s,envelopeId);
   const claim=await rpc(pg,'icash_claim_text_before_owner_question',{p_account:accountId,p_message:message,p_sender:'+14243948384'});
   if(claim)observed.textClaims.push({accountId,message});
   return {sent:!!claim,status:claim?'accepted':'held'};
  }};
  return {...observed,run:()=>recoverAgreementDelivery(deps,{VERCEL_ENV:'production',DOCUSEAL_MODE:'live',ICASH_LIVE_WORK_READY:'true'})};
 };
 try{
  {
   const s=await jointScenario(pg);await eligible(s);const id=await queue(s),h=harness([s]);
   assert.equal((await h.run()).status,'idle','a live original cannot consume a completion-dependent recovery');
   assert.equal((await row(id)).state,'queued');assert.equal(h.finalizations.length,0);assert.equal(h.creates.length,0);assert.equal(h.textAttempts.length,0);
   await pg.query('update public.icash_call_recordings set call_ended_at=clock_timestamp() where account_id=$1',[s.account]);
   assert.equal((await h.run()).status,'idle','terminal clock without the full original source stays queued');
   assert.equal((await row(id)).state,'queued');assert.equal(h.finalizations.length,0);
   await s.complete();
   assert.equal((await h.run()).status,'agreement_text_accepted','complete neutral original binds and sends its first original text');
   assert.equal(h.creates.length,1);assert.equal(h.bindings.length,1);assert.equal(h.textAttempts.length,1);assert.equal(h.textClaims.length,1);assert.equal(h.finalizations.length,1);
   assert.equal((await row(id)).state,'sent');assert.equal((await h.run()).status,'idle','one original is not rearmed');assert.equal(h.creates.length,1);
   const confirmation=(await pg.query('select state,envelope_id from icash_seller_agreement_private.confirmations where account_id=$1',[s.account])).rows[0];
   assert.equal(confirmation.state,'ready');assert.equal(confirmation.envelope_id,h.creates[0].id,'the same original envelope remains attached');
  }
  {
   const live=await jointScenario(pg),liveId=await queue(live),ready=await jointScenario(pg),readyId=await queue(ready);
   await pg.query("update icash_seller_agreement_private.delivery_recovery set created_at=clock_timestamp()-interval '2 hours' where id=$1",[liveId]);
   await ready.complete();const h=harness([live,ready]);
   assert.equal((await h.run()).status,'agreement_text_accepted');assert.deepEqual(h.creates.map(x=>x.accountId),[ready.account]);
   assert.equal((await row(liveId)).state,'queued','an older live original does not block another account’s completed original');assert.equal((await row(readyId)).state,'sent');
  }
  {
   const s=await jointScenario(pg),id=await queue(s),h=harness([s]);
   await s.complete([{role:'user',message:'I have another mortgage.',time_in_call_secs:s.turns.length}]);
   assert.equal((await h.run()).status,'agreement_recovery_needs_review','complete material changes still need review');
   assert.equal(h.creates.length,0);assert.equal(h.textAttempts.length,0);assert.equal(h.finalizations.length,1);
   assert.equal((await row(id)).state,'needs_review');assert.equal((await row(id)).result.reason,'seller_memory_review_required');
  }
  const changes={
   material:s=>s.incoming(pg,'Actually, I have another mortgage.'),
   stop:s=>rpc(pg,'icash_ingest_text_event_before_operational',{p_event:{id:randomUUID(),type:'text.incoming.sms',timestamp:Date.now()/1000,data:{from:s.phone,to:'+14243948384',body:'STOP',message_id:randomUUID()}},p_optout:true}),
   manual:s=>pg.query('insert into public.icash_property_controls(account_id,property_id,manual) values($1,$2,true) on conflict(account_id,property_id) do update set manual=true',[s.account,s.snapshot.propertyId]),
   pause:s=>pg.query('update public.icash_accounts set bot_paused=true where id=$1',[s.account]),
  };
  for(const stage of ['afterCreate','beforeText'])for(const [kind,change] of Object.entries(changes)){
   const s=await jointScenario(pg);await eligible(s);const id=await queue(s);await s.complete();
   const h=harness([s],{[stage]:change});
   assert.equal((await h.run()).status,stage==='afterCreate'?'agreement_recovery_needs_review':'agreement_text_needs_review',kind+' at '+stage);
   assert.equal(h.creates.length,1);assert.equal(h.bindings.length,1);assert.equal(h.textAttempts.length,stage==='afterCreate'?0:1);assert.equal(h.textClaims.length,0,kind+' cannot use ordinary financial fallback');
   const e=(await pg.query('select state,provider_id from public.icash_signing_envelopes where id=$1',[h.creates[0].id])).rows[0];
   assert.deepEqual(e,{state:'awaiting_counterparty',provider_id:'original-fixture-document'});assert.equal((await row(id)).state,'needs_review');
   assert.equal((await h.run()).status,'idle','held originals are not rearmed by the repair');assert.equal(h.creates.length,1);
  }
  for(const changed of [false,true]){
   const s=await jointScenario(pg);await eligible(s);assert((await s.claim())?.claimed);const e=await preparedOriginal(s);
   if(changed)await s.incoming(pg,'Actually, I have another mortgage.');
   const message=await originalContractMessage(s,e.id);
   assert.equal(await rpc(pg,'icash_claim_text_before_owner_question',{p_account:s.account,p_message:message,p_sender:'+14243948384'}),null,'old workers with unbound confirmations cannot use ordinary financial fallback');
   const c=(await pg.query('select state,envelope_id from icash_seller_agreement_private.confirmations where account_id=$1',[s.account])).rows[0];
   assert.deepEqual(c,{state:'preparing',envelope_id:null},'the final guard does not silently bind a confirmation');
  }
 }finally{
  // Isolate these fictional jobs from later unrelated concurrency cases.
  for(const id of queuedIds)await pg.query('update icash_seller_agreement_private.delivery_recovery set expires_at=clock_timestamp() where id=$1',[id]);
 }
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
