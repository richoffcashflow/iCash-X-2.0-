import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {maintenanceBatch} from '../lib/maintenance-batch.ts';
import {continueExpiredOwnerPreflightTicket} from '../lib/owner-expired-preflight-ticket-continuation.ts';

const normal={
 inventory:{pages:[{status:'not_due'}]},researchExclusions:{status:'not_due'},
 ownerExports:{status:'export_recovery_idle'},ownerExportCapacity:{status:'capacity_review_idle'},
 providerCredits:{status:'credit_check_not_requested'},
 ownerPreflightCleanup:{status:'idle'},ownerTicketContinuation:{status:'disabled'},
};
const legitimateWaits={
 inventory:{pages:[{status:'rate_limited'}]},researchExclusions:{status:'pending'},
 ownerExports:{status:'export_receipt_held'},ownerExportCapacity:{status:'capacity_review_held'},
 providerCredits:{status:'provider_credit_exhausted'},
 ownerPreflightCleanup:{status:'pending'},ownerTicketContinuation:{status:'busy'},
};
const silentFailures={inventory:{pages:[{status:'metadata_unavailable'}]}};
const services={inventory:'refreshInventoryGeographyBatch',researchExclusions:'drainResearchExclusions',
 providerCredits:'refreshDealMachineCreditWait',
 ownerExports:'recoverOwnerActiveExports',ownerExportCapacity:'recoverOwnerExportCapacity',ownerPreflightCleanup:'cleanupOwnerPreflight',ownerTicketContinuation:'continueExpiredOwnerPreflightTicket'};
const senderCases={
 sender_config:'messaging_configuration_required',sender_verification:'business_number_verification_required',sender_invitation:'inbound_invitation_not_ready',
 sender_hold:'message_held',sender_unknown:'message_delivery_needs_review',sender_disabled:'live_work_not_ready',
};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const continuationCases=['disabled','idle','busy','held','continued'];
for(const scenario of ['none','waiting','inventory_result',...Object.keys(normal),'pruning',...Object.keys(senderCases),'sender_throw',...continuationCases.map(status=>'continuation_'+status),'continuation_invalid']){
 const started=[],finished=new Set(),monitored=[],logs=[];let authorized=false,release;
 const wait=new Promise(resolve=>{release=resolve;});
 const task=name=>async()=>{started.push(name);return new Response();};
 const deps={
  db:async()=>0,maintenanceBatch,authorizeOutboundBilling:()=>authorized,process:{env:{}},
  console:{info:(...args)=>logs.push(args),error:()=>{}},
  refreshReliability:async(_db,ok)=>{monitored.push(ok);for(const name of Object.keys(normal))assert(finished.has(name),'Health must wait for '+name);return true;},
  pruneUsageLoopObservations:async()=>{started.push('pruning');if(scenario==='pruning')throw Error('PRIVATE telemetry');},
  readRecordingReview:()=>null,applyApprovedFullBusinessVoiceCapacity:async()=>({status:'awaiting_activation'}),applyApprovedProVoiceCapacity:async()=>({status:'already_verified'}),
  applyApprovedEightyPercentVoiceCapacity:async()=>({status:'awaiting_activation'}),
  refreshVoiceCapacity:async()=>({status:'verified'}),readVoiceCapacityProvider:()=>assert.fail('No network'),recoverVoiceConfiguration:async()=>({status:'idle',requeued:0}),
  retryVolumeDeferredText:async()=>{started.push('senderVolume');if(scenario==='sender_throw')throw Error('PRIVATE sender failure');return {status:senderCases[scenario]??'idle'};},recoverTextDeliveryReceipts:async()=>({status:'idle',errors:0}),
  processBuyerCallPackages:async()=>({errors:0}),dispatchTextMessage:()=>assert.fail('No buyer provider'),
  processSupportCustomerNotifications:async()=>({failed:0}),recoverAccessHelpReplies:async()=>0,processSupportOwnerNotifications:async()=>({failed:0}),
  processPurchaseAccessEmails:async()=>({ready:true,failed:0}),processPurchaseAccessFollowups:async()=>({ready:true,failed:0}),
  outbound:task('outbound'),recording:task('recording'),ownerRecording:task('ownerRecording'),reception:task('reception'),
 };
 for(const [name,service] of Object.entries(services))deps[service]=async()=>{
  started.push(name);await wait;finished.add(name);
  if(scenario===name)throw Error('PRIVATE recovery details');
  const result=scenario==='waiting'?legitimateWaits[name]:scenario==='inventory_result'&&name==='inventory'?silentFailures.inventory:normal[name];
  if(name==='ownerTicketContinuation')return continueExpiredOwnerPreflightTicket(async()=>scenario.startsWith('continuation_')?
   {status:scenario.slice('continuation_'.length),ticketId:'90000000-0000-4000-8000-000000000001',preflightId:'90000000-0000-4000-8000-000000000002',receipt:'PRIVATE continuation evidence'}:result);
  return result;
 };
 const route=await loadService('app/api/internal/maintenance/route.ts',deps);
 assert.equal((await route.GET(new Request('https://fixture.invalid'))).status,401);assert.deepEqual(started,[]);assert.deepEqual(logs,[]);
 authorized=true;const pending=route.GET(new Request('https://fixture.invalid'));
 await flush();
 const premature=monitored.length;
 assert(started.includes('outbound')&&started.includes('recording'),'Independent original-receipt work starts while research recovery waits');
 release();
 const response=await pending,body=await response.json();
 assert.equal(premature,0,'A healthy maintenance observation cannot precede recovery results');
 const healthy=['none','waiting','pruning','sender_hold','sender_unknown','sender_disabled',...continuationCases.map(status=>'continuation_'+status)].includes(scenario);
 assert.deepEqual(monitored,[healthy],scenario);
 assert.equal(response.status,healthy?200:503,scenario);
 for(const name of Object.keys(normal)){
  assert.equal(started.filter(value=>value===name).length,1,'No retry: '+name);
  assert.equal(body.lanes[name].ok,scenario!==name&&!(scenario==='inventory_result'&&name==='inventory')&&!(scenario==='continuation_invalid'&&name==='ownerTicketContinuation'),name);
 }
 assert.equal(started.filter(value=>value==='senderVolume').length,1,'No repeat of a deferred sender attempt');
 assert.equal(body.lanes.senderVolume.ok,!['sender_config','sender_verification','sender_invitation','sender_throw'].includes(scenario));
 assert.equal(response.headers.get('cache-control'),'private, no-store');
 // Existing response evidence remains authenticated; the single operational
 // log must never include original IDs, receipts or arbitrary error strings.
 const expectedStatus=['ownerTicketContinuation','continuation_invalid'].includes(scenario)?'continuation_unavailable':scenario==='waiting'?'busy':scenario.startsWith('continuation_')?scenario.slice('continuation_'.length):'disabled';
 assert.deepEqual(logs,[['owner_ticket_continuation',{status:expectedStatus}]],'One fixed status-only log per authorized cycle');
 assert(!JSON.stringify(logs).includes('PRIVATE'));
 if(!scenario.startsWith('continuation_'))assert(!JSON.stringify(body).includes('PRIVATE'));
}
console.log('PASS maintenance awaits all recovery evidence, exposes independent failures, preserves legitimate holds and never replays work.');
