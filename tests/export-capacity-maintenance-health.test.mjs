import assert from 'node:assert/strict';
import {recoverOwnerExportCapacity} from '../lib/owner-export-capacity-recovery.ts';
import {maintenanceBatch} from '../lib/maintenance-batch.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';

// Actual capacity services and maintenance route, with isolated original-claim
// receipts. No provider/network, production database or historical replay.
function fixture({automatic=true,save='ok',saveProbe='inventory',provider='ok',final='normal',result,claimThrows,claimHeld}={}){
 let consumed=false,finals=0,manualClaims=0;
 const gets=[],writes=[],saved=new Map(),metrics=[];
 const env={VERCEL_ENV:'production',DEALMACHINE_API_KEY:'dm_sk_live_fixture',...(automatic?{VERCEL_GIT_COMMIT_SHA:'a'.repeat(40)}:{})};
 const db=async(path,method,body)=>{
  assert.equal(method,'POST');
  if(path==='rpc/icash_claim_automatic_export_capacity'){
   if(consumed)return null;consumed=true;return {reviewId:'fixture-review',requestId:'inventory'};
  }
  if(path==='rpc/icash_claim_export_capacity_review'){
   manualClaims++;
   if(automatic||consumed)return null;consumed=true;return {reviewId:'fixture-review',requestId:'inventory'};
  }
  if(path==='rpc/icash_claim_export_capacity_probe'){
   if(claimThrows===body.p_probe)throw Error('private claim failure');
   return claimHeld===body.p_probe?null:body.p_probe;
  }
  if(['rpc/icash_record_export_capacity_probe','rpc/icash_record_export_capacity_review'].includes(path)){
   const probe=body.p_probe??'inventory';writes.push(structuredClone(body));
   if(probe===saveProbe){
    if(save==='throw')throw Error('private database failure');
    if(save==='null')return null;
    if(save==='false')return automatic?false:'held';
   }
   if(saved.has(probe))assert.deepEqual(saved.get(probe),body.p_receipt,'Identical original receipt only');
   saved.set(probe,structuredClone(body.p_receipt));
   if(probe===saveProbe&&save==='committed_lost')throw Error('private lost response');
   return automatic?true:(result??(provider==='ok'?'capacity_verified':'held'));
  }
  if(path==='rpc/icash_finish_dealmachine_request'){metrics.push(body);return true;}
  if(path==='rpc/icash_finish_automatic_export_capacity'){
   finals++;
   if(final==='throw'||final==='lost_once'&&finals===1)throw Error('private finalizer failure');
   if(final==='null')return null;
   return result??(saved.size===3&&[...saved.values()].every(x=>x.httpStatus===200)?'capacity_verified':'capacity_review_held');
  }
  assert.fail('Unexpected mutation '+path);
 };
 const transport=async(url,options)=>{
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
  const parsed=new URL(url);assert.equal(parsed.origin,'https://api.v2.dealmachine.com');assert.equal(parsed.pathname,'/v1/exports');
  const probe=parsed.searchParams.get('status')??'inventory';gets.push(probe);
  if(provider==='timeout')throw Error('private provider failure');
  if(provider==='oversize')return new Response('x'.repeat(1048577));
  return Response.json({data:[],pagination:{limit:100,offset:0,total:0,has_more:false}},{headers:{'X-RateLimit-Remaining':'49','X-RateLimit-Day-Remaining':'5000'}});
 };
 return {gets,writes,saved,metrics,finals:()=>finals,manualClaims:()=>manualClaims,run:()=>recoverOwnerExportCapacity(db,transport,env)};
}

async function maintenance(recover){
 let healthy=null;const independent=[];
 const ok=name=>async()=>{independent.push(name);return new Response();};
 const route=await loadService('app/api/internal/maintenance/route.ts',{
  authorizeOutboundBilling:()=>true,process:{env:{}},db:async()=>0,maintenanceBatch,
  refreshReliability:async(_db,value)=>{healthy=value;return true;},pruneUsageLoopObservations:async()=>{},
  applyApprovedProVoiceCapacity:async()=>({status:'already_verified'}),applyApprovedEightyPercentVoiceCapacity:async()=>({status:'already_verified'}),
  refreshVoiceCapacity:async()=>({status:'verified'}),readVoiceCapacityProvider:async()=>assert.fail('No live provider'),readRecordingReview:()=>null,recoverVoiceConfiguration:async()=>({status:'idle'}),
  refreshInventoryGeographyBatch:async()=>({pages:[{status:'not_due'}]}),drainResearchExclusions:async()=>({status:'not_due'}),
  recoverOwnerActiveExports:async()=>({status:'export_recovery_idle'}),recoverOwnerExportCapacity:recover,
  cleanupOwnerPreflight:async()=>({status:'idle'}),continueExpiredOwnerPreflightTicket:async()=>({status:'disabled'}),retryVolumeDeferredText:async()=>({status:'idle'}),
  processBuyerCallPackages:async()=>({errors:0}),dispatchTextMessage:()=>assert.fail('No buyer provider'),
  recoverTextDeliveryReceipts:async()=>({status:'idle',errors:0}),processSupportCustomerNotifications:async()=>({failed:0}),recoverAccessHelpReplies:async()=>0,
  processSupportOwnerNotifications:async()=>({failed:0}),processPurchaseAccessEmails:async()=>({ready:true,failed:0}),processPurchaseAccessFollowups:async()=>({ready:true,failed:0}),
  outbound:ok('outbound'),recording:ok('recording'),ownerRecording:ok('ownerRecording'),reception:ok('reception'),
 });
 const response=await route.GET(new Request('https://fixture.test'));
 return {response,body:await response.json(),healthy,independent};
}

const cases=[
 [{save:'throw'},'capacity_recovery_unavailable',1],
 [{save:'null'},'capacity_recovery_unavailable',1],
 [{save:'false'},'capacity_review_held',1],
 [{save:'throw',saveProbe:'pending'},'capacity_recovery_unavailable',3],
 [{save:'committed_lost',saveProbe:'pending'},'capacity_verified',3],
 [{final:'throw'},'capacity_recovery_unavailable',3],
 [{final:'null'},'capacity_recovery_unavailable',3],
 [{result:'capacity_review_held'},'capacity_review_held',3],
 [{claimThrows:'pending'},'capacity_recovery_unavailable',1],
 [{claimThrows:'processing'},'capacity_recovery_unavailable',2],
 [{claimHeld:'pending'},'capacity_review_held',1],
 [{claimHeld:'processing'},'capacity_review_held',2],
 [{final:'lost_once'},'capacity_verified',3],
 [{provider:'timeout'},'capacity_review_held',1],
 [{provider:'oversize'},'capacity_review_held',1],
 [{provider:'timeout',save:'throw'},'capacity_recovery_unavailable',1],
 [{automatic:false,save:'throw'},'capacity_recovery_unavailable',1],
 [{automatic:false,save:'null'},'capacity_recovery_unavailable',1],
 [{automatic:false,save:'false'},'capacity_review_held',1],
 [{automatic:false,provider:'timeout'},'capacity_review_held',1],
 [{automatic:false,provider:'oversize'},'capacity_review_held',1],
 [{automatic:false,provider:'timeout',save:'throw'},'capacity_recovery_unavailable',1],
 [{automatic:false},'capacity_verified',1],
];
for(const [options,status,getCount] of cases){
 const f=fixture(options),r=await maintenance(f.run),unavailable=status==='capacity_recovery_unavailable';
 assert.equal(r.body.ownerExportCapacity.status,status,JSON.stringify(options));
 assert.equal(r.response.status,unavailable?503:200);
 assert.equal(r.body.lanes.ownerExportCapacity.ok,!unavailable);
 assert.equal(r.healthy,!unavailable,'Unavailable receipt persistence reaches reliability monitoring');
 assert.deepEqual(r.independent.sort(),['outbound','ownerRecording','reception','recording']);
 assert.equal(f.gets.length,getCount);assert.equal(new Set(f.gets).size,getCount,'Never repeat a provider read');
 assert.equal(f.manualClaims(),options.automatic===false?1:0,'Automatic result must not fall through into manual recovery');
 assert(f.writes.length<=6);assert(f.finals()<=2);
 if(options.saveProbe==='pending')assert(f.saved.has('processing'),'Independent admitted probe finishes despite another save failure');
 if(options.claimThrows==='processing'||options.claimHeld==='processing')assert(f.saved.has('pending'),'Already-admitted probe finishes after a later claim fails');
 assert.doesNotMatch(JSON.stringify(r.body),/fixture|private/,'No source identities or database errors in health');
 await f.run();assert.equal(f.gets.length,getCount,'Consumed original claim is not replayed');
}
console.log('PASS export-capacity persistence failures reach actual maintenance health; canonical recovery, ordinary holds, independent lanes and original no-replay bounds remain intact.');
