import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {maintenanceBatch} from '../lib/maintenance-batch.ts';

const normal={
 inventory:{pages:[{status:'not_due'}]},researchExclusions:{status:'not_due'},
 ownerExports:{status:'export_recovery_idle'},ownerExportCapacity:{status:'capacity_review_idle'},
 ownerPreflightCleanup:{status:'idle'},
};
const legitimateWaits={
 inventory:{pages:[{status:'rate_limited'}]},researchExclusions:{status:'pending'},
 ownerExports:{status:'export_receipt_held'},ownerExportCapacity:{status:'capacity_review_held'},
 ownerPreflightCleanup:{status:'pending'},
};
const silentFailures={inventory:{pages:[{status:'metadata_unavailable'}]}};
const services={inventory:'refreshInventoryGeographyBatch',researchExclusions:'drainResearchExclusions',
 ownerExports:'recoverOwnerActiveExports',ownerExportCapacity:'recoverOwnerExportCapacity',ownerPreflightCleanup:'cleanupOwnerPreflight'};
const senderCases={
 sender_config:'messaging_configuration_required',sender_verification:'business_number_verification_required',sender_invitation:'inbound_invitation_not_ready',
 sender_hold:'message_held',sender_unknown:'message_delivery_needs_review',sender_disabled:'live_work_not_ready',
};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
for(const scenario of ['none','waiting','inventory_result',...Object.keys(normal),'pruning',...Object.keys(senderCases),'sender_throw']){
 const started=[],finished=new Set(),monitored=[];let authorized=false,release;
 const wait=new Promise(resolve=>{release=resolve;});
 const task=name=>async()=>{started.push(name);return new Response();};
 const deps={
  db:async()=>0,maintenanceBatch,authorizeOutboundBilling:()=>authorized,process:{env:{}},
  refreshReliability:async(_db,ok)=>{monitored.push(ok);for(const name of Object.keys(normal))assert(finished.has(name),'Health must wait for '+name);return true;},
  pruneUsageLoopObservations:async()=>{started.push('pruning');if(scenario==='pruning')throw Error('PRIVATE telemetry');},
  readRecordingReview:()=>null,applyApprovedProVoiceCapacity:async()=>({status:'already_verified'}),
  applyApprovedEightyPercentVoiceCapacity:async()=>({status:'awaiting_activation'}),
  refreshVoiceCapacity:async()=>({status:'verified'}),readVoiceCapacityProvider:()=>assert.fail('No network'),recoverVoiceConfiguration:async()=>({status:'idle',requeued:0}),
  retryVolumeDeferredText:async()=>{started.push('senderVolume');if(scenario==='sender_throw')throw Error('PRIVATE sender failure');return {status:senderCases[scenario]??'idle'};},recoverTextDeliveryReceipts:async()=>({status:'idle',errors:0}),
  processSupportCustomerNotifications:async()=>({failed:0}),recoverAccessHelpReplies:async()=>0,processSupportOwnerNotifications:async()=>({failed:0}),
  processPurchaseAccessEmails:async()=>({ready:true,failed:0}),processPurchaseAccessFollowups:async()=>({ready:true,failed:0}),
  outbound:task('outbound'),recording:task('recording'),ownerRecording:task('ownerRecording'),reception:task('reception'),
 };
 for(const [name,service] of Object.entries(services))deps[service]=async()=>{
  started.push(name);await wait;finished.add(name);
  if(scenario===name)throw Error('PRIVATE recovery details');
  return scenario==='waiting'?legitimateWaits[name]:scenario==='inventory_result'&&name==='inventory'?silentFailures.inventory:normal[name];
 };
 const route=await loadService('app/api/internal/maintenance/route.ts',deps);
 assert.equal((await route.GET(new Request('https://fixture.invalid'))).status,401);assert.deepEqual(started,[]);
 authorized=true;const pending=route.GET(new Request('https://fixture.invalid'));
 await flush();
 const premature=monitored.length;
 assert(started.includes('outbound')&&started.includes('recording'),'Independent original-receipt work starts while research recovery waits');
 release();
 const response=await pending,body=await response.json();
 assert.equal(premature,0,'A healthy maintenance observation cannot precede recovery results');
 const healthy=['none','waiting','pruning','sender_hold','sender_unknown','sender_disabled'].includes(scenario);
 assert.deepEqual(monitored,[healthy],scenario);
 assert.equal(response.status,healthy?200:503,scenario);
 for(const name of Object.keys(normal)){
  assert.equal(started.filter(value=>value===name).length,1,'No retry: '+name);
  assert.equal(body.lanes[name].ok,scenario!==name&&!(scenario==='inventory_result'&&name==='inventory'),name);
 }
 assert.equal(started.filter(value=>value==='senderVolume').length,1,'No repeat of a deferred sender attempt');
 assert.equal(body.lanes.senderVolume.ok,!['sender_config','sender_verification','sender_invitation','sender_throw'].includes(scenario));
 assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert(!JSON.stringify(body).includes('PRIVATE'));
}
console.log('PASS maintenance awaits all recovery evidence, exposes independent failures, preserves legitimate holds and never replays work.');
