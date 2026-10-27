import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {activeExportProbeRequest,activeExportProbeHash,verifyActiveExportOnce} from '../scripts/verify-dealmachine-active-export.mjs';

const now=Date.now(),env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'codex/dealmachine-active-phone-contract-20261027',DEALMACHINE_API_KEY:'dm_sk_live_FIXTURE'};
const approval={version:1,status:'approved',maxCredits:1,explicitOwnerApproval:true,approvalId:'11111111-1111-4111-8111-111111111111',
 accountId:'22222222-2222-4222-8222-222222222222',screeningId:'33333333-3333-4333-8333-333333333333',propertyId:'prop_123',personId:'per_456',
 approvedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString(),requestHash:activeExportProbeHash(activeExportProbeRequest('per_456'))};
const original={export_id:'fixture-export',record_count:1,credits:{used:1,people:1},download_urls:[{url:'https://example.invalid/private-export'}]};
function fixture(options={}){
 let row=options.row===null?null:structuredClone(options.row??approval),calls=0,lookups=0;
 const db=async(path,method='GET',body)=>{
  if(path==='rpc/icash_take_dealmachine_request'){assert.equal(row.status,'started');assert.equal(body.p_kind,'owner_lookup');return options.quotaDenied?false:true;}
  if(path==='rpc/icash_finish_dealmachine_request')return true;
  if(path.startsWith('icash_owner_contacts?'))return [{created_at:new Date(now-500).toISOString(),result:{propertyId:options.foreign?'prop_999':'prop_123',requestedPersonIds:['per_456'],contacts:[{personId:'per_456',likelyOwner:true,propertyContactType:'owner',matchFlags:{is_likely_renter:false},phones:[{number:'+12025550123',doNotCall:false}]}]}}];
  if(path==='rpc/icash_dealmachine_owner_source_started_at')return new Date(now-800).toISOString();
  assert.match(path,/^icash_integration_checks\?provider=eq.dealmachine_active_phone_export_verification_20261027_v1/);
  if(method==='GET'){lookups++;return row?[{result:structuredClone(row)}]:[];}
  assert.equal(method,'PATCH');
  if(path.includes('result->>status=eq.approved')){
   assert(path.includes('result->>approvalId=eq.'+approval.approvalId));assert(path.includes('result->>requestHash=eq.'+approval.requestHash));
   if(row?.status!=='approved')return [];
   row=structuredClone(body.result);if(options.lostClaim)throw Error('database response lost');
  }else{
   assert.match(path,/result->>status=eq.started&result->>runId=eq./);
   if(options.lostReceipt)throw Error('database unavailable');
   row=structuredClone(body.result);
  }
  return [{result:structuredClone(row)}];
 };
 const transport=async(url,init)=>{
  calls++;assert.equal(row.status,'started');assert.equal(url,'https://api.v2.dealmachine.com/v1/people/export');
  assert.equal(init.method,'POST');assert.equal(init.redirect,'error');
  assert.deepEqual(JSON.parse(init.body),activeExportProbeRequest('per_456'));
  assert.equal(JSON.parse(init.body).people_ids.length,1);
  if(options.timeout)throw Error('connection lost');
  if(options.unreadable)return new Response('not json',{status:200});
  return Response.json(options.httpError?{error:{code:'invalid_request'}}:original,{status:options.httpError?400:200});
 };
 return {run:overrides=>verifyActiveExportOnce({db,transport,env,clock:()=>now,...overrides}),get row(){return row;},get calls(){return calls;},get lookups(){return lookups;}};
}
assert.throws(()=>activeExportProbeRequest(['per_456','per_789']),/OWNER_ID/);
assert.throws(()=>activeExportProbeRequest('per_456?location=all'),/OWNER_ID/);
for(const row of [null,{...approval,status:'started'},{...approval,status:'response_saved'}]){const f=fixture({row});await f.run();assert.equal(f.calls,0);}
for(const change of [{maxCredits:2},{explicitOwnerApproval:false},{requestHash:'changed'},{expiresAt:new Date(now-1).toISOString()},{personId:'per_789'}]){
 const f=fixture({row:{...approval,...change}});await assert.rejects(f.run(),/APPROVAL_INVALID/);assert.equal(f.calls,0);
}
const foreign=fixture({foreign:true});await assert.rejects(foreign.run(),/SOURCE_INVALID/);assert.equal(foreign.calls,0);
const disabled=fixture();assert.equal((await disabled.run({env:{...env,VERCEL_ENV:'production'}})).status,'not_requested');assert.equal(disabled.lookups,0);
const quota=fixture({quotaDenied:true});assert.equal((await quota.run()).status,'quota_not_admitted');assert.equal(quota.calls,0);await quota.run();assert.equal(quota.calls,0);
const expiredDuringRead=fixture();let clockReads=0;assert.equal((await expiredDuringRead.run({clock:()=>clockReads++===0?now:now+60001})).status,'approval_expired');assert.equal(expiredDuringRead.calls,0);
const concurrent=fixture();const results=await Promise.all([concurrent.run(),concurrent.run()]);assert.equal(concurrent.calls,1);assert.equal(results.filter(x=>x.status==='response_saved').length,1);assert.deepEqual(concurrent.row.receipt,original);
await concurrent.run();assert.equal(concurrent.calls,1,'Saved runs never repeat the export');
for(const options of [{lostClaim:true},{lostReceipt:true},{timeout:true},{unreadable:true}]){
 const f=fixture(options);await f.run().catch(()=>null);const count=f.calls;await f.run();assert.equal(f.calls,count,'Uncertain claims/receipts never replay');assert.equal(count,options.lostClaim?0:1);
}
const rejected=fixture({httpError:true});const rejection=await rejected.run();assert.equal(rejection.creditsUsed,null);assert.equal(rejected.row.httpStatus,400);assert.equal(rejected.calls,1);
try{execFileSync(process.execPath,['scripts/verify-dealmachine-active-export.mjs'],{encoding:'utf8',stdio:'pipe'});assert.fail('Executable must remain disabled');}
catch(error){assert.match(String(error.stderr),/Paid provider simulations are disabled/);}
console.log('PASS prepared active-export check: no live execution; fresh one-credit approval, exact owner/source binding, one-use concurrent claim, raw receipts and no replay on uncertainty.');
