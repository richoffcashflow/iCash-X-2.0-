import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {activeOwnerColumns,activeOwnerExportRequest,recoverOwnerActiveExports} from '../lib/owner-active-export.ts';
import {cleanupOwnerPreflight} from '../lib/owner-export-preflight.ts';
import {maintenanceBatch} from '../lib/maintenance-batch.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';

const account='00000000-0000-4000-8000-000000000001',batch='00000000-0000-4000-8000-000000000002';
const request='00000000-0000-4000-8000-000000000003',lease='00000000-0000-4000-8000-000000000004';
const raw={export_id:'original-fixture',record_count:1,file_count:1,credits:{used:1,people:1}};
const fields={internal_person_id:'1',person_full_name:'Fixture',phone_1:'2145550100',is_phone_1_dnc:'No',people_phone_1_type_id:'Wireless',has_active_phone_number:'Yes'};
const csv=activeOwnerColumns.join(',')+'\n'+activeOwnerColumns.map(k=>fields[k]??'').join(',')+'\n';
const original={id:batch,accountId:account,createdAt:new Date().toISOString(),items:[{screeningId:'screen',snapshot:{propertyId:'prop_1'},ids:['per_1']}],
 preview:{data:[{dm_property_id:'prop_1',found:true,contacts:[{dm_person_id:'per_1',contact_type:'owner',availability:{phones:1}}]}],credits:{used:0,people:0,properties:0,deduplicated:0}},
 request:activeOwnerExportRequest(['per_1']),receipt:{httpStatus:200,raw,rawText:JSON.stringify(raw)},recovery:null,csv:null,lease,localOnly:false,atomicRecovery:true,quotaRequestId:request};

function exportFixture({stage,ack='throw',origin='atomic',provider='ok'}={}){
 let claimed=false;const calls=[],writes=[],admissions=[];
 const saved=structuredClone(original);
 if(origin!=='atomic'){delete saved.atomicRecovery;delete saved.quotaRequestId;}
 if(origin==='local')Object.assign(saved,{localOnly:true,csv,artifactSha256:createHash('sha256').update(csv).digest('hex'),
  recoveryHttpStatus:200,terminalAt:saved.createdAt,recovery:{data:{export_id:raw.export_id,status:'completed',record_count:1}}});
 const before=structuredClone(saved);
 const db=async(path,_method,body)=>{
  if(path==='rpc/icash_claim_owner_export_recovery'){if(claimed)return null;claimed=true;return saved;}
  if(path==='rpc/icash_claim_owner_export_quota_recovery')return null;
  if(path==='rpc/icash_take_dealmachine_request'){admissions.push(body);return true;}
  if(path==='rpc/icash_finish_dealmachine_request')return true;
  if(['rpc/icash_record_owner_export_quota_recovery','rpc/icash_record_owner_export_recovery','rpc/icash_record_owner_export_artifact','rpc/icash_save_owner_active_export'].includes(path)){
   writes.push({path,body:structuredClone(body)});
   const writeStage=path.includes('artifact')?'artifact':path.includes('save_owner')?'contacts':'receipt';
   if(writeStage===stage){if(ack==='throw')throw Error('private persistence outage');return ack==='false'?false:null;}
   return true;
  }
  assert.fail('Unexpected DB '+path);
 };
 const transport=async(url,options)=>{
  assert.equal(options.method,'GET');calls.push(String(url));
  if(provider==='timeout')throw Error('private provider timeout');
  if(String(url).startsWith('https://storage.googleapis.com/'))return new Response(csv);
  assert.equal(url,'https://api.v2.dealmachine.com/v1/exports/original-fixture');
  return Response.json({data:{export_id:provider==='mismatch'?'another-export':raw.export_id,status:'completed',record_count:1,download_urls:[{url:'https://storage.googleapis.com/fixture.csv'}]}});
 };
 return {calls,writes,admissions,saved,before,run:()=>recoverOwnerActiveExports(db,transport)};
}

function cleanupFixture({acks=[true],provider='ok'}={}){
 let claimed=false;const calls=[],writes=[];
 const db=async(path,_method,body)=>{
  if(path==='rpc/icash_claim_owner_preflight_cleanup'){if(claimed)return null;claimed=true;return {id:batch,token:lease,listId:'original-list',accountId:account};}
  if(path==='rpc/icash_take_dealmachine_request'||path==='rpc/icash_finish_dealmachine_request')return true;
  if(path==='rpc/icash_record_owner_preflight_cleanup'){
   writes.push(structuredClone(body));const ack=acks[Math.min(writes.length-1,acks.length-1)];
   if(ack==='throw')throw Error('private cleanup save failure');return ack;
  }
  assert.fail('Unexpected DB '+path);
 };
 const transport=async(url,options)=>{
  assert.equal(url,'https://api.v2.dealmachine.com/v1/lists/original-list');assert.equal(options.method,'DELETE');calls.push(String(url));
  if(provider==='timeout')throw Error('private provider timeout');
  return Response.json({data:{deleted:true}});
 };
 return {calls,writes,run:()=>cleanupOwnerPreflight(db,transport)};
}

async function maintenance(lane,run){
 let healthy=null;const independent=[];
 const ok=name=>async()=>{independent.push(name);return new Response();};
 const deps={
  authorizeOutboundBilling:()=>true,process:{env:{}},db:async()=>0,maintenanceBatch,
  refreshReliability:async(_db,value)=>{healthy=value;return true;},pruneUsageLoopObservations:async()=>{},
  applyApprovedFullBusinessVoiceCapacity:async()=>({status:'awaiting_activation'}),applyApprovedProVoiceCapacity:async()=>({status:'already_verified'}),applyApprovedEightyPercentVoiceCapacity:async()=>({status:'already_verified'}),
  refreshVoiceCapacity:async()=>({status:'verified'}),readVoiceCapacityProvider:async()=>assert.fail('No live provider'),readRecordingReview:()=>null,recoverVoiceConfiguration:async()=>({status:'idle'}),
  refreshInventoryGeographyBatch:async()=>({pages:[{status:'not_due'}]}),drainResearchExclusions:async()=>({status:'not_due'}),
  recoverOwnerActiveExports:async()=>({status:'export_recovery_idle'}),recoverOwnerExportCapacity:async()=>({status:'capacity_review_idle'}),
  cleanupOwnerPreflight:async()=>({status:'idle'}),continueExpiredOwnerPreflightTicket:async()=>({status:'disabled'}),retryVolumeDeferredText:async()=>({status:'idle'}),
  processBuyerCallPackages:async()=>({errors:0}),dispatchTextMessage:()=>assert.fail('No buyer provider'),
  recoverTextDeliveryReceipts:async()=>({status:'idle',errors:0}),processSupportCustomerNotifications:async()=>({failed:0}),recoverAccessHelpReplies:async()=>0,
  processSupportOwnerNotifications:async()=>({failed:0}),processPurchaseAccessEmails:async()=>({ready:true,failed:0}),processPurchaseAccessFollowups:async()=>({ready:true,failed:0}),
  outbound:ok('outbound'),recording:ok('recording'),ownerRecording:ok('ownerRecording'),reception:ok('reception'),
 };
 deps[lane==='ownerExports'?'recoverOwnerActiveExports':'cleanupOwnerPreflight']=run;
 const route=await loadService('app/api/internal/maintenance/route.ts',deps);
 const response=await route.GET(new Request('https://fixture.test'));
 return {response,body:await response.json(),healthy,independent};
}
function assertHealth(r,lane,status){
 const unavailable=status.endsWith('_unavailable');
 assert.equal(r.body[lane].status,status);assert.equal(r.response.status,unavailable?503:200);
 assert.equal(r.body.lanes[lane].ok,!unavailable);assert.equal(r.healthy,!unavailable);
 assert.deepEqual(r.independent.sort(),['outbound','ownerRecording','reception','recording']);
 assert.doesNotMatch(JSON.stringify(r.body),/fixture|private|original-list/);
}

const previousKey=process.env.DEALMACHINE_API_KEY,previousWarn=console.warn;
process.env.DEALMACHINE_API_KEY='dm_sk_live_fixture';console.warn=()=>{};
try{
 for(const origin of ['atomic','legacy','local'])for(const stage of origin==='local'?['contacts']:['receipt','artifact','contacts'])for(const ack of ['throw','null','false']){
  const f=exportFixture({origin,stage,ack}),r=await maintenance('ownerExports',f.run);
  assertHealth(r,'ownerExports',ack==='false'?'export_receipt_held':'export_recovery_unavailable');
  assert.equal(f.calls.length,origin==='local'?0:stage==='receipt'?1:2);
  assert.equal(f.admissions.length,origin==='legacy'?1:0);
  assert.equal(f.writes.length,origin==='local'?1:['receipt','artifact','contacts'].indexOf(stage)+1);
  assert.deepEqual(f.saved,f.before,'Original source and receipt remain unchanged');
  const count=f.calls.length;await f.run();assert.equal(f.calls.length,count,'No replay after original claim');
 }
 for(const [options,status,getCount] of [[{},'contacts_saved',2],[{origin:'local'},'contacts_saved',0],[{provider:'timeout'},'export_receipt_held',1],[{provider:'mismatch'},'export_receipt_held',1]]){
  const f=exportFixture(options);assertHealth(await maintenance('ownerExports',f.run),'ownerExports',status);assert.equal(f.calls.length,getCount);
 }
 for(const [options,status,writes] of [
  [{acks:['throw']},'cleanup_unavailable',4], [{acks:[null]},'cleanup_unavailable',1], [{acks:[false]},'held',1],
  [{acks:['throw',true]},'checked',2], [{acks:['throw',false]},'held',2],
  [{acks:['throw','throw',true]},'pending',3], [{acks:['throw','throw','throw',true]},'pending',4],
  [{provider:'timeout',acks:[true]},'pending',1], [{provider:'timeout',acks:['throw']},'cleanup_unavailable',2],
  [{provider:'timeout',acks:['throw',false]},'held',2], [{},'checked',1],
 ]){
  const f=cleanupFixture(options);assertHealth(await maintenance('ownerPreflightCleanup',f.run),'ownerPreflightCleanup',status);
  assert.equal(f.calls.length,1);assert.equal(f.writes.length,writes);
  for(const write of f.writes)assert.deepEqual(write,f.writes[0],'Bounded acknowledgment recovery retains identical original receipt');
  await f.run();assert.equal(f.calls.length,1,'No second DELETE after consumed original claim');
 }
 console.log('PASS original export and cleanup persistence failures reach actual maintenance health; false holds, canonical save acknowledgments, original receipts, local-only recovery and independent lanes preserved.');
}finally{console.warn=previousWarn;if(previousKey===undefined)delete process.env.DEALMACHINE_API_KEY;else process.env.DEALMACHINE_API_KEY=previousKey;}
