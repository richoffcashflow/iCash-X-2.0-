import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {closingPayoutNote} from '../lib/closing-setup.ts';
import {titleConfirmationInstructions,titleConfirmationInstructionsFor} from '../lib/title-confirmation-instructions.ts';
import {titleEmailAddress} from '../lib/title-inbound-policy.ts';
import {processDealJourneys} from '../lib/deal-journey-service.ts';

const savedEnv={...process.env},oldFetch=globalThis.fetch;
const env={VERCEL_ENV:'production',ICASH_LIVE_WORK_READY:'true',DOCUSEAL_MODE:'live'};
Object.assign(process.env,env,{RESEND_API_KEY:'fixture',RESEND_RECEIVING_WEBHOOK_SECRET:'fixture',ICASH_TITLE_FROM_EMAIL:'office@example.invalid',ICASH_TITLE_REPLY_EMAIL:'reply@example.invalid'});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const failures=[],unhandled=[];let cases=0;
const purchaseId='11111111-1111-4111-8111-111111111111',assignmentId='22222222-2222-4222-8222-222222222222';
const unhandledRejection=error=>unhandled.push(error);
process.on('unhandledRejection',unhandledRejection);

// Native response/stream cleanup can stay pending independently of the known
// HTTP result. No test makes a provider request or substitutes a send receipt.
function rejectedResponse(mode){
 let cancellations=0,rejectCleanup;
 const pending=new Promise((_,reject)=>{rejectCleanup=reject;});
 const cancel=()=>{cancellations++;return mode==='rejected'?Promise.reject(Error('Fixture cleanup failed')):pending;};
 const response=new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('Provider rejection'));},cancel}),{status:503});
 if(mode==='synchronous')response.body.cancel=()=>{cancellations++;throw Error('Fixture cleanup threw');};
 return {response,cancellations:()=>cancellations,finish(){if(mode==='pending'&&cancellations)rejectCleanup(Error('Fixture late cleanup failure'));}};
}

async function fixture(kind,{mode='pending',race=null,allow=true,success=false}={}){
 const row={state:kind==='opening'?'ready':'scheduled',email_state:'issued',provider_id:null,email_provider_id:null};
 const writes=[];let posts=0;
 const snapshot={version:'title-delivery-v1',request:{id:'request',accountId:'account',dealId:'deal',purchaseEnvelopeId:purchaseId,recipient:'closer@example.invalid',propertyAddress:'Fixture property'},purchase:{id:purchaseId},assignments:[],payout:null};
 const payload={type:'assignment',envelopeId:assignmentId};
 const db=async(path,method='GET',body)=>{
  if(method==='PATCH'){
   writes.push({path,body});
   const params=new URLSearchParams(path.split('?')[1]);
   for(const field of ['state','email_state']){const filter=params.get(field);if(filter&&row[field]!==filter.slice(3))return [];}
   Object.assign(row,body);return [{...row}];
  }
  if(path==='rpc/icash_title_request_delivery_snapshot')return row.state==='ready'?snapshot:null;
  if(path==='rpc/icash_claim_title_request_snapshot'){
   assert.deepEqual(body.p_expected,snapshot);assert.equal(body.p_id,'request');
   if(!allow||row.state!=='ready')return false;row.state='dispatching';return true;
  }
  if(path==='rpc/icash_claim_title_followup'||path==='rpc/icash_claim_title_update'){
   assert.equal(body.p_account,'account');assert.equal(body.p_task,'task');
   if(kind==='update')assert.deepEqual(body.p_payload,payload);
   if(!allow||row.email_state!=='issued'||row.state!=='scheduled')return null;
   row.email_state='dispatching';return {requestId:'request',recipient:'closer@example.invalid',address:'Fixture property'};
  }
  if(path.startsWith('icash_title_tasks?')){
   assert.match(path,/account_id=eq\.account/);
   return [{id:'task',deal_id:'deal',kind:kind==='update'?'document_update':'followup',...row,payload}];
  }
  assert.fail('Unexpected database boundary: '+path);
 };
 const dependencies={db,closingPayoutNote,titleConfirmationInstructions,titleConfirmationInstructionsFor,titleEmailAddress,
  completedSigningPdf:async(account,id)=>{assert.equal(account,'account');assert.equal(id,kind==='opening'?purchaseId:assignmentId);return new Uint8Array([1,2,3]).buffer;}};
 if(kind==='followup')dependencies.dispatchTitleUpdate=()=>assert.fail('A plain follow-up cannot change into a document update');
 const file=kind==='opening'?'title-service':kind==='update'?'title-update-service':'title-followup-service';
 const service=await loadService('lib/'+file+'.ts',dependencies);
 const run=()=>kind==='opening'?service.dispatchTitleRequest('account','request'):kind==='update'?service.dispatchTitleUpdate('account','task'):service.dispatchTitleFollowup('account','task');
 const transport=rejectedResponse(mode);
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://api.resend.com/emails');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert(options.signal instanceof AbortSignal);
  assert.equal(options.headers['Idempotency-Key'],kind==='opening'?'title-request':'title-followup-task');
  assert.deepEqual(JSON.parse(options.body).to,['closer@example.invalid']);posts++;
  if(race)row.state=race;
  return success?new Response(JSON.stringify({id:'original-provider-receipt'}),{status:200}):transport.response;
 };
 return {row,writes,run,transport,posts:()=>posts};
}

async function beforeCleanup(run,transport){
 let settled=false,outcome;
 const work=run().then(value=>{settled=true;outcome=value;},error=>{settled=true;outcome={error};});
 try{
  for(let n=0;n<20&&!settled;n++)await flush();
  assert.equal(settled,true,'Known title failure must reach its original hold without waiting for cleanup');
  assert.equal(transport.cancellations(),1);assert(!outcome.error);return outcome;
 }finally{transport.finish();await work;await flush();}
}
async function check(name,run){try{await run();cases++;}catch(error){failures.push(new Error(name+': '+error.message,{cause:error}));}}
try{
 for(const kind of ['opening','followup','update']){
  for(const mode of ['pending','rejected','synchronous'])await check(kind+' '+mode,async()=>{
   const f=await fixture(kind,{mode});
   const result=await beforeCleanup(f.run,f.transport);
   assert.equal(result.status,kind==='opening'?'title_delivery_needs_reconciliation':'title_followup_needs_reconciliation');
   assert.equal(kind==='opening'?f.row.state:f.row.email_state,'needs_review');
   assert.equal(f.row.provider_id,null);assert.equal(f.row.email_provider_id,null);
   await f.run();assert.equal(f.posts(),1,'The original rejected or uncertain email is never automatically resent');
   assert(f.writes.every(({body})=>!body.stage&&!body.provider_id&&!body.email_provider_id),'No signature, title, deposit, closing or delivery receipt is invented');
  });
  for(const race of kind==='opening'?['needs_review']:['cancelled','dismissed','done'])await check(kind+' late '+race,async()=>{
   const f=await fixture(kind,{race});await beforeCleanup(f.run,f.transport);
   assert.equal(f.row.state,race,'A newer terminal/task state owns the result');
   await f.run();assert.equal(f.posts(),1);
  });
  await check(kind+' final claim held',async()=>{
   const f=await fixture(kind,{allow:false});await f.run();assert.equal(f.posts(),0);assert.equal(f.transport.cancellations(),0);
  });
  await check(kind+' original success',async()=>{
   const f=await fixture(kind,{success:true});const result=await f.run();
   assert.equal(result.status,kind==='opening'?'title_request_sent':'title_followup_sent');
   assert.equal(kind==='opening'?f.row.provider_id:f.row.email_provider_id,'original-provider-receipt');
   assert.equal(f.transport.cancellations(),0);await f.run();assert.equal(f.posts(),1);
  });
 }
 await check('actual journey continues after title cleanup stalls',async()=>{
  const f=await fixture('opening');let buyerMessages=0,claims=0;
  const db=async path=>{
   if(path==='rpc/icash_due_journeys')return ['journey'];
   if(path==='rpc/icash_advance_journey')return null;
   if(path==='rpc/icash_claim_journey_assignment')return null;
   if(path.startsWith('icash_deal_journeys?'))return [{account_id:'account',deal_id:'deal',state:'reserved'}];
   if(path==='rpc/icash_journey_allowed')return true;
   if(path==='rpc/icash_claim_journey_message')return claims++===0?{accountId:'other-account',messageId:'other-original'}:null;
   assert.fail('Unexpected journey boundary: '+path);
  };
  const result=await beforeCleanup(()=>processDealJourneys({db,title:f.run,send:()=>assert.fail(),text:()=>assert.fail(),dispatch:async(account,message)=>{
   assert.equal(account,'other-account');assert.equal(message,'other-original');buyerMessages++;return {status:'message_accepted'};
  }},env),f.transport);
  assert.equal(result.failures,1);assert.equal(result.messages,1);assert.equal(buyerMessages,1);assert.equal(f.posts(),1);
 });
 assert.deepEqual(unhandled,[],'A late cleanup rejection is observed');
 if(failures.length)throw new AggregateError(failures,'Title cleanup scenarios failed');
 console.log(`PASS ${cases} title cleanup scenarios: original holds, no replay, late-state preservation, successful receipts and independent buyer follow-through. Offline only.`);
}finally{
 globalThis.fetch=oldFetch;process.off('unhandledRejection',unhandledRejection);
 for(const key of [...Object.keys(env),'RESEND_API_KEY','RESEND_RECEIVING_WEBHOOK_SECRET','ICASH_TITLE_FROM_EMAIL','ICASH_TITLE_REPLY_EMAIL']){if(savedEnv[key]===undefined)delete process.env[key];else process.env[key]=savedEnv[key];}
}
