import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {maintenanceBatch} from '../lib/maintenance-batch.ts';
import {refreshReliability} from '../lib/reliability-monitor.ts';
import {pruneUsageLoopObservations} from '../lib/usage-loop-tracking.ts';

const original=console.error,logs=[];console.error=(...args)=>logs.push(args);
const priorEnv={VERCEL_ENV:process.env.VERCEL_ENV,ICASH_RELIABILITY_EMAIL_ENABLED:process.env.ICASH_RELIABILITY_EMAIL_ENABLED};
process.env.VERCEL_ENV='production';process.env.ICASH_RELIABILITY_EMAIL_ENABLED='false';
try{
 for(const failure of ['none','voice_read','pro_change','capacity_change','voice_recovery','voice_review','text_configuration','research_repair','research_repair_and_snapshot','external_monitor']){
  const stages=[],heartbeats=[];let authorized=false,releaseVoice;
  const voiceWait=new Promise(resolve=>{releaseVoice=resolve;});
  const db=async(path,_method,body)=>{
   stages.push(path);
   if(path.startsWith('icash_integration_checks?'))return failure==='external_monitor'?[{checked_at:'2020-01-01T00:00:00Z',result:{observedAt:'2020-01-01T00:00:00Z',releaseSha:'a'.repeat(40),intervalMs:60000}}]:[];
   if(path==='rpc/icash_close_inactive_support')return 0;
   if(path==='rpc/icash_record_service_heartbeat'){heartbeats.push(body.p_status);return null;}
   if(path==='rpc/icash_repair_expired_research_configs'&&failure.startsWith('research_repair'))throw Error('private database details');
   if(path==='rpc/icash_refresh_account_work_snapshot'){
    if(failure==='research_repair_and_snapshot')throw Error('private snapshot');
    return {issueCount:0};
   }
   if(path==='rpc/icash_refresh_reliability_incident'){
    assert.equal(body.p_configuration,'disabled');
    assert.equal(heartbeats.at(-1),failure==='none'?'ok':'degraded','Incident observation sees this cycle\'s actual failures');
    return false;
   }
   return null;
  };
  const task=name=>async()=>{stages.push(name);return new Response();};
  const route=await loadService('app/api/internal/maintenance/route.ts',{
   db,maintenanceBatch,refreshReliability,pruneUsageLoopObservations,
   authorizeOutboundBilling:()=>authorized,process:{env:{}},readRecordingReview:()=>null,
   applyApprovedProVoiceCapacity:async()=>{stages.push('pro_change');if(failure==='pro_change')throw Error('private pro failure');return {status:'already_verified'};},
   applyApprovedEightyPercentVoiceCapacity:async()=>{stages.push('capacity_change');if(failure==='capacity_change')throw Error('private change failure');return {status:'awaiting_activation'};},
   refreshVoiceCapacity:async(_db,_reader,_review,onAgent)=>{stages.push('voice_read');await voiceWait;if(failure==='voice_read')throw Error('private provider');await onAgent({});return {status:'verified'};},
   readVoiceCapacityProvider:async()=>assert.fail('No live provider'),
   recoverVoiceConfiguration:async()=>{stages.push('voice_recovery');if(failure==='voice_recovery')throw Error('private recovery');return {status:failure==='voice_review'?'review_required':'idle',requeued:0};},
   refreshInventoryGeographyBatch:async()=>({pages:[{status:'not_due'}]}),drainResearchExclusions:async()=>({status:'not_due'}),
   recoverOwnerActiveExports:async()=>({status:'export_recovery_idle'}),recoverOwnerExportCapacity:async()=>({status:'capacity_review_idle'}),cleanupOwnerPreflight:async()=>({status:'not_due'}),
   retryVolumeDeferredText:async()=>{stages.push('senderVolume');return {status:'idle'};},
   recoverTextDeliveryReceipts:async()=>({status:failure==='text_configuration'?'configuration_unavailable':'idle',errors:0}),
   processSupportCustomerNotifications:async()=>({failed:0}),recoverAccessHelpReplies:async()=>0,processSupportOwnerNotifications:async()=>({failed:0}),
   processPurchaseAccessEmails:async()=>({ready:true,failed:0}),processPurchaseAccessFollowups:async()=>({ready:true,failed:0}),
   outbound:task('outbound'),recording:task('recording'),ownerRecording:task('ownerRecording'),reception:task('reception'),
  });
  assert.equal((await route.GET(new Request('https://fixture.test'))).status,401);assert.deepEqual(stages,[]);
  authorized=true;
  const pending=route.GET(new Request('https://fixture.test'));
  await new Promise(resolve=>setImmediate(resolve));
  assert(stages.includes('recording')&&stages.includes('outbound'),'A pending voice check does not block independent recovery');
  assert.equal(heartbeats.length,0,'Maintenance cannot declare health before required voice checks finish');
  releaseVoice();
  const response=await pending,body=await response.json();
  assert.equal(response.status,failure==='none'?200:503,failure);
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal(stages.filter(s=>s==='voice_read').length,1,'Provider change failure still permits one fresh capacity read');
  assert.equal(stages.filter(s=>s==='rpc/icash_refresh_reliability_incident').length,1,'Incident observation survives failed recovery');
  assert.equal(stages.filter(s=>s==='rpc/icash_refresh_account_work_snapshot').length,1,'Snapshot remains independent');
  assert.equal(body.lanes.capacity.ok,!['voice_read','pro_change','capacity_change','voice_recovery','voice_review'].includes(failure));
  assert.equal(body.lanes.textReceipts.ok,failure!=='text_configuration');
  assert.equal(body.monitored,!failure.startsWith('research_repair')&&failure!=='external_monitor');
  for(const lane of ['outbound','recording','ownerRecording','reception','senderVolume'])assert.equal(body.lanes[lane].ok,true);
 }
 assert(!JSON.stringify(logs).includes('private'),'Only fixed diagnostics leave failure boundaries');
 console.log('PASS maintenance actual-route failure health, concurrency, authorization and independent recovery.');
}finally{
 console.error=original;
 for(const [key,value] of Object.entries(priorEnv))if(value===undefined)delete process.env[key];else process.env[key]=value;
}
