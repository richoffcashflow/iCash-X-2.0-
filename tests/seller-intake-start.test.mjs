import assert from 'node:assert/strict';
import {processSellerIntake} from '../lib/seller-pipeline.ts';

// Execute the actual intake service using fictional receipts. No live provider,
// database or wallet is used. Contention is distinct from an uncertain claim.
// Advance only the service's retry clock so host scheduling cannot invalidate
// the successful-contention fixture under parallel CI load.
const originalNow=Date.now,originalSetTimeout=globalThis.setTimeout;let clock=originalNow();
Date.now=()=>clock;
globalThis.setTimeout=(callback,delay,...args)=>{queueMicrotask(()=>{clock+=Number(delay)||0;callback(...args);});return 0;};
try{
const lead='11111111-1111-4111-8111-111111111111';
const claim={id:lead,token:'fixture-token',address:'45 Fixture Ln, Dallas, TX 75201',assignmentFeeCents:1000000,sellerCostReserveCents:100000};
const result={data:[{matched:true,dm_property_id:'prop_123',full_address:'45 Fixture Lane, Dallas, TX 75201',city:'Dallas',state:'TX',zip:'75201',property_type:1,estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:50000}],totals:{submitted:1},credits:{used:1,people:0}};
const busy={status:'admission_busy'};
function fixture(sequence,{target=lead,providerError=false,beforeReturn=()=>{},requestChanges={},missingRequest=false}={}){
 let admissions=0,providerCalls=0,finishes=0,exceptions=0;
 const db=async(path,method,body)=>{
  if(path.startsWith('icash_optin_call_requests?')){
   const q=new URLSearchParams(path.split('?')[1]);assert.equal(q.get('lead_id'),'eq.'+lead);assert.equal(q.get('intake.state'),'eq.received');assert.equal(q.get('intake.claim_token'),'is.null');
   const stamp=Date.now();return missingRequest?[]:[{lead_id:lead,request_id:'original-request',phone:'+12125550123',requested_at:new Date(stamp-1000).toISOString(),expires_at:new Date(stamp+299000).toISOString(),intake:{id:lead,request_id:'original-request',phone:'+12125550123'},...requestChanges}];
  }
  if(path==='rpc/icash_claim_seller_lookup_admitted_for'||path==='rpc/icash_claim_seller_lookup_admitted'){
   assert.equal(method,'POST');assert.deepEqual(body,target?{p_id:target}:{});
   const value=sequence[Math.min(admissions++,sequence.length-1)];
   beforeReturn(admissions);if(value instanceof Error)throw value;return value;
  }
  if(path==='rpc/icash_claim_owner_demo_lookup'){exceptions++;return null;}
  if(path==='rpc/icash_finish_seller_lookup'){finishes++;assert.equal(body.p_id,lead);return true;}
  if(method==='PATCH')return [];
  throw Error('Unexpected database operation '+path);
 };
 const provider=async()=>{providerCalls++;if(providerError)throw Error('Uncertain provider request');return Response.json(result);};
 return {run:()=>processSellerIntake(db,'dm_sk_live_fixture',provider,target),counts:()=>({admissions,providerCalls,finishes,exceptions})};
}
for(const sequence of [[busy,claim],[busy,busy,claim]]){
 const f=fixture(sequence);assert.equal((await f.run()).status,'property_checked');
 assert.deepEqual(f.counts(),{admissions:sequence.length,providerCalls:1,finishes:1,exceptions:0},'Transient no-claim contention continues within the same intake attempt');
}
let f=fixture([busy]);assert.equal((await f.run()).status,'admission_busy');
assert.deepEqual(f.counts(),{admissions:3,providerCalls:0,finishes:0,exceptions:0},'Persistent contention stays bounded and cannot acquire owner exception');
f=fixture([busy],{target:null});assert.equal((await f.run()).status,'admission_busy');assert.equal(f.counts().admissions,1,'Generic worker passes do not multiply quota contention');
for(const terminal of [null,{status:'rate_limited'},new Error('Lost claim response')]){
 f=fixture([busy,terminal,claim]);
 if(terminal instanceof Error)await assert.rejects(f.run(),/Lost claim response/);
 else assert.equal((await f.run()).status,terminal?'rate_limited':'idle_or_setup_required');
 assert.equal(f.counts().admissions,2);assert.equal(f.counts().providerCalls,0,'No retry of idle, denied or ambiguous admission');
 assert.equal(f.counts().exceptions,terminal&&!(terminal instanceof Error)?1:0,'Only existing exact quota-denial path may inspect owner exception');
}
f=fixture([busy,claim],{providerError:true});assert.equal((await f.run()).status,'lookup_requires_review');assert.equal(f.counts().providerCalls,1,'A claimed purchase is never retried after uncertain provider response');
f=fixture([busy,claim],{beforeReturn:()=>{clock+=1000;}});
assert.equal((await f.run()).status,'admission_busy');assert.equal(f.counts().admissions,1,'A slow admission response exhausts the short retry window');
for(const requestChanges of [{expires_at:new Date(Date.now()-1).toISOString()},{requested_at:new Date(Date.now()+1000).toISOString()},{lead_id:'another-lead'},{intake:{id:lead,request_id:'different-request',phone:'+12125550123'}},{intake:{id:lead,request_id:'original-request',phone:'+12125550999'}}]){
 f=fixture([busy,claim],{requestChanges});assert.equal((await f.run()).status,'admission_busy');assert.equal(f.counts().admissions,1,'Expired, future or source-mismatched request cannot acquire a retry');
}
f=fixture([busy,claim],{missingRequest:true});assert.equal((await f.run()).status,'admission_busy');assert.equal(f.counts().admissions,1);
f=fixture([busy,busy,claim],{requestChanges:{requested_at:new Date(clock-299800).toISOString(),expires_at:new Date(clock+200).toISOString()}});
assert.equal((await f.run()).status,'admission_busy');assert.equal(f.counts().admissions,2,'The original request expiry cancels a later retry without refreshing its timestamp');
console.log('PASS targeted intake contention recovers once without minute-queue delay; bounded retries preserve quota, unknown claims, generic worker pacing and once-only provider work.');
}finally{Date.now=originalNow;globalThis.setTimeout=originalSetTimeout;}
