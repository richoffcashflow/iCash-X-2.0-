import assert from 'node:assert/strict';
import {SellerInventoryUnavailableError,ProspectingBudgetError,voiceReservationFailure} from '../lib/voice-budget-failure.ts';
import {automationWorkReady,newLiveWorkKinds,deferUnstartedAutomation} from '../lib/live-work-admission.ts';
import {automationChanged} from '../lib/automation-outcome.ts';
import {automationTick,WorkerOperationError} from '../worker/runner.mjs';
import {loadService} from './helpers/simulated-journey-services.mjs';
const rejection={code:'P0001',message:'Seller inventory assigned or suppressed'};
for(const path of ['rpc/icash_claim_text','rpc/icash_claim_customer_text'])assert(await voiceReservationFailure(path,400,Response.json(rejection)) instanceof SellerInventoryUnavailableError);
for(const [path,status,body] of [
 ['rpc/icash_claim_text',503,rejection],['rpc/icash_claim_text',401,rejection],
 ['rpc/icash_meta_claim_text',400,rejection],['rpc/icash_reserve_operation',400,rejection],
 ['rpc/icash_claim_text',400,{...rejection,code:'XX000'}],
 ['rpc/icash_claim_text',400,{...rejection,message:rejection.message+' (unknown)'}],
 ['rpc/icash_claim_text',400,null],
])assert(!(await voiceReservationFailure(path,status,Response.json(body)) instanceof SellerInventoryUnavailableError));
assert(!(await voiceReservationFailure('rpc/icash_claim_text',400,new Response('not JSON')) instanceof SellerInventoryUnavailableError));
const saved={...process.env};
try{
 Object.assign(process.env,{CONTIGUITY_API_KEY:'fixture',CONTIGUITY_WEBHOOK_SECRET:'fixture',ICASH_LIVE_WORK_READY:'true',ICASH_SMS_WORK_READY:'true',VERCEL_ENV:'production'});
 let failure=new SellerInventoryUnavailableError(),beforeClaim=false,afterSend=false,claims=0,sends=0,patches=0;
 const finishes=[];
 const db=async(path,method,body)=>{
  if(path==='rpc/icash_consume_automation')return {id:'fixture-ticket',accountId:'fixture-account',kind:'seller_opener',openerMessageId:'fixture-message'};
  if(path==='rpc/icash_finish_automation'){finishes.push(body);return null;}
  if(path==='rpc/icash_settle_pending_estimates')return null;
  if(path.startsWith('icash_text_messages?')){if(method==='PATCH'){patches++;return [];}if(beforeClaim)throw failure;return [{body:'Fixture text',attachments:[],thread_id:'fixture-thread'}];}
  if(path.startsWith('icash_text_threads?'))return [{recipient:'+12025550101',sender:'+12025550100'}];
  if(path.startsWith('icash_text_senders?'))return [{phone:'+12025550100'}];
  if(path.startsWith('icash_voice_configs?'))return [{enabled:false}];
  if(path==='rpc/icash_claim_text'||path==='rpc/icash_claim_customer_text'){claims++;if(failure)throw failure;return {};}
  throw Error('Unexpected fixture operation: '+path);
 };
 const {dispatchTextMessage}=await loadService('lib/text-message-service.ts',{
  SellerInventoryUnavailableError,instantLeadsEnabled:()=>false,smsWorkEnabled:()=>true,liveWorkReady:()=>true,db,
  sameBusinessNumber:(a,b)=>a===b,textPayload:()=>{},
  sendContiguityText:async()=>{sends++;if(afterSend)throw new SellerInventoryUnavailableError();return {messageId:'fixture-receipt'};},
  saveTextReceipt:()=>({status:'message_accepted'}),
 });
 for(const manual of [false,true]){
  const count=claims;
  assert.equal((await dispatchTextMessage('fixture-account','fixture-message',manual)).status,'seller_inventory_unavailable');
  assert.equal(claims,count+1,'One claim only, no automatic retry');assert.equal(sends,0);assert.equal(patches,0);
 }
 beforeClaim=true;await assert.rejects(dispatchTextMessage('fixture-account','fixture-message'),SellerInventoryUnavailableError);beforeClaim=false;
 failure=Error('Unknown database result');await assert.rejects(dispatchTextMessage('fixture-account','fixture-message'),/Unknown database result/);assert.equal(sends,0);
 failure=null;afterSend=true;
 assert.equal((await dispatchTextMessage('fixture-account','fixture-message')).status,'message_delivery_needs_review');assert.equal(sends,1);assert.equal(patches,1,'An error after provider entry remains uncertain');
 afterSend=false;failure=new SellerInventoryUnavailableError();
 const {POST}=await loadService('app/api/internal/automation/route.ts',{
  ProspectingBudgetError,automationWorkReady,newLiveWorkKinds,deferUnstartedAutomation,automationChanged,db,dispatchTextMessage,
  NextResponse:{json:(body,options={})=>Response.json(body,options)},
  readVoiceUsagePolicies:()=>({}),settlePendingVoiceUsage:async()=>({status:'complete'}),reconcileLiveConversation:()=>assert.fail('No call reconciliation needed'),
 });
 const token='00000000-0000-0000-0000-000000000000'.repeat(2);
 const request=()=>new Request('https://fixture.invalid/api/internal/automation',{method:'POST',headers:{authorization:'Bearer '+token}});
 let response=await POST(request());assert.equal(response.status,200);assert.equal((await response.json()).status,'seller_inventory_unavailable');
 assert.deepEqual(finishes.at(-1),{p_id:'fixture-ticket',p_success:true,p_outcome:'seller_inventory_unavailable'});
 assert.equal(await automationTick(async()=>({token}),()=>POST(request())),true,'A handled refusal does not trigger worker failure/backoff');
 assert.equal(sends,1,'No provider dispatch for rejected inventory');
 failure=Error('Unknown database result');
 response=await POST(request());assert.equal(response.status,503);assert.equal((await response.json()).status,'held_for_reconciliation');
 assert.equal(finishes.at(-1).p_success,false);
 await assert.rejects(automationTick(async()=>({token}),()=>POST(request())),error=>error instanceof WorkerOperationError&&error.code==='AUTOMATION_HELD');
 assert.equal(sends,1);assert.equal(patches,1);
 console.log('PASS SMS inventory admission: exact atomic rejection only, automatic/manual claims, no sends/retries/charges, post-provider uncertainty retained, real automation route and worker success/error paths.');
}finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
