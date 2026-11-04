import assert from 'node:assert/strict';
import {recoverPendingOwnerDemoLookup} from '../lib/owner-demo-lookup-recovery.ts';
import {processSellerIntake} from '../lib/seller-pipeline.ts';
import {ownerInboundTarget} from '../lib/owner-inbound-acceptance.ts';
import {optinCallNowVersion} from '../lib/optin-call-now.ts';

// Real lookup service, synthetic saved receipts and transport only.
const lead='11111111-1111-4111-8111-111111111111',quota='22222222-2222-4222-8222-222222222222';
const matched={data:[{matched:true,dm_property_id:'prop_123',full_address:'45 Fixture Lane, Dallas, TX 75201',city:'Dallas',state:'TX',zip:'75201',property_type:1,estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:50000}],totals:{submitted:1},credits:{used:1,people:0}};
let permit=false,claimed=false,state='received',calls=[],sent=0,resultRows,transportFails=false,ordinary=false,afterRead=()=>{};
const start=Date.now(),original={lead_id:lead,requested_at:new Date(start-60000).toISOString(),expires_at:new Date(start+240000).toISOString()};
const db=async(path,method,body)=>{
 calls.push({path,method,body});
 if(path.startsWith('icash_optin_call_requests?')){
  assert.equal(method,undefined,'candidate selection is read-only');
  const p=new URLSearchParams(path.split('?')[1]);
  assert.equal(p.get('select'),'lead_id,requested_at,expires_at,intake:icash_seller_intakes!inner(id)');
  for(const [key,value] of Object.entries({account_id:ownerInboundTarget.accountId,requested_by:ownerInboundTarget.ownerUserId,phone:ownerInboundTarget.ownerPhone,source:'demo_form',request_version:optinCallNowVersion,request_reference:optinCallNowVersion,'intake.phone':ownerInboundTarget.ownerPhone,'intake.attribution->>demoAccountId':ownerInboundTarget.accountId,'intake.state':'received','intake.contact_consent_scope':'icash_x_demo'}))assert.equal(p.get(key),'eq.'+value);
  for(const field of ['claim_token','claimed_at','canonical_id'])assert.equal(p.get('intake.'+field),'is.null');
  assert.equal(p.get('limit'),'1');assert.equal(p.get('order'),'requested_at.asc,lead_id.asc');
  assert(p.get('expires_at').startsWith('gt.'));
  assert.equal(p.getAll('requested_at').length,2);assert(p.getAll('requested_at').some(x=>x.startsWith('gt.')));assert(p.getAll('requested_at').some(x=>x.startsWith('lte.')));
  afterRead();return resultRows??(state==='received'?[structuredClone(original)]:[]);
 }
 if(path==='rpc/icash_take_dealmachine_request')return ordinary;
 if(path==='rpc/icash_claim_owner_demo_lookup'||path==='rpc/icash_claim_seller_lookup_for'){
  assert.deepEqual(body,{p_id:lead});
  if(!permit||claimed)return null;
  claimed=true;state='checking';return {id:lead,token:'fixture-claim',address:'45 Fixture Lane, Dallas, TX 75201',assignmentFeeCents:1000000,sellerCostReserveCents:100000,quotaRequestId:quota,demoExpiresAt:original.expires_at,noAddressFallback:true};
 }
 if(path==='rpc/icash_finish_dealmachine_request')return true;
 if(path==='rpc/icash_finish_seller_lookup'){state='qualified';return true;}
 if(method==='PATCH'){state='review';return [];}
 throw Error('Unexpected database operation '+path);
};
const transport=async()=>{sent++;if(transportFails)throw Error('Unknown provider outcome');return Response.json(matched);};
const key='dm_sk_live_fixture';
assert.equal((await processSellerIntake(db,key,transport,lead)).status,'rate_limited','the form can hit a temporary admission denial');
assert.equal(sent,0);const receiptBefore=structuredClone(original);
assert.equal((await recoverPendingOwnerDemoLookup(db,key,transport)).status,'rate_limited','unchanged minute/cooldown or funds denial remains authoritative');
assert.equal(sent,0);permit=true;
assert.deepEqual(await recoverPendingOwnerDemoLookup(db,key,transport),{status:'property_checked',leadId:lead});
assert.equal(sent,1);assert.equal(calls.filter(c=>c.path==='rpc/icash_take_dealmachine_request').length,3,'each targeted attempt checks ordinary admission exactly once');
assert.deepEqual(original,receiptBefore,'no request renewal or receipt rewrite');
assert.equal((await recoverPendingOwnerDemoLookup(db,key,transport)).status,'owner_demo_recovery_idle');assert.equal(sent,1,'completed work is not replayed');

for(const changed of [{lead_id:'bad'},{requested_at:'invalid'},{expires_at:'invalid'},{requested_at:new Date(Date.now()+10000).toISOString(),expires_at:new Date(Date.now()+310000).toISOString()},{expires_at:new Date(Date.parse(original.expires_at)+1000).toISOString()},{requested_at:new Date(Date.now()-301000).toISOString(),expires_at:new Date(Date.now()-1000).toISOString()}]){
 resultRows=[{...original,...changed}];calls=[];
 assert.equal((await recoverPendingOwnerDemoLookup(db,key,transport)).status,'owner_demo_recovery_idle');
 assert.equal(calls.length,1,'malformed/expired receipt never attempts admission');
}
resultRows=[];calls=[];assert.equal((await recoverPendingOwnerDemoLookup(db,key,transport)).status,'owner_demo_recovery_idle');assert.equal(calls.length,1);
calls=[];assert.equal((await recoverPendingOwnerDemoLookup(db,undefined,transport)).status,'provider_not_configured');assert.equal(calls.length,0);
const realNow=Date.now;
try{
 resultRows=[original];calls=[];Date.now=()=>Date.parse(original.expires_at)-1;
 afterRead=()=>{Date.now=()=>Date.parse(original.expires_at);};
 assert.equal((await recoverPendingOwnerDemoLookup(db,key,transport)).status,'owner_demo_recovery_idle','expiry while the candidate GET waits is respected');
 assert.equal(calls.length,1,'a delayed selection cannot request paid admission');
}finally{Date.now=realNow;afterRead=()=>{};}

// Unknown outcomes consume the original claim and never produce a recovered
// lead for assignment. A later tick cannot issue a replacement request.
resultRows=undefined;claimed=false;state='received';transportFails=true;
assert.equal((await recoverPendingOwnerDemoLookup(db,key,transport)).status,'lookup_requires_review');
assert.equal(sent,2);assert.equal((await recoverPendingOwnerDemoLookup(db,key,transport)).status,'owner_demo_recovery_idle');assert.equal(sent,2);
// Once minute capacity returns before the daily cap, target the same original
// demo instead of allowing an older generic backlog to consume its window.
claimed=false;state='received';transportFails=false;ordinary=true;calls=[];
assert.deepEqual(await recoverPendingOwnerDemoLookup(db,key,transport),{status:'property_checked',leadId:lead});
assert.equal(calls.filter(c=>c.path==='rpc/icash_take_dealmachine_request').length,1);
assert.equal(calls.filter(c=>c.path==='rpc/icash_claim_seller_lookup_for').length,1);
assert.equal(calls.filter(c=>c.path==='rpc/icash_claim_owner_demo_lookup').length,0,'available ordinary capacity never uses headroom');
console.log('PASS fresh owner maintenance lookup: original denied request recovers through ordinary capacity or exact headroom, bounded selection, no admission without a candidate, preserved expiry/funds/cooldown, and no unknown replay.');
