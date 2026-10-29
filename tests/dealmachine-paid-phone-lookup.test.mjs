import assert from 'node:assert/strict';
import {checkApprovedActivePhoneLookup,paidPhoneLookupProvider,paidPhoneLookupRequest,paidPhoneLookupHash} from '../scripts/check-approved-active-phone-lookup.mjs';

const now=Date.now();
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'codex/dealmachine-active-phone-contract-20261027',VERCEL_GIT_REPO_OWNER:'richoffcashflow',VERCEL_GIT_REPO_SLUG:'iCash-X-2.0-',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),SUPABASE_URL:'https://ofjbbpwugyjfxbhqfguh.supabase.co',SUPABASE_SECRET_KEY:'fixture',DEALMACHINE_API_KEY:'dm_sk_live_FIXTURE'};
const originalProvider='dealmachine_active_phone_export_verification_20261027_v1';
const approval={version:1,status:'approved',explicitOwnerApproval:true,allowAboveAppQuota:true,maxCredits:1,maxPaidRequests:1,maxProviderRequests:2,
 approvalId:'11111111-1111-4111-8111-111111111111',accountId:'22222222-2222-4222-8222-222222222222',screeningId:'33333333-3333-4333-8333-333333333333',propertyId:'prop_123',personId:'per_456',
 previousPreviewRunId:'44444444-4444-4444-8444-444444444444',originalExportRunId:'55555555-5555-4555-8555-555555555555',secondExportRunId:'66666666-6666-4666-8666-666666666666',
 sourceProvider:originalProvider,reviewedCommit:env.VERCEL_GIT_COMMIT_SHA,approvedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString(),requestHash:paidPhoneLookupHash(paidPhoneLookupRequest('per_456'))};
const headers={'X-RateLimit-Limit':'60','X-RateLimit-Remaining':'59','X-RateLimit-Day-Limit':'5000','X-RateLimit-Day-Remaining':'20'};
const metadata={field_id:'has_active_phone_number',type:'BOOLEAN',source_type:'people',group_id:'contactability',is_premium_filter:false};

function fixture(options={}){
 let row=structuredClone({...approval,...options.approval}),current=now,lostReceipt=false;const calls=[],writes=[];
 const db=async(path,method='GET',body)=>{
  if(path.startsWith('icash_owner_contacts?')){
   assert.equal(method,'GET');
   return [{created_at:new Date(now-2*86400000).toISOString(),result:{propertyId:'prop_123',requestedPersonIds:['per_456'],contacts:[{personId:'per_456',likelyOwner:!options.badSource,propertyContactType:'owner',matchFlags:{}}]}}];
  }
  if(path.includes('provider=eq.dealmachine_active_phone_free_preview_20261028_v2')){
   assert.equal(method,'GET');
   return [{result:{...approval,runId:approval.previousPreviewRunId,status:options.badPrevious?'unknown':'person_activity_not_returned',summary:{creditsUsed:0,activityFieldReturned:false},request:{ids:['per_456'],enrich:false,include_properties:false},requests:[{}, {httpStatus:200}]}}];
  }
  if(path.includes('provider=eq.dealmachine_active_phone_export_verification_20261027_')){
   assert.equal(method,'GET','Never modify old export evidence');
   return [{result:{...approval,status:options.badExport?'started':'response_saved',runId:path.includes('_v1')?approval.originalExportRunId:approval.secondExportRunId}}];
  }
  assert(path.startsWith('icash_integration_checks?provider=eq.'+paidPhoneLookupProvider),'No quota, wallet or other writes');
  if(method==='GET')return options.missing?[]:[{result:structuredClone(row)}];
  assert.equal(method,'PATCH');
  if(path.includes('status=eq.approved')){
   if(options.changeBeforeClaim)row.maxCredits=2;
   const full=new URL('https://fixture.invalid/'+path).searchParams.get('result');
   assert(full?.startsWith('eq.'));
   if(row.status!=='approved'||JSON.stringify(row)!==full.slice(3))return [];
   row=structuredClone(body.result);writes.push(row);
   if(options.lostClaim)throw Error('private claim failure');
   return [{result:structuredClone(row)}];
  }
  assert(path.includes('runId=eq.'+row.runId));
  if(options.failedSave&&body.result.requests.at(-1)?.httpStatus!==null)throw Error('private save failure');
  row=structuredClone(body.result);writes.push(row);
  if(options.lostReceiptAck&&!lostReceipt&&row.requests.length===2&&row.requests[1].httpStatus===200){lostReceipt=true;throw Error('private lost receipt acknowledgment');}
  if(options.slowCatalogSave&&row.requests.length===1&&row.requests[0].httpStatus===200)current=now+11000;
  if(options.slowPostAdmission&&row.requests.length===2)current=now+11000;
  return [{result:structuredClone(row)}];
 };
 const transport=async(url,init)=>{
  calls.push({url,init});assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
  if(options.timeout===calls.length)throw Error('private provider failure');
  if(calls.length===1){
   assert.equal(url,'https://api.v2.dealmachine.com/v1/fields?source_type=people&per_page=250&page=1');assert.equal(init.method,'GET');
   return Response.json({data:options.fields??[{...metadata,...options.field}],pagination:{has_next_page:options.morePages??false}},{status:options.catalogStatus??200,headers:options.headers??headers});
  }
  assert.equal(calls.length,2);assert.equal(init.method,'POST');assert.equal(url,'https://api.v2.dealmachine.com/v1/people/ids');
  assert.deepEqual(JSON.parse(init.body),{ids:['per_456'],enrich:true,include_properties:false,fields:['has_active_phone_number']});
  const person={dm_person_id:options.wrongOwner?'per_999':'per_456',found:options.found??true,full_name:'Private Fixture Name',...(options.activity===undefined?{}:{has_active_phone_number:options.activity}),...(options.property?{property:{private:'property'}}:{})};
  const credits=options.credits??{used:1,people:1,properties:0,deduplicated:0};
  return Response.json({data:[person],totals:{submitted:1,found:person.found?1:0,not_found:person.found?0:1},...(options.missingCredits?{}:{credits})},{status:options.lookupStatus??200,headers});
 };
 return {calls,writes,get row(){return row;},run:()=>checkApprovedActivePhoneLookup({env:{...env,...options.env},db,transport,clock:()=>current})};
}

for(const activity of [true,false]){
 const f=fixture({activity}),summary=await f.run();
 assert.equal(summary.status,'person_activity_available');assert.equal(summary.hasActivePhone,activity);assert.equal(summary.creditsUsed,1);
 assert.equal(summary.paidRequests,1);assert.equal(summary.providerRequests,2);assert.equal(summary.perNumberActivityVerified,false);
 assert(f.row.requests[1].rawText.includes('Private Fixture Name'));assert.equal(f.row.requests[1].raw.credits.people,1);
 assert.doesNotMatch(JSON.stringify(summary),/Private Fixture|per_456|dm_sk_live/);
 assert.equal((await f.run()).status,'already_consumed');assert.equal(f.calls.length,2);
}
const dedup=fixture({activity:true,credits:{used:0,people:1,properties:0,deduplicated:1}});assert.equal((await dedup.run()).creditsUsed,0);assert.equal(dedup.row.requests[1].raw.credits.deduplicated,1);
const stale=fixture({slowPostAdmission:true});const staleResult=await stale.run();assert.equal(staleResult.status,'dispatch_window_expired');assert.equal(staleResult.paidRequests,0);assert.equal(stale.calls.length,1);await stale.run();assert.equal(stale.calls.length,1);
const staleCatalog=fixture({slowCatalogSave:true});assert.equal((await staleCatalog.run()).status,'provider_quota_unavailable');assert.equal(staleCatalog.calls.length,1);
const lostReceipt=fixture({activity:true,lostReceiptAck:true});await assert.rejects(lostReceipt.run());assert.equal(lostReceipt.row.status,'unknown');assert.equal(lostReceipt.row.requests[1].raw.data[0].has_active_phone_number,true);assert.equal(lostReceipt.row.requests[1].raw.credits.used,1);assert(lostReceipt.row.requests[1].rawText.includes('Private Fixture Name'));await lostReceipt.run();assert.equal(lostReceipt.calls.length,2);
for(const activity of [undefined,null,'true',1]){const f=fixture({activity}),r=await f.run();assert.equal(r.status,'person_activity_not_returned');assert.equal(r.hasActivePhone,null);}
const parallel=fixture({activity:true});const concurrent=await Promise.all([parallel.run(),parallel.run()]);assert.equal(parallel.calls.length,2);assert.equal(concurrent.filter(r=>r.status==='person_activity_available').length,1);
for(const options of [{missing:true},{env:{GITHUB_ACTIONS:'true'}},{env:{VERCEL_ENV:'production'}},{env:{VERCEL_GIT_COMMIT_REF:'main'}},{env:{VERCEL_GIT_REPO_OWNER:'other'}},{env:{SUPABASE_URL:'https://other.invalid'}},{approval:{status:'started'}},{approval:{status:'unknown'}},{changeBeforeClaim:true}]){const f=fixture(options);await f.run();assert.equal(f.calls.length,0);}
for(const change of [{maxCredits:2},{maxCredits:0},{maxPaidRequests:2},{maxProviderRequests:3},{allowAboveAppQuota:false},{explicitOwnerApproval:false},{reviewedCommit:'b'.repeat(40)},{requestHash:'wrong'},{expiresAt:new Date(now-1).toISOString()},{expiresAt:new Date(now+3600000).toISOString()}]){const f=fixture({approval:change});await assert.rejects(f.run());assert.equal(f.calls.length,0);}
for(const options of [{badPrevious:true},{badExport:true},{badSource:true}]){const f=fixture(options);await assert.rejects(f.run());assert.equal(f.calls.length,0);}
for(const options of [{fields:[]},{fields:[metadata,metadata]},{morePages:true},{field:{source_type:'properties'}},{field:{type:'STRING'}},{field:{group_id:'other'}},{field:{billing_category:'property'}},{field:{billing_category:null}},{field:{is_premium_filter:true}},{catalogStatus:429},{catalogStatus:500},{headers:{}},{headers:{...headers,'X-RateLimit-Remaining':'0'}},{headers:{...headers,'X-RateLimit-Day-Remaining':'0'}},{headers:{...headers,'Retry-After':'Wed, 28 Oct 2026 20:00:00 GMT'}}]){const f=fixture(options);const r=await f.run();assert.equal(r.paidRequests,0);assert.equal(f.calls.length,1);await f.run();assert.equal(f.calls.length,1);}
for(const options of [{lostClaim:true},{timeout:1},{timeout:2},{failedSave:true}]){const f=fixture(options);await assert.rejects(f.run());const count=f.calls.length;assert(count<=2);await f.run();assert.equal(f.calls.length,count);}
for(const [options,status] of [[{wrongOwner:true},'lookup_identity_unverified'],[{missingCredits:true},'lookup_credit_receipt_unverified'],[{credits:{used:1,people:1,properties:0}},'lookup_credit_receipt_unverified'],[{credits:{used:2,people:2,properties:0,deduplicated:0}},'lookup_credit_receipt_unverified'],[{property:true},'unexpected_property_data'],[{lookupStatus:429},'provider_rate_limited'],[{lookupStatus:500,missingCredits:true},'lookup_http_error'],[{found:false,credits:{used:0,people:0,properties:0,deduplicated:0}},'owner_not_found']]){const f=fixture(options),r=await f.run();assert.equal(r.status,status);if(options.missingCredits)assert.equal(r.creditsUsed,null);assert.equal(f.calls.length,2);await f.run();assert.equal(f.calls.length,2);}
assert.throws(()=>paidPhoneLookupRequest('per_456,per_789'),/OWNER_INVALID/);
console.log('PASS paid phone lookup: one exact-owner credit, full approval CAS, provider quota, private original receipts, explicit credit evidence, person-only semantics, concurrency and no replay.');
