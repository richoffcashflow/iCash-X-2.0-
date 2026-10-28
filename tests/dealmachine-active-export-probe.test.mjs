import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {activeExportProbeProvider,activeExportRetryProvider,activeExportProbeRequest,activeExportProbeHash,verifyActiveExportOnce} from '../scripts/verify-dealmachine-active-export.mjs';

const now=Date.now(),env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'codex/dealmachine-active-phone-contract-20261027',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),DEALMACHINE_API_KEY:'dm_sk_live_FIXTURE'};
const approval={version:1,status:'approved',maxCredits:1,explicitOwnerApproval:true,approvalId:'11111111-1111-4111-8111-111111111111',
 accountId:'22222222-2222-4222-8222-222222222222',screeningId:'33333333-3333-4333-8333-333333333333',propertyId:'prop_123',personId:'per_456',
 approvedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString(),requestHash:activeExportProbeHash(activeExportProbeRequest('per_456'))};
const original={export_id:'fixture-export',record_count:1,credits:{used:1,people:1},download_urls:[{url:'https://example.invalid/private-export'}]};
function fixture(options={}){
 let row=options.row===null?null:structuredClone(options.row??approval),calls=0,lookups=0;
 const provider=options.provider??activeExportProbeProvider;
 const db=async(path,method='GET',body)=>{
  if(provider===activeExportRetryProvider&&path.startsWith(`icash_integration_checks?provider=eq.${activeExportProbeProvider}`)){
   assert.equal(method,'GET','The original attempt must never be rewritten');return options.previous?[{result:structuredClone(options.previous)}]:[];
  }
  if(path==='rpc/icash_dealmachine_capacity_available'){assert.deepEqual(body,{p_requests:1});return options.capacityUnavailable?false:true;}
  if(path==='rpc/icash_take_dealmachine_request'){assert.equal(row.status,'started');assert.equal(body.p_kind,'owner_lookup');assert.equal(body.p_operation,provider);return options.quotaDenied?false:true;}
  if(path==='rpc/icash_finish_dealmachine_request')return true;
  if(path.startsWith('icash_owner_contacts?'))return [{created_at:new Date(now-500).toISOString(),result:{propertyId:options.foreign?'prop_999':'prop_123',requestedPersonIds:['per_456'],contacts:[{personId:'per_456',likelyOwner:true,propertyContactType:'owner',matchFlags:{is_likely_renter:false},phones:[{number:'+12025550123',doNotCall:false}]}]}}];
  if(path==='rpc/icash_dealmachine_owner_source_started_at')return new Date(now-800).toISOString();
  assert(path.startsWith(`icash_integration_checks?provider=eq.${provider}`));
  if(method==='GET'){lookups++;return row?[{result:structuredClone(row)}]:[];}
  assert.equal(method,'PATCH');
  if(path.includes('result->>status=eq.approved')||path.includes('result->>status=eq.waiting_for_quota')){
   assert(path.includes('result->>approvalId=eq.'+approval.approvalId));assert(path.includes('result->>requestHash=eq.'+approval.requestHash));
   const expected=path.includes('result->>status=eq.waiting_for_quota')?'waiting_for_quota':'approved';
   if(row?.status!==expected)return [];
   if(expected==='waiting_for_quota'){
    assert(path.includes('result->>runId=eq.'+row.runId));
    assert(path.includes('result->quotaDeferral->>id=eq.'+row.quotaDeferral.id));
   }
   row=structuredClone(body.result);if(options.lostClaim)throw Error('database response lost');
  }else{
   assert.match(path,/result->>status=eq.started&result->>runId=eq./);
   if(options.lostReceipt)throw Error('database unavailable');
   row=structuredClone(body.result);
  }
  return [{result:structuredClone(row)}];
 };
 const transport=async(url,init)=>{
  if(init.method==='GET'){
   assert.equal(init.redirect,'error');
   if(options.metadataUnavailable)return new Response('unavailable',{status:500});
   if(url.includes('/fields?'))return Response.json({data:(options.unverifiedFields?['person_full_name']:['dm_person_id','full_name','phones']).map(field_id=>({field_id,billing_category:options.propertyFields?'property':'people'})),pagination:{has_next_page:false}});
   if(url==='https://api.v2.dealmachine.com/v1/exports?limit=5')return Response.json({data:options.busyExport?[{export_id:'fixture-busy',status:'processing'}]:[],pagination:{total:options.busyExport?1:0,has_more:options.incompleteHistory===true}});
   assert.equal(url,'https://api.v2.dealmachine.com/v1/exports/fixture-busy');return Response.json({data:{export_id:'fixture-busy',status:'processing'}});
  }
  calls++;assert.equal(row.status,'started');assert.equal(url,'https://api.v2.dealmachine.com/v1/people/export');
  assert.equal(init.method,'POST');assert.equal(init.redirect,'error');
  assert.deepEqual(JSON.parse(init.body),activeExportProbeRequest('per_456'));
  assert.equal(JSON.parse(init.body).people_ids.length,1);
  if(options.timeout)throw Error('connection lost');
  if(options.unreadable)return new Response('not json',{status:200});
  return Response.json(options.httpError?{error:{code:'invalid_request'}}:original,{status:options.httpError?400:200});
 };
 return {run:overrides=>verifyActiveExportOnce({db,transport,env,clock:()=>now,provider,...overrides}),get row(){return row;},get calls(){return calls;},get lookups(){return lookups;}};
}
assert.throws(()=>activeExportProbeRequest(['per_456','per_789']),/OWNER_ID/);
assert.throws(()=>activeExportProbeRequest('per_456?location=all'),/OWNER_ID/);
for(const row of [null,{...approval,status:'started'},{...approval,status:'response_saved'}]){const f=fixture({row});await f.run();assert.equal(f.calls,0);}
for(const change of [{maxCredits:2},{explicitOwnerApproval:false},{requestHash:'changed'},{expiresAt:new Date(now-1).toISOString()},{personId:'per_789'}]){
 const f=fixture({row:{...approval,...change}});await assert.rejects(f.run(),/APPROVAL_INVALID/);assert.equal(f.calls,0);
}
const foreign=fixture({foreign:true});await assert.rejects(foreign.run(),/SOURCE_INVALID/);assert.equal(foreign.calls,0);
for(const options of [{unverifiedFields:true},{propertyFields:true},{metadataUnavailable:true},{incompleteHistory:true},{busyExport:true}]){
 const f=fixture(options),result=await f.run();assert.notEqual(result.status,'response_saved');assert.equal(f.calls,0);assert.equal(f.row.status,'approved','Metadata holds precede the approval claim and quota admission');
}
assert.deepEqual(activeExportProbeRequest('per_456'),{people_ids:['per_456'],fields:['dm_person_id','full_name','phones'],property_match:'owner',anchor:'person',require_phone:true,scrub_dnc:true,active_phones_only:true});
const disabled=fixture();assert.equal((await disabled.run({env:{...env,VERCEL_ENV:'production'}})).status,'not_requested');assert.equal(disabled.lookups,0);
const quota=fixture({quotaDenied:true});assert.equal((await quota.run()).status,'quota_not_admitted');assert.equal(quota.calls,0);await quota.run();assert.equal(quota.calls,0);
const expiredDuringRead=fixture();let clockReads=0;assert.equal((await expiredDuringRead.run({clock:()=>clockReads++===0?now:now+60001})).status,'approval_expired');assert.equal(expiredDuringRead.calls,0);
const concurrent=fixture();const results=await Promise.all([concurrent.run(),concurrent.run()]);assert.equal(concurrent.calls,1);assert.equal(results.filter(x=>x.status==='response_saved').length,1);assert.deepEqual(concurrent.row.receipt,original);
await concurrent.run();assert.equal(concurrent.calls,1,'Saved runs never repeat the export');
for(const options of [{lostClaim:true},{lostReceipt:true},{timeout:true},{unreadable:true}]){
 const f=fixture(options);await f.run().catch(()=>null);const count=f.calls;await f.run();assert.equal(f.calls,count,'Uncertain claims/receipts never replay');assert.equal(count,options.lostClaim?0:1);
}
const rejected=fixture({httpError:true});const rejection=await rejected.run();assert.equal(rejection.creditsUsed,null);assert.equal(rejected.row.httpStatus,400);assert.equal(rejected.calls,1);
// A local quota rejection is not a provider attempt. A separately reviewed,
// service-only deferral may preserve that proof and schedule the FIRST export.
// The executable never creates this deferral or renews an approval itself.
const originalRunId='44444444-4444-4444-8444-444444444444';
const deferred={...approval,status:'waiting_for_quota',runId:originalRunId,startedAt:new Date(now-500).toISOString(),request:Object.fromEntries(Object.entries(activeExportProbeRequest('per_456')).reverse()),quotaDeferral:{
 id:'55555555-5555-4555-8555-555555555555',reason:'local_quota_before_dispatch',originalRunId,originalStartedAt:new Date(now-500).toISOString(),requestWasAdmitted:false,requestOutcome:'quota_wait',
 recordedAt:new Date(now).toISOString(),executeAfter:new Date(now+2*3600000).toISOString(),executeBefore:new Date(now+3*3600000).toISOString()}};
const deferredNow=now+2*3600000+1000;
const scheduled=fixture({row:deferred});assert.equal((await scheduled.run()).status,'deferred_not_due');assert.equal(scheduled.calls,0);
const waiting=fixture({row:deferred,capacityUnavailable:true});assert.equal((await waiting.run({clock:()=>deferredNow})).status,'quota_wait');assert.equal(waiting.row.status,'waiting_for_quota');assert.equal(waiting.calls,0);
const scheduledResults=await Promise.all([scheduled.run({clock:()=>deferredNow}),scheduled.run({clock:()=>deferredNow})]);
assert.equal(scheduled.calls,1);assert.equal(scheduledResults.filter(r=>r.status==='response_saved').length,1);assert.deepEqual(scheduled.row.quotaDeferral,deferred.quotaDeferral);
await scheduled.run({clock:()=>deferredNow});assert.equal(scheduled.calls,1);
for(const change of [{requestWasAdmitted:true},{originalRunId:'66666666-6666-4666-8666-666666666666'},{recordedAt:new Date(now+60001).toISOString()},{executeBefore:new Date(now+5*3600000).toISOString()}]){
 const f=fixture({row:{...deferred,quotaDeferral:{...deferred.quotaDeferral,...change}}});await assert.rejects(f.run({clock:()=>deferredNow}),/DEFERRAL_INVALID/);assert.equal(f.calls,0);
}
for(const change of [{receipt:original},{request:{...deferred.request,people_ids:['per_789']}},{startedAt:'invalid'}]){
 const f=fixture({row:{...deferred,...change}});await assert.rejects(f.run({clock:()=>deferredNow}),/DEFERRAL_INVALID/);assert.equal(f.calls,0);
}
const expiredDeferral=fixture({row:deferred});await assert.rejects(expiredDeferral.run({clock:()=>now+3*3600000}),/APPROVAL_INVALID/);assert.equal(expiredDeferral.calls,0);
for(const options of [{lostClaim:true},{lostReceipt:true},{timeout:true},{unreadable:true},{quotaDenied:true}]){
 const f=fixture({row:deferred,...options});await f.run({clock:()=>deferredNow}).catch(()=>null);const count=f.calls;await f.run({clock:()=>deferredNow});assert.equal(f.calls,count);
 assert.equal(count,options.lostClaim||options.quotaDenied?0:1);
}
// Fresh user approval authorizes one separate v2 attempt after the saved v1
// HTTP 500. It cannot reset v1, change the owner/request or create a v3 retry.
const previous={...approval,approvalId:'66666666-6666-4666-8666-666666666666',status:'response_saved',runId:originalRunId,
 startedAt:new Date(now-2000).toISOString(),request:activeExportProbeRequest('per_456'),httpStatus:500,
 receipt:{error:{code:'internal_error',request_id:'req_fixture'}}};
const retryApproval={...approval,reviewedCommit:env.VERCEL_GIT_COMMIT_SHA,retryOf:{provider:activeExportProbeProvider,runId:previous.runId,providerRequestId:'req_fixture'}};
const retryOptions={provider:activeExportRetryProvider,row:retryApproval,previous};
const retry=fixture(retryOptions);
const retryResults=await Promise.all([retry.run(),retry.run()]);
assert.equal(retry.calls,1);assert.equal(retryResults.filter(r=>r.status==='response_saved').length,1);
assert.deepEqual(retry.row.retryOf,retryApproval.retryOf);await retry.run();assert.equal(retry.calls,1);
assert.equal(previous.receipt.credits,undefined,'The earlier missing credit receipt stays unknown');
for(const change of [{status:'unknown'},{httpStatus:200},{personId:'per_789'},{requestHash:'changed'},{artifact:{}},
 {receipt:{error:{code:'internal_error',request_id:'req_other'}}},{receipt:{error:{code:'internal_error',request_id:'req_fixture'},export_id:'other'}},
 {request:{...previous.request,people_ids:['per_789']}},{startedAt:approval.approvedAt}]){
 const f=fixture({...retryOptions,previous:{...previous,...change}});await assert.rejects(f.run(),/RETRY_BINDING_INVALID/);assert.equal(f.calls,0);
}
for(const change of [{reviewedCommit:'b'.repeat(40)},{reviewedCommit:undefined},{retryOf:{...retryApproval.retryOf,runId:approval.approvalId}},{quotaDeferral:deferred.quotaDeferral},
 {status:'waiting_for_quota',quotaDeferral:deferred.quotaDeferral},{receipt:original},{runId:originalRunId}]){
 const f=fixture({...retryOptions,row:{...retryApproval,...change}});await assert.rejects(f.run(),/RETRY_BINDING_INVALID/);assert.equal(f.calls,0);
}
const retryWait=fixture({...retryOptions,capacityUnavailable:true});assert.equal((await retryWait.run()).status,'quota_wait');assert.equal(retryWait.calls,0);assert.equal(retryWait.row.status,'approved');
for(const options of [{lostClaim:true},{lostReceipt:true},{timeout:true},{unreadable:true},{quotaDenied:true},{httpError:true}]){
 const f=fixture({...retryOptions,...options});await f.run().catch(()=>null);const count=f.calls;await f.run();assert.equal(f.calls,count);
 assert.equal(count,options.lostClaim||options.quotaDenied?0:1);
}
const unsupported=fixture();await assert.rejects(unsupported.run({provider:'dealmachine_active_phone_export_verification_20261027_v3'}),/OPERATION_INVALID/);assert.equal(unsupported.lookups,0);
try{execFileSync(process.execPath,['scripts/verify-dealmachine-active-export.mjs'],{encoding:'utf8',stdio:'pipe'});assert.fail('Executable must remain disabled');}
catch(error){assert.match(String(error.stderr),/Paid provider simulations are disabled/);}
console.log('PASS prepared active-export check: no live execution; fresh one-credit approval, exact owner/source binding, one-use concurrent claim, raw receipts and no replay on uncertainty.');
