import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {checkApprovedActivePhoneExportV4,activePhoneExportV4,activePhoneExportV4Request,activePhoneExportV4Hash} from '../scripts/check-approved-active-phone-export-v4.mjs';

const now=Date.now(),sourceTime=new Date(now-60000).toISOString();
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'fix/active-export-diagnostic-slot',VERCEL_GIT_REPO_OWNER:'richoffcashflow',VERCEL_GIT_REPO_SLUG:'iCash-X-2.0-',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),SUPABASE_URL:'https://ofjbbpwugyjfxbhqfguh.supabase.co',SUPABASE_SECRET_KEY:'fixture',DEALMACHINE_API_KEY:'dm_sk_live_FIXTURE'};
const previousRuns={dealmachine_active_phone_export_verification_20261027_v1:'44444444-4444-4444-8444-444444444444',dealmachine_active_phone_export_verification_20261027_v2:'55555555-5555-4555-8555-555555555555'};
const body=activePhoneExportV4Request('per_456');
const approval={version:4,status:'approved',explicitOwnerApproval:true,maxCredits:1,maxPaidRequests:1,maxProviderRequests:4,allowAboveAppQuota:false,
 customerWalletCharge:false,callsOrTexts:false,automaticRetry:false,approvalId:'11111111-1111-4111-8111-111111111111',accountId:'22222222-2222-4222-8222-222222222222',screeningId:'33333333-3333-4333-8333-333333333333',
 propertyId:'prop_123',personId:'per_456',sourceOperation:'fixture-source',sourceCreatedAt:sourceTime,previousRuns,reviewedCommit:env.VERCEL_GIT_COMMIT_SHA,request:body,requestHash:activePhoneExportV4Hash(body),approvedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString()};
const headers={'X-RateLimit-Limit':'60','X-RateLimit-Remaining':'59','X-RateLimit-Day-Limit':'5000','X-RateLimit-Day-Remaining':'4000'};
const fields=[{field_id:'person_full_name',type:'STRING',source_type:'people',group_id:'demographics',is_premium_filter:false},{field_id:'has_active_phone_number',type:'BOOLEAN',source_type:'people',group_id:'contactability',is_premium_filter:false}];
const csv='dm_person_id,person_full_name,has_active_phone_number,phones\nper_456,Private Fixture,Yes,"[{""number"":""2025550123"",""do_not_call"":false}]"\n';
function fixture(options={}){
 let row=structuredClone({...approval,...options.approval}),current=now,lost=false;const calls=[],writes=[],admissions=[];
 const db=async(path,method='GET',value)=>{
  if(path.startsWith('icash_owner_contacts?')){assert.equal(method,'GET');return [{created_at:options.oldSource?new Date(now-86400001).toISOString():sourceTime,operation_key:'fixture-source',result:{propertyId:'prop_123',requestedPersonIds:['per_456'],contacts:[{personId:'per_456',likelyOwner:!options.badSource,propertyContactType:options.contactType??'owner',matchFlags:{is_likely_renter:!!options.renter},phones:[{number:'2025550123',doNotCall:!!options.dnc}]}]}}];}
  if(path==='rpc/icash_dealmachine_owner_source_started_at')return sourceTime;
  if(path==='rpc/icash_dealmachine_capacity_available')return !options.fullQuota;
  if(path==='rpc/icash_take_dealmachine_request'){admissions.push(value);if(options.slowAdmission&&admissions.length===3)current+=11000;return admissions.length!==options.denyAdmission;}
  if(path==='rpc/icash_finish_dealmachine_request'){
   if(value.p_result.httpStatus===200&&!options.headers&&!options.historyHeaders){assert.equal(value.p_result.minuteLimit,60);assert.equal(value.p_result.dayLimit,5000);}
   return null;
  }
  for(const [provider,runId] of Object.entries(previousRuns))if(path.includes('provider=eq.'+provider)){assert.equal(method,'GET','Prior receipts are immutable');return [{result:{status:options.badPrevious?'unknown':'response_saved',httpStatus:500,runId}}];}
  if(path==='rpc/icash_claim_owner_export_diagnostic'){
   if(options.slotBusy)return false;
   if(options.slotUnavailable)throw Error('missing migration');
   if(options.changedApproval)row.maxCredits=2;
   if(row.status!=='approved'||JSON.stringify(row)!==JSON.stringify(value.p_approval))return false;
   row=structuredClone(value.p_state);writes.push(row);if(options.lostClaim)throw Error('fixture');return true;
  }
  assert(path.startsWith('icash_integration_checks?provider=eq.'+activePhoneExportV4),'Only the new private diagnostic can be written');
  if(method==='GET')return options.missing?[]:[{result:structuredClone(row)}];
  assert.equal(method,'PATCH');
  assert(path.includes('runId=eq.'+row.runId));row=structuredClone(value.result);writes.push(row);
  if(options.lostReceipt&&!lost&&row.receipt){lost=true;throw Error('fixture lost receipt acknowledgment');}
  if(options.slowHistory&&row.requests.length===2&&row.requests[1].httpStatus===200)current+=11000;
  return [{result:structuredClone(row)}];
 };
 const transport=async(url,init)=>{
  calls.push({url:String(url),init});assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
  if(options.timeout===calls.length)throw Error('private provider failure');
  if(calls.length===1)return Response.json({data:options.fields??fields,pagination:{has_next_page:!!options.moreFields}},{status:options.catalogStatus??200,headers:options.headers??headers});
  if(calls.length===2)return Response.json({data:options.history??[{status:'failed'},{status:'failed'}],pagination:{has_more:!!options.moreHistory,total:2}},{status:options.historyStatus??200,headers:options.historyHeaders??headers});
  if(calls.length===3){
   assert.equal(init.method,'POST');assert.equal(url,'https://api.v2.dealmachine.com/v1/people/export');assert.deepEqual(JSON.parse(init.body),body);
   return Response.json(options.receipt??{export_id:'original-export',record_count:1,download_urls:[{url:'https://storage.googleapis.com/fixture/original.csv.gz?private=fixture'}],credits:{used:1,people:1}},{status:options.exportStatus??200,headers});
  }
  if(calls.length===4){assert.equal(init.method,'GET');assert.equal(url,'https://api.v2.dealmachine.com/v1/exports/original-export');return Response.json({data:{export_id:options.wrongRecovery?'another-export':'original-export',status:'completed',record_count:1}},{headers});}
  assert.equal(calls.length,5);assert.equal(String(url),'https://storage.googleapis.com/fixture/original.csv.gz?private=fixture');assert.equal(init.method,'GET');assert.equal(init.headers,undefined);return new Response(gzipSync(csv));
 };
 return {calls,writes,admissions,get row(){return row;},run:()=>checkApprovedActivePhoneExportV4({env:{...env,...options.env},db,transport,clock:()=>current})};
}
assert.deepEqual(body,{people_ids:['per_456'],fields:['person_full_name','has_active_phone_number'],property_match:'owner',anchor:'person',limit:1,require_phone:true,scrub_dnc:true,active_phones_only:true});
const f=fixture(),success=await f.run();
assert.equal(success.exportSucceeded,true);assert.equal(success.paidRequests,1);assert.equal(success.providerRequests,4);assert.deepEqual(success.reportedCredits,{used:1,people:1});
assert.equal(success.originalRecoveryVerified,true);assert.equal(success.productionEnabled,false);assert.equal(success.artifact.status,'saved');assert.equal(f.row.artifact.csv,csv);assert.equal(f.admissions.length,4);
assert.doesNotMatch(JSON.stringify(success),/2025550123|Private Fixture|private=fixture|per_456/);
assert(f.row.requests[2].rawText.includes('original-export'));assert.equal((await f.run()).status,'already_consumed');assert.equal(f.calls.length,5);
const concurrent=fixture();await Promise.all([concurrent.run(),concurrent.run()]);assert.equal(concurrent.calls.filter(c=>c.init.method==='POST').length,1);
for(const options of [{missing:true},{fullQuota:true},{env:{GITHUB_ACTIONS:'true'}},{env:{VERCEL_ENV:'production'}},{env:{VERCEL_GIT_REPO_OWNER:'other'}},{env:{SUPABASE_URL:'https://other.invalid'}},{approval:{status:'started'}},{approval:{status:'unknown'}},{changedApproval:true},{slotBusy:true},{slotUnavailable:true},{lostClaim:true}]){const x=fixture(options);await x.run();assert.equal(x.calls.length,0);}
for(const options of [{badSource:true},{renter:true},{dnc:true},{oldSource:true},{badPrevious:true},{contactType:'resident'},...['maxCredits','maxPaidRequests','maxProviderRequests'].map(k=>({approval:{[k]:99}})),{approval:{expiresAt:new Date(now-1).toISOString()}},{approval:{reviewedCommit:'b'.repeat(40)}},{approval:{request:{...body,people_ids:['per_456','per_789']}}},{approval:{callsOrTexts:true}},{approval:{allowAboveAppQuota:true}}]){const x=fixture(options);await assert.rejects(x.run());assert.equal(x.calls.length,0);}
for(const options of [{fields:[]},{fields:[...fields,fields[0]]},{fields:[{...fields[0],billing_category:'property'},fields[1]]},{fields:[fields[0],{...fields[1],is_premium_filter:true}]},{moreFields:true},{catalogStatus:429},{headers:{}},{headers:{...headers,'X-RateLimit-Remaining':'0'}},{history:[{status:'failed'},{status:'processing'}]},{moreHistory:true},{historyStatus:500},{historyHeaders:{...headers,'X-RateLimit-Day-Remaining':'0'}},{slowHistory:true},{slowAdmission:true},{denyAdmission:3}]){const x=fixture(options);const result=await x.run();assert.equal(result.paidRequests,0);assert.equal(x.calls.filter(c=>c.init.method==='POST').length,0);const count=x.calls.length;await x.run();assert.equal(x.calls.length,count);}
const error=fixture({exportStatus:500,receipt:{error:{code:'internal_error'}}});const failed=await error.run();assert.equal(failed.exportSucceeded,false);assert.deepEqual(failed.reportedCredits,{});assert.equal(error.calls.length,3);assert.equal(error.row.httpStatus,500);await error.run();assert.equal(error.calls.length,3);
for(const options of [{timeout:1},{timeout:3},{lostReceipt:true}]){const x=fixture(options);await assert.rejects(x.run());const count=x.calls.length;await x.run();assert.equal(x.calls.length,count);if(options.lostReceipt){assert.equal(x.row.receipt.credits.used,1);assert.equal(x.row.status,'unknown');}}
const mismatch=fixture({wrongRecovery:true});assert.equal((await mismatch.run()).originalRecoveryVerified,false);assert.equal(mismatch.calls.filter(c=>c.init.method==='POST').length,1);
assert.throws(()=>activePhoneExportV4Request('per_456,per_789'));
console.log('PASS active export v4: exact saved owner, one-credit/one-POST scope, catalog and quota gates, consumed approval CAS, original download/recovery, immutable errors and no replay.');
