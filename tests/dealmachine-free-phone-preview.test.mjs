import assert from 'node:assert/strict';
import {checkApprovedActivePhonePreview,freePhonePreviewProvider,freePhonePreviewRequest,freePhonePreviewHash} from '../scripts/check-approved-active-phone-preview.mjs';
const originalProvider='dealmachine_active_phone_export_verification_20261027_v1';
const now=Date.now(),env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'codex/dealmachine-active-phone-contract-20261027',VERCEL_GIT_REPO_OWNER:'richoffcashflow',VERCEL_GIT_REPO_SLUG:'iCash-X-2.0-',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),SUPABASE_URL:'https://ofjbbpwugyjfxbhqfguh.supabase.co',SUPABASE_SECRET_KEY:'fixture-db',DEALMACHINE_API_KEY:'dm_sk_live_FIXTURE'};
const approval={version:1,status:'approved',explicitOwnerApproval:true,allowAboveAppQuota:true,maxProviderRequests:2,maxCredits:0,
 approvalId:'11111111-1111-4111-8111-111111111111',accountId:'22222222-2222-4222-8222-222222222222',screeningId:'33333333-3333-4333-8333-333333333333',propertyId:'prop_123',personId:'per_456',
 sourceProvider:originalProvider,reviewedCommit:env.VERCEL_GIT_COMMIT_SHA,approvedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString(),requestHash:freePhonePreviewHash(freePhonePreviewRequest('per_456'))};
const headers={'X-RateLimit-Limit':'60','X-RateLimit-Remaining':'59','X-RateLimit-Day-Limit':'5000','X-RateLimit-Day-Remaining':'20'};
function fixture(options={}){
 let row=structuredClone({...approval,...options.approval});const calls=[],writes=[];
 const original={...approval,status:'response_saved',httpStatus:500,receipt:{error:{code:'internal_error'}}};
 const source={created_at:new Date(now-2*86400000).toISOString(),result:{propertyId:'prop_123',requestedPersonIds:['per_456'],contacts:[{personId:'per_456',likelyOwner:!options.badSource,propertyContactType:'owner',matchFlags:{is_likely_renter:false}}]}};
 const db=async(path,method='GET',body)=>{
  if(path.startsWith('icash_integration_checks?provider=eq.dealmachine_active_phone_free_preview_20261028_v1')){
   assert.equal(method,'GET','The original free result must remain unchanged');
   return [{result:{...approval,status:'preview_http_error',summary:{httpStatus:400},request:{...freePhonePreviewRequest('per_456'),fields:['has_active_phone_number']},requests:[{}, {httpStatus:400,raw:{error:{code:'invalid_request',message:options.badPrevious?'different failure':'fields requires enrich=true'}}}]}}];
  }
  if(path.startsWith('icash_owner_contacts?')){assert.equal(method,'GET');return [source];}
  if(path.startsWith('icash_integration_checks?provider=eq.'+originalProvider)){assert.equal(method,'GET','Original export may never be changed');return [{result:original}];}
  assert(path.startsWith('icash_integration_checks?provider=eq.'+freePhonePreviewProvider),'No quota, funding or financial calls');
  if(method==='GET')return options.missing?[]:[{result:structuredClone(row)}];
  assert.equal(method,'PATCH');
  if(path.includes('status=eq.approved')){
   if(row.status!=='approved')return [];
   assert(path.includes('requestHash=eq.'+approval.requestHash));assert(path.includes('reviewedCommit=eq.'+env.VERCEL_GIT_COMMIT_SHA));
   row=structuredClone(body.result);writes.push(row);
   if(options.lostClaim)throw Error('private database error');
   return [{result:structuredClone(row)}];
  }
  assert(path.includes('runId=eq.'+row.runId));row=structuredClone(body.result);writes.push(row);
  if(options.failedSave&&row.requests.length===1&&row.requests[0].httpStatus!==null)throw Error('private save error');
  return [{result:structuredClone(row)}];
 };
 const transport=async(url,init)=>{
  calls.push({url,init});assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.headers.Authorization,'Bearer dm_sk_live_FIXTURE');
  if(calls.length===1){
   assert.equal(init.method,'GET');assert.equal(url,'https://api.v2.dealmachine.com/v1/fields?source_type=people&per_page=250&page=1');
   if(options.timeout===1)throw Error('private provider error');
   return Response.json({data:options.missingField?[]:[{field_id:'has_active_phone_number',type:'BOOLEAN',description:'private fixture value'}],pagination:{has_next_page:options.morePages??false}},{status:options.catalogStatus??200,headers:options.headers??headers});
  }
  assert.equal(calls.length,2);assert.equal(init.method,'POST');assert.equal(url,'https://api.v2.dealmachine.com/v1/people/ids');
  assert.deepEqual(JSON.parse(init.body),{ids:['per_456'],enrich:false,include_properties:false});
  if(options.timeout===2)throw Error('private provider error');
  const person={dm_person_id:options.wrongPerson?'per_999':'per_456',found:true,full_name:'Private Fixture Name',...(options.activity===undefined?{}:{has_active_phone_number:options.activity}),...(options.contactData?{phones:[{number:'2025550123'}]}:{})};
  return Response.json({data:[person],totals:{submitted:1,found:1,not_found:0},...(options.missingCredits?{}:{credits:{used:options.creditsUsed??0,people:0,properties:0,deduplicated:0}})},{status:options.previewStatus??200,headers});
 };
 return {calls,writes,get row(){return row;},run:()=>checkApprovedActivePhonePreview({env:{...env,...options.env},db,transport,clock:()=>now})};
}
for(const activity of [true,false]){
 const f=fixture({activity}),summary=await f.run();
 assert.equal(summary.status,'person_activity_available');assert.equal(summary.hasActivePhone,activity);assert.equal(summary.creditsUsed,0);assert.equal(f.calls.length,2);
 assert.equal(f.row.requests.length,2);assert(f.row.requests[1].rawText.includes('Private Fixture Name'));assert.equal(f.row.maxCredits,0);
 assert.doesNotMatch(JSON.stringify(summary),/Private Fixture|2025550123|dm_sk_live|per_456/);
 assert.equal((await f.run()).status,'already_consumed');assert.equal(f.calls.length,2);
}
for(const activity of [undefined,null,'true',1]){const f=fixture({activity});const r=await f.run();assert.equal(r.status,'person_activity_not_returned');assert.equal(r.hasActivePhone,null);}
const parallel=fixture({activity:true});const results=await Promise.all([parallel.run(),parallel.run()]);assert.equal(parallel.calls.length,2);assert.equal(results.filter(r=>r.status==='person_activity_available').length,1);
for(const options of [{missing:true},{env:{VERCEL_ENV:'production'}},{env:{VERCEL_GIT_COMMIT_REF:'main'}},{env:{VERCEL_GIT_REPO_OWNER:'foreign'}},{env:{SUPABASE_URL:'https://foreign.invalid'}},{approval:{status:'started'}},{approval:{status:'unknown'}}]){const f=fixture(options);await f.run();assert.equal(f.calls.length,0);}
for(const change of [{maxCredits:1},{maxProviderRequests:3},{allowAboveAppQuota:false},{reviewedCommit:'b'.repeat(40)},{requestHash:'wrong'},{expiresAt:new Date(now-1).toISOString()},{explicitOwnerApproval:false}]){const f=fixture({approval:change});await assert.rejects(f.run());assert.equal(f.calls.length,0);}
const bad=fixture({badSource:true});await assert.rejects(bad.run(),/SOURCE_INVALID/);assert.equal(bad.calls.length,0);
const badPrevious=fixture({badPrevious:true});await assert.rejects(badPrevious.run(),/PREVIOUS_BINDING_INVALID/);assert.equal(badPrevious.calls.length,0);
for(const options of [{missingField:true},{morePages:true},{catalogStatus:429},{catalogStatus:500},{headers:{}},{headers:{...headers,'X-RateLimit-Day-Remaining':'0'}},{headers:{...headers,'X-RateLimit-Remaining':'0'}},{headers:{...headers,'Retry-After':'10'}}]){const f=fixture(options);const r=await f.run();assert.notEqual(r.status,'person_activity_available');assert.equal(f.calls.length,1);await f.run();assert.equal(f.calls.length,1);}
for(const options of [{lostClaim:true},{timeout:1},{timeout:2},{failedSave:true}]){const f=fixture(options);await assert.rejects(f.run());const count=f.calls.length;assert(count<=2);await f.run();assert.equal(f.calls.length,count);}
for(const [options,status] of [[{wrongPerson:true},'preview_identity_unverified'],[{missingCredits:true},'preview_credit_receipt_unverified'],[{creditsUsed:1},'preview_credit_receipt_unverified'],[{contactData:true},'unexpected_enriched_data'],[{previewStatus:429},'provider_rate_limited'],[{previewStatus:500},'preview_http_error']]){const f=fixture(options),r=await f.run();assert.equal(r.status,status);if(options.creditsUsed)assert.equal(r.creditsUsed,1);if(options.missingCredits)assert.equal(r.creditsUsed,null);assert.equal(f.calls.length,2);}
assert.throws(()=>freePhonePreviewRequest('someone else'),/OWNER_INVALID/);
console.log('PASS free phone preview: exact owner and commit, explicit local-cap exception, fresh provider quota, two free requests maximum, zero-credit proof, missing is unknown, private receipts, concurrency and no replay.');
