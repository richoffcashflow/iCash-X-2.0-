import assert from 'node:assert/strict';
import {refreshReliability} from '../lib/reliability-monitor.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {maintenanceBatch} from '../lib/maintenance-batch.ts';
import {pruneUsageLoopObservations} from '../lib/usage-loop-tracking.ts';
const original=console.error;const logs=[];console.error=v=>logs.push(v);
try{
 let calls=[];
 const db=async(path,method,body)=>{calls.push({path,body});return path.startsWith('icash_integration_checks?')?[]:path.endsWith('snapshot')?{issueCount:2}:null;};
 assert.equal(await refreshReliability(db,false),true);assert.equal(calls[0].body.p_status,'degraded');assert.equal(logs.length,1);
 assert.equal(calls[1].path,'rpc/icash_repair_expired_research_configs');
 assert.equal(calls[2].path,'rpc/icash_refresh_account_work_snapshot','account stalls cannot hide behind healthy worker checks or reviewed historical receipts');
 assert.equal(await refreshReliability(async()=>{throw Error('secret')},true),false);assert(!logs.join('').includes('secret'));
 // Exercise the real alert dispatcher through its incident RPC with delivery
 // disabled. No owner email/provider request is allowed in these fixtures.
 const priorProduction=process.env.VERCEL_ENV,priorAlerts=process.env.ICASH_RELIABILITY_EMAIL_ENABLED;
 process.env.VERCEL_ENV='production';process.env.ICASH_RELIABILITY_EMAIL_ENABLED='false';
 try{
  for(const failure of ['heartbeat','snapshot','invalid_snapshot','snapshot_and_degraded_heartbeat','incident']){
   const stages=[];let heartbeat='ok',heartbeatWrites=0;
   const savedSnapshot={checkedAt:'2026-01-01T00:00:00Z',issueCount:0};
   const evidence=JSON.stringify(savedSnapshot);
   const monitorDb=async(path,method,body)=>{
    stages.push(path);if(path.startsWith('icash_integration_checks?')){assert.equal(method,'GET');return [];}
    assert.equal(method,'POST');
    if(path==='rpc/icash_record_service_heartbeat'){
     heartbeatWrites++;
     if(failure==='heartbeat'||failure==='snapshot_and_degraded_heartbeat'&&heartbeatWrites===2)throw Error('private heartbeat failure');
     heartbeat=body.p_status;return null;
    }
    if(path==='rpc/icash_repair_expired_research_configs')return 0;
    if(path==='rpc/icash_refresh_account_work_snapshot'){
     if(failure.startsWith('snapshot'))throw Error('private snapshot failure');
     return failure==='invalid_snapshot'?{issueCount:'invalid'}:{issueCount:0};
    }
    if(path==='rpc/icash_refresh_reliability_incident'){
     assert.equal(body.p_configuration,'disabled');
     assert.equal(JSON.stringify(savedSnapshot),evidence,'A refresh failure never invents or replaces persisted snapshot evidence');
     if(['snapshot','invalid_snapshot'].includes(failure))assert.equal(heartbeat,'degraded','Current failure cannot look recovered from an older healthy snapshot');
     if(failure==='incident')throw Error('private incident failure');
     return false;
    }
    assert.fail('Unexpected monitor/provider action '+path);
   };
   assert.equal(await refreshReliability(monitorDb,true),false,'Heartbeat/snapshot/incident observation failure remains an unsuccessful monitor cycle');
   assert(stages.includes('rpc/icash_repair_expired_research_configs'),'A heartbeat failure cannot suppress independent recovery');
   assert(stages.includes('rpc/icash_refresh_account_work_snapshot'),'A heartbeat failure cannot suppress snapshot work');
   assert.equal(stages.filter(path=>path==='rpc/icash_refresh_reliability_incident').length,1,'Incident observation still runs once after heartbeat/snapshot/degraded-write failure');
   assert.equal(heartbeatWrites,['snapshot','invalid_snapshot','snapshot_and_degraded_heartbeat'].includes(failure)?2:1);
  }
  assert(!logs.join('').includes('private'),'Only fixed monitor diagnostics leave the failure boundary');
 }finally{
  if(priorProduction===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=priorProduction;
  if(priorAlerts===undefined)delete process.env.ICASH_RELIABILITY_EMAIL_ENABLED;else process.env.ICASH_RELIABILITY_EMAIL_ENABLED=priorAlerts;
 }
 let authorized=false,ran=0,recovered=0,preflightCleanups=0,textReceiptErrors=0,capacityChangeFails=false,capacityChangeAttempts=0;
 const route=await loadService('app/api/internal/maintenance/route.ts',{retryVolumeDeferredText:async()=>{ran++;if(textReceiptErrors)throw Error('fixture retry unavailable');return {status:'idle'};},recoverTextDeliveryReceipts:async actualDb=>{assert.equal(actualDb,db);ran++;return {status:'checked',errors:textReceiptErrors};},processSupportCustomerNotifications:async()=>{ran++;return {state:'ready',failed:0};},recoverAccessHelpReplies:async()=>{recovered++;return 0;},processSupportOwnerNotifications:async()=>{ran++;return {state:'ready',failed:0};},processPurchaseAccessEmails:async()=>{ran++;return {ready:true,failed:0};},processPurchaseAccessFollowups:async()=>{ran++;return {ready:true,failed:0};},refreshInventoryGeographyBatch:async()=>({pages:[{status:'not_due'}]}),applyApprovedProVoiceCapacity:async()=>({status:'already_verified'}),applyApprovedEightyPercentVoiceCapacity:async()=>{capacityChangeAttempts++;if(capacityChangeFails)throw Error('private capacity change failure');return {status:'awaiting_activation'};},refreshVoiceCapacity:async()=>({status:'verified',workspaceLimit:4,agents:1}),readRecordingReview:()=>null,readVoiceCapacityProvider:async()=>{throw Error('Unexpected provider request');},authorizeOutboundBilling:()=>authorized,process:{env:{}},maintenanceBatch,refreshReliability,pruneUsageLoopObservations,db,
  recoverOwnerActiveExports:async()=>({status:'export_recovery_idle'}),recoverOwnerExportCapacity:async()=>({status:'capacity_review_idle'}),cleanupOwnerPreflight:async()=>{preflightCleanups++;throw Error('private cleanup failure');},drainResearchExclusions:async()=>({status:'not_due'}),outbound:async()=>{ran++;throw Error('Temporary outage');},recording:async()=>{ran++;return new Response();},ownerRecording:async()=>{ran++;return new Response();},reception:async()=>{ran++;return new Response();}});
 assert.equal((await route.GET(new Request('https://fixture.test'))).status,401);assert.equal(ran,0);assert.equal(recovered,0);assert.equal(preflightCleanups,0);assert.equal(capacityChangeAttempts,0);
 authorized=true;calls=[];const result=await route.GET(new Request('https://fixture.test'));assert.equal(result.status,503);const body=await result.json();assert.equal(body.capacity.status,'verified');assert.equal(body.capacity.eightyPercentChange.status,'awaiting_activation');assert.equal(capacityChangeAttempts,1);assert.equal(body.ownerPreflightCleanup.status,'cleanup_pending');assert.equal(preflightCleanups,1);assert.deepEqual(body.lanes.senderVolume,{ok:true,status:200});assert.equal(ran,10,'One failed lane cannot suppress other maintenance');assert.deepEqual(body.lanes.textReceipts,{ok:true,status:200});assert.equal(recovered,1,'Authorized maintenance recovers unanswered support');
 assert.equal(calls.find(call=>call.path==='rpc/icash_record_service_heartbeat').body.p_status,'degraded');
 assert.equal(calls.filter(call=>call.path==='rpc/icash_prune_usage_loop_observations').length,1,'Authorized maintenance includes optional retention cleanup');
 textReceiptErrors=1;capacityChangeFails=true;calls=[];const receiptFailure=await route.GET(new Request('https://fixture.test'));
 assert.equal(receiptFailure.status,503);const failedBody=await receiptFailure.json();assert.deepEqual(failedBody.lanes.textReceipts,{ok:false,status:503});assert.equal(failedBody.capacity.status,'verified','A failed one-use provider change cannot suppress fresh capacity reads');assert.equal(failedBody.capacity.eightyPercentChange.status,'verification_unavailable');assert.equal(capacityChangeAttempts,2);assert(!logs.join('').includes('private capacity'));
 assert.deepEqual(failedBody.lanes.senderVolume,{ok:false,status:503});assert.equal(ran,20,'Receipt write failures do not suppress the other maintenance lanes');
 assert.equal(calls.find(call=>call.path==='rpc/icash_record_service_heartbeat').body.p_status,'degraded');
 console.log('PASS maintenance authorization, independent lanes, persisted status, bounded snapshot and safe logs.');
}finally{console.error=original;}
