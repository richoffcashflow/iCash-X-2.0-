import assert from 'node:assert/strict';
import {propertyContext,propertyVoiceContext} from '../lib/property-context.ts';
import {loadTestProperty} from '../lib/dealmachine-property.ts';
const id='prop_12345',at='2026-09-28T19:00:00Z';
const raw={data:{dm_property_id:id,full_address:'Example property (fixture)',estimated_value:200000,estimated_repair_cost:40000},credits:{used:1,people:0}};
const p=propertyContext(raw,id,at);
assert.equal(p.arvEstimate.cents,20000000);
assert.equal(p.arvEstimate.reviewed,false);
assert.equal(p.screeningBuyerCeilingCents,11200000);
assert.equal(p.offer.maxSellerOfferCents,null);
assert.equal(p.offerAuthorized,false);
assert.equal(p.vendorCostUsd,null);
assert.equal(p.vendorCreditsUsed,1);
assert.match(propertyVoiceContext(p),/not a verified appraisal or approved offer/);
assert.equal(propertyContext({data:{...raw.data,estimated_value:null}},id,at).screeningBuyerCeilingCents,null);
assert.equal(propertyContext({data:{...raw.data,estimated_value:'200000'}},id,at).arvEstimate.cents,null);
assert.equal(propertyContext({data:{...raw.data,estimated_repair_cost:null}},id,at).screeningBuyerCeilingCents,null);
assert.equal(propertyContext({data:{...raw.data,estimated_repair_cost_low:30000,estimated_repair_cost_high:50000}},id,at).screeningBuyerCeilingCents,11200000);
assert.equal(propertyContext({data:{...raw.data,estimated_repair_cost_low:60000,estimated_repair_cost_high:50000}},id,at).screeningBuyerCeilingCents,11200000);
assert.equal(propertyContext({data:{...raw.data,estimated_repair_cost:150000}},id,at).screeningBuyerCeilingCents,3500000);
assert.throws(()=>propertyContext(raw,'prop_999',at));
assert.throws(()=>propertyContext(null,id,at));
let calls=0;
const transport=async(url,options)=>{calls++;const u=new URL(url);assert.equal(u.hostname,'api.v2.dealmachine.com');assert.equal(u.searchParams.get('contact_audience'),'none');assert.equal(u.searchParams.get('enrich'),'true');assert(u.searchParams.get('fields').split(',').includes('estimated_repair_cost'));assert(!u.searchParams.get('fields').includes('estimated_repair_cost_low'));assert(!u.searchParams.get('fields').includes('estimated_repair_cost_high'));assert.equal(options.redirect,'error');return Response.json(raw);};
assert.equal((await loadTestProperty(id,'dm_sk_live_fixture',transport)).propertyId,id);
assert.equal(calls,1);
await assert.rejects(()=>loadTestProperty('../usage','dm_sk_live_fixture',transport));assert.equal(calls,1);
calls=0;
await assert.rejects(()=>loadTestProperty(id,'dm_sk_live_fixture',async()=>{calls++;throw new Error('private vendor details');}),{message:'PROPERTY_LOOKUP_FAILED_NO_RETRY'});
assert.equal(calls,1);
console.log('Property context, ARV mapping, offer gates and bounded lookup tests passed');

// Range data must never override, invalidate, or replace the authoritative scalar.
for(const scalar of [null,undefined,'40000',-1,Infinity,NaN,0.001]){
 const context=propertyContext({data:{...raw.data,estimated_repair_cost:scalar,estimated_repair_cost_low:30000,estimated_repair_cost_high:50000}},id,at);
 assert.equal(context.screeningBuyerCeilingCents,null);
 assert.equal(context.repairs.baselineCents,null);
 assert.equal(context.offer.maxSellerOfferCents,null);
}
const zero=propertyContext({data:{...raw.data,estimated_repair_cost:0,estimated_repair_cost_low:30000,estimated_repair_cost_high:50000}},id,at);
assert.equal(zero.screeningBuyerCeilingCents,14000000);
assert.equal(zero.repairs.estimateStatus,'available');
const ranged=propertyContext({data:{...raw.data,estimated_repair_cost_low:30000,estimated_repair_cost_high:50000}},id,at);
assert.equal(ranged.repairs.sourceField,'estimated_repair_cost');
const voiceData=JSON.parse(propertyVoiceContext(ranged).split('DATA: ')[1]);
assert.equal(voiceData.repairs.baselineCents,4000000);
assert.equal('rangeCents' in voiceData.repairs,false);

assert.equal(propertyContext({data:{...raw.data,estimated_value:200000.001}},id,at).arvEstimate.cents,null);
assert.equal(propertyContext({data:{...raw.data,estimated_repair_cost:200000}},id,at).screeningBuyerCeilingCents,null);
