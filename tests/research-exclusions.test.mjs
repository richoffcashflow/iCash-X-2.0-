import assert from 'node:assert/strict';
import {syncResearchExclusions} from '../lib/research-exclusions.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {maintenanceBatch} from '../lib/maintenance-batch.ts';
process.env.DEALMACHINE_API_KEY='dm_sk_live_LOCAL_FIXTURE';
const token='00000000-0000-4000-8000-000000000001',name='research-exclusions-'+token;
let claim={action:'create',token,name,listId:null,ids:[]},writes=[],calls=[],allowed=true,timeout=false,providerId='fixture-list',providerStatus='completed',wrongName=false;
const db=async(path,method,body)=>{
 if(path==='rpc/icash_claim_research_exclusions')return claim;
 if(path==='rpc/icash_take_dealmachine_request')return allowed;
 if(path==='rpc/icash_finish_dealmachine_request')return true;
 assert.equal(path,'rpc/icash_finish_research_exclusions');writes.push(body);return true;
};
const fetch=async(url,init)=>{
 calls.push({url,init});assert.equal(init.redirect,'error');if(timeout)throw Error('timeout');
 if(claim.action==='sync'){assert.deepEqual(JSON.parse(init.body),{ids:claim.ids.map(id=>Number(id.slice(5))),id_type:'internal_property_id',add_as_prospects:false});return Response.json({data:{added:0}});}
 const data={list_id:providerId,name:wrongName?'foreign':name,source_type:'properties',status:providerStatus,total_count:0};
 if(claim.action==='recover'){assert.equal(init.method,'GET');assert.equal(init.body,undefined);return Response.json({data:[data]});}
 assert.deepEqual(JSON.parse(init.body),{name,source_type:'properties',add_as_prospects:false});return Response.json({data});
};
allowed=false;assert.equal((await syncResearchExclusions(db,fetch)).status,'pending');assert.equal(calls.length,0);assert.equal(writes.at(-1).p_result.unstarted,true);
allowed=true;timeout=true;await syncResearchExclusions(db,fetch);assert.equal(calls.length,1);assert.equal(writes.at(-1).p_result.unstarted,false);
timeout=false;claim={...claim,action:'recover'};assert.equal((await syncResearchExclusions(db,fetch)).status,'synced');assert.equal(calls.at(-1).init.method,'GET');
providerId=42;providerStatus='pending';assert.equal((await syncResearchExclusions(db,fetch)).status,'synced');assert.equal(writes.at(-1).p_result.listId,'42','Documented numeric provider IDs normalize without losing exact identity');
wrongName=true;assert.equal((await syncResearchExclusions(db,fetch)).status,'pending','A different list cannot be adopted');wrongName=false;
providerId=-1;assert.equal((await syncResearchExclusions(db,fetch)).status,'pending','Invalid IDs cannot attach a list');providerId='fixture-list';
claim={...claim,action:'sync',listId:'fixture-list',ids:['prop_1']};assert.equal((await syncResearchExclusions(db,fetch)).status,'synced');assert.deepEqual(writes.at(-1).p_result.ids,['prop_1']);
claim={...claim,ids:['prop_9007199254740991']};assert.equal((await syncResearchExclusions(db,fetch)).status,'synced');assert.deepEqual(JSON.parse(calls.at(-1).init.body).ids,[9007199254740991]);assert.deepEqual(writes.at(-1).p_result.ids,claim.ids,'Persist original prefixed property identities');
for(const id of ['prop_9007199254740992','prop_0','prop_01']){claim={...claim,ids:[id]};const before=calls.length;assert.equal((await syncResearchExclusions(db,fetch)).status,'pending');assert.equal(calls.length,before,'Unsafe or ambiguous IDs never reach the provider');assert.equal(writes.at(-1).p_result.ok,false);}
claim=null;assert.equal((await syncResearchExclusions(db,fetch)).status,'not_due');
console.log('Exclusions: numeric/string list IDs, empty containers, exact identity, proven-unstarted quota deferral, unknown-create recovery and idempotent add passed.');

// The ordinary authenticated maintenance cycle must advance the free backfill
// even when no paid discovery is scheduled. No live provider calls are made.
let authorized=false,maintenanceRuns=0,claimUnavailable=false;
const maintenanceDb=async(path,method,body)=>{
 if(path==='rpc/icash_close_inactive_support')return true;
 if(claimUnavailable&&path==='rpc/icash_claim_research_exclusions')throw Error('Fixture database unavailable');
 return db(path,method,body);
};
const ok=async()=>Response.json({ok:true});
const route=await loadService('app/api/internal/maintenance/route.ts',{
 processSupportCustomerNotifications:async()=>({failed:0}),
 applyApprovedProVoiceCapacity:async()=>({status:'already_verified'}),refreshVoiceCapacity:async()=>({status:'verified'}),readVoiceCapacityProvider:()=>{throw Error('No live provider');},
 refreshInventoryGeographyBatch:async()=>({status:'idle'}),readRecordingReview:()=>null,
 processPurchaseAccessEmails:async()=>({ready:true,failed:0}),recoverAccessHelpReplies:async()=>({status:'idle'}),
 processSupportOwnerNotifications:async()=>({failed:0}),processPurchaseAccessFollowups:async()=>({ready:true,failed:0}),
 authorizeOutboundBilling:()=>authorized,maintenanceBatch,
 refreshReliability:async(_db,healthy)=>{assert.equal(healthy,true);maintenanceRuns++;return true;},
 recoverOwnerActiveExports:async()=>({status:'export_recovery_idle'}),recoverOwnerExportCapacity:async()=>({status:'capacity_review_idle'}),syncResearchExclusions:db=>syncResearchExclusions(db,fetch),db:maintenanceDb,
 pruneUsageLoopObservations:async()=>null,outbound:ok,recording:ok,ownerRecording:ok,reception:ok,
 process:{env:{}},
});
const run=()=>route.GET(new Request('https://fixture.invalid/api/internal/maintenance'));
claim={action:'sync',token,name,listId:'fixture-list',ids:['prop_1']};
calls=[];assert.equal((await run()).status,401);assert.equal(calls.length,0);assert.equal(maintenanceRuns,0);
authorized=true;let response=await run();assert.equal(response.status,200);
assert.equal((await response.json()).researchExclusions.status,'synced');assert.equal(calls.length,1);
assert(calls[0].url.endsWith('/lists/fixture-list/items'),'Maintenance performs only the existing free list operation');
assert.equal(maintenanceRuns,1,'Independent maintenance work still completes');
calls=[];claim=null;response=await run();assert.equal(response.status,200);
assert.equal((await response.json()).researchExclusions.status,'not_due');assert.equal(calls.length,0,'A disabled or already-claimed sync does no provider work');
claim={action:'sync',token,name,listId:'fixture-list',ids:['prop_1']};allowed=false;
response=await run();assert.equal(response.status,200);assert.equal((await response.json()).researchExclusions.status,'pending');assert.equal(calls.length,0,'Maintenance obeys the shared request quota');
allowed=true;claimUnavailable=true;response=await run();assert.equal(response.status,200);
assert.equal((await response.json()).researchExclusions.status,'sync_unavailable');assert.equal(maintenanceRuns,4,'An exclusion failure cannot suppress unrelated maintenance');
assert.equal(calls.length,0);
console.log('Exclusion maintenance: authenticated free backfill without paid discovery, shared claim/quota guards, and independent maintenance through failures passed.');
