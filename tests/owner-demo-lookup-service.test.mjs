import assert from 'node:assert/strict';
import {processSellerIntake} from '../lib/seller-pipeline.ts';

// Synthetic saved submissions and transport responses only; never paid tests.
const lead='11111111-1111-4111-8111-111111111111',request='22222222-2222-4222-8222-222222222222';
const matched={data:[{matched:true,dm_property_id:'prop_123',full_address:'45 Fixture Lane, Dallas, TX 75201',city:'Dallas',state:'TX',zip:'75201',property_type:1,estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:50000}],totals:{submitted:1},credits:{used:1,people:0}};
const unmatched={data:[{matched:false,match_failure:{code:'no_match'}}],totals:{submitted:1},credits:{used:0,people:0}};
function fixture({eligible=true,ordinary=false,claimChanges={},response=()=>Response.json(matched),forgetFinish=false}={}){
 let claimed=false;const calls=[],http=[],finishes=[],writes=[];
 const db=async(path,method,body)=>{
  calls.push({path,method,body});
  if(path==='rpc/icash_take_dealmachine_request')return ordinary;
  if(path==='rpc/icash_claim_owner_demo_lookup'){
   assert.deepEqual(body,{p_id:lead});
   if(!eligible||claimed)return null;claimed=true;
   return {id:lead,token:'fixture-token',address:'45 Fixture Ln, Dallas, TX 75201',assignmentFeeCents:1000000,sellerCostReserveCents:100000,quotaRequestId:request,demoExpiresAt:new Date(Date.now()+240000).toISOString(),noAddressFallback:true,...claimChanges};
  }
  if(path==='rpc/icash_claim_seller_lookup_for'||path==='rpc/icash_claim_seller_lookup'){
   assert.equal(ordinary,true,'headroom must use its existing atomic lookup claim');return null;
  }
  if(path==='rpc/icash_finish_dealmachine_request'){
   finishes.push(body);assert.equal(body.p_request,request);
   if(forgetFinish)throw Error('Temporary metadata write failure');return true;
  }
  if(path==='rpc/icash_finish_seller_lookup'){writes.push(body);return true;}
  if(method==='PATCH'){writes.push(body);return [{id:lead}];}
  throw Error('Unexpected database path '+path);
 };
 const transport=async(url,options)=>{
  http.push({url,options});assert.equal(url,'https://api.v2.dealmachine.com/v1/enrichment/address');
  const body=JSON.parse(options.body);assert.equal(body.data.length,1);assert.equal(body.contact_audience,'none');
  return response();
 };
 return {calls,http,finishes,writes,db,transport,run:()=>processSellerIntake(db,'dm_sk_live_fixture',transport,lead)};
}
let f=fixture();assert.equal((await f.run()).status,'property_checked');
assert.equal(f.http.length,1);assert.equal(f.finishes[0].p_result.creditsUsed,1);assert.equal(f.writes[0].p_output.status,'qualified');
assert.equal((await f.run()).status,'rate_limited');assert.equal(f.http.length,1,'consumed allowance cannot be replayed');
assert(!f.calls.some(x=>x.path==='rpc/icash_claim_seller_lookup_for'));
f=fixture({eligible:false});assert.equal((await f.run()).status,'rate_limited');assert.equal(f.http.length,0);assert.equal(f.writes.length,0);
f=fixture();assert.equal((await processSellerIntake(f.db,'dm_sk_live_fixture',f.transport)).status,'rate_limited');
assert.equal(f.calls.length,1,'untargeted background work never asks for owner headroom');
f=fixture({ordinary:true});assert.equal((await f.run()).status,'idle_or_setup_required');assert(!f.calls.some(x=>x.path==='rpc/icash_claim_owner_demo_lookup'));
f=fixture({response:()=>Response.json(unmatched)});assert.equal((await f.run()).status,'property_checked');
assert.equal(f.http.length,1);assert.equal(f.writes[0].p_output.status,'unmatched');
assert.equal(f.calls.filter(x=>x.path==='rpc/icash_take_dealmachine_request').length,1,'zero-credit no-match never expands the one-request exception');
f=fixture({response:()=>Response.json({error:'limited'},{status:429,headers:{'Retry-After':'60','X-RateLimit-Limit':'70','X-RateLimit-Day-Limit':'10000','X-RateLimit-Day-Remaining':'0'}})});
assert.equal((await f.run()).status,'lookup_requires_review');assert.equal(f.http.length,1);
assert.equal(f.finishes[0].p_result.httpStatus,429);assert.equal(f.finishes[0].p_result.retryAfter,60);assert.equal(f.finishes[0].p_result.dayRemaining,0);
assert.equal(f.writes.at(-1).state,'review');await f.run();assert.equal(f.http.length,1);
f=fixture({response:()=>{throw Error('Ambiguous provider timeout');}});assert.equal((await f.run()).status,'lookup_requires_review');
assert.deepEqual(f.finishes[0],{p_request:request,p_result:{outcome:'unknown'}});await f.run();assert.equal(f.http.length,1);
f=fixture({claimChanges:{demoExpiresAt:new Date(Date.now()-1).toISOString()}});
assert.equal((await f.run()).status,'lookup_requires_review');assert.equal(f.http.length,0,'expired request never reaches provider');assert.equal(f.writes.at(-1).state,'review');
for(const claimChanges of [{id:'another-lead'},{noAddressFallback:false},{quotaRequestId:'invalid'},{demoExpiresAt:'invalid'}]){
 f=fixture({claimChanges});assert.equal((await f.run()).status,'lookup_requires_review');assert.equal(f.http.length,0);
}
f=fixture({forgetFinish:true});assert.equal((await f.run()).status,'property_checked');assert.equal(f.http.length,1);await f.run();assert.equal(f.http.length,1,'missing quota receipt does not retry the property purchase');
f=fixture({response:()=>new Response('invalid json',{status:200})});assert.equal((await f.run()).status,'lookup_requires_review');assert.equal(f.finishes[0].p_result.outcome,'http_error');assert.equal(f.http.length,1);
console.log('PASS owner-only atomic lookup use, single provider attempt, normal quota isolation, request expiry, provider cooldown receipts and no uncertain replay.');
