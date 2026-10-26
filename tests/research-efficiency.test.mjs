// Synthetic local receipts only. Never calls a real provider.
import assert from 'node:assert/strict';
import {ownerBatchAudience,allocateOwnerBatch,enrichOwnerBatch} from '../lib/owner-batch.ts';
import {dealMachineRequest,DealMachineQuotaError} from '../lib/dealmachine-request.ts';
import {discoverPage} from '../lib/discovery-pipeline.ts';
import {screenEquity,sellerCallFinancialGate} from '../lib/equity-screen.ts';
import {researchEligibilityFilters} from '../lib/research-query-policy.ts';
import {OwnerPreviewRateLimitError} from '../lib/owner-enrichment-deferral.ts';
const snapshot=id=>({propertyId:id,propertyType:'house',fetchedAt:new Date().toISOString(),sellerCostReserveCents:100000,raw:{data:{dm_property_id:id,full_address:'Synthetic',estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:50000}}});
const candidates=[1,2,3].map(i=>({screeningId:String(i),snapshot:snapshot('prop_'+i)}));
const zero={used:0,people:0,properties:0,deduplicated:0};
const preview={data:candidates.map((c,i)=>({dm_property_id:c.snapshot.propertyId,found:true,contacts:[{dm_person_id:'per_shared',contact_type:'owner'},{dm_person_id:'per_'+i,contact_type:'owner'},{dm_person_id:'per_renter',is_likely_renter:true,is_likely_owner:true}]})),totals:{submitted:3,found:3,not_found:0},credits:zero};
const audience=ownerBatchAudience(preview,candidates,25),ids=[...new Set(audience.flatMap(a=>a.ids))];
assert.deepEqual(ids,['per_shared','per_0','per_1','per_2']);
const receipt={data:ids.map((id,i)=>({dm_person_id:id,found:i!==3,full_name:'Synthetic',phones:[{number:'+12145550123',do_not_call:true}]})),totals:{submitted:4,found:3,not_found:1},credits:{used:2,people:3,properties:0,deduplicated:1}};
const results=allocateOwnerBatch(receipt,audience,'batch');
assert.deepEqual(results.map(x=>x.result.creditsUsed),[2,0,0]);
assert.deepEqual(results.map(x=>x.result.peopleCredits),[2,1,0]);
assert.equal(results.reduce((n,r)=>n+r.result.providerCredits.deduplicated,0),1);
assert.equal(results[2].result.contacts.length,1,'A shared owner is still associated with each source property');
assert(results.every(r=>r.result.outreachAuthorized===false&&r.result.contacts.every(c=>!c.ownershipVerified&&c.phones[0].doNotCall)));
for(const mutate of [r=>r.data.push(r.data[0]),r=>r.data[0].dm_person_id='per_foreign',r=>r.credits.used++,r=>r.data[0].properties=[]]){
 const bad=structuredClone(receipt);mutate(bad);assert.throws(()=>allocateOwnerBatch(bad,audience,'batch'),/RECONCILIATION/);
}
for(const mutate of [r=>r.data[0].dm_property_id='prop_999',r=>r.credits.used=1,r=>r.totals.found=0]){
 const bad=structuredClone(preview);mutate(bad);assert.throws(()=>ownerBatchAudience(bad,candidates,25),/PREVIEW_INVALID/);
}
assert.equal(screenEquity({has_active_lien:'Yes'},100).status,'title_review_needed');
assert.equal(screenEquity({is_tax_delinquent:'Yes'},100).status,'title_review_needed');
assert.equal(screenEquity({has_active_lien:'No',is_tax_delinquent:'No',total_estimated_loan_balance:0},100).status,'payoff_verification_needed');
const calls=[],policy={version:'research-efficiency-v1',exclusionListId:'fixture-list'};
await discoverPage({zip:'75217',page:9,perPage:25,unitCostMicros:10000,quotedDataCostMicros:250000,queryPolicy:policy},{request:async body=>{calls.push(body);return body.estimate_cost?{estimated_credits:{this_page:25,breakdown:{people:0}}}:{data:[{dm_property_id:'prop_1',full_address:'Synthetic'}],credits:{used:1,people:0},pagination:{has_next_page:true}};},reserveAndClaim:async()=>true,persist:async r=>{assert.deepEqual(r.queryPolicy,policy);return 1;}});
assert(calls.every(c=>c.page===1&&c.per_page===25&&c.exclude_lists.property_list_ids[0]==='fixture-list'&&c.contact_audience==='none'));
assert(calls[0].filters.some(f=>f.filter_id==='num_total_open_liens'&&f.value===0));
const policyV2={...policy,version:'research-efficiency-v2'},v2Calls=[];
await discoverPage({zip:'75217',page:3,perPage:25,unitCostMicros:10000,quotedDataCostMicros:250000,queryPolicy:policyV2},{request:async body=>{v2Calls.push(body);return body.estimate_cost?{estimated_credits:{this_page:25,breakdown:{people:0}}}:{data:[{dm_property_id:'prop_2',full_address:'Synthetic'}],credits:{used:1,people:0},pagination:{has_next_page:true}};},reserveAndClaim:async()=>true,persist:async r=>{assert.deepEqual(r.queryPolicy,policyV2);return 1;}});
assert(v2Calls.every(c=>c.page===1&&c.per_page===25&&!c.filters.some(f=>['num_total_active_liens','num_total_open_liens','total_open_lien_amount'].includes(f.filter_id))));
assert.equal(researchEligibilityFilters('research-efficiency-v2').length,3);
// Reproduce observed optional-field shapes without any real property/customer.
// They remain preliminarily eligible; positive numeric evidence still holds.
for(const amount of [null,'$0.00']){
 const property={estimated_value:200000,estimated_equity_percentage:75,total_estimated_loan_balance:50000,has_active_lien:'No',has_hoa_lien:'No',is_tax_delinquent:'No',num_total_active_liens:0,num_total_open_liens:null,total_open_lien_amount:amount};
 const gate=p=>sellerCallFinancialGate(screenEquity(p,10000000),{sellerOfferCents:10000000,sellerCostReserveCents:100000,checkedAt:Date.now()});
 assert.equal(gate(property).status,'eligible');
 for(const positive of [{num_total_active_liens:1},{num_total_open_liens:1},{total_open_lien_amount:100},{has_active_lien:'Yes'},{has_hoa_lien:'Yes'},{is_tax_delinquent:'Yes'}])assert.equal(gate({...property,...positive}).status,'hold');
 assert.equal(screenEquity(property,10000000).titleStatus,'unverified');
}
await assert.rejects(discoverPage({zip:'75217',page:1,perPage:25,unitCostMicros:10000,quotedDataCostMicros:250000},{}),/CONFIGURATION_INVALID/);
let admitted=false,network=0,metrics=[];
const metricDb=async(path,method,body)=>path.includes('finish_')?metrics.push(body.p_result):admitted;
await assert.rejects(dealMachineRequest(metricDb,'owner_lookup',async()=>{network++;}),DealMachineQuotaError);assert.equal(network,0);
admitted=null;await assert.rejects(dealMachineRequest(metricDb,'owner_lookup',async()=>{network++;}),e=>!(e instanceof DealMachineQuotaError));assert.equal(network,0);
admitted=true;await assert.rejects(dealMachineRequest(metricDb,'owner_lookup',async()=>{network++;throw Error('timeout');}),/timeout/);assert.equal(network,1);assert.deepEqual(metrics,[{outcome:'unknown'}]);
metrics=[];await dealMachineRequest(metricDb,'owner_lookup',async()=>Response.json(receipt,{headers:{'X-RateLimit-Remaining':'8'}}));assert.equal(metrics[0].creditsUsed,2);assert.equal(metrics[0].minuteRemaining,8);assert(!JSON.stringify(metrics).includes('per_shared'));
// End-to-end service: one preview and one paid request for three properties;
// an uncertain paid request cannot be replayed because the durable claim exists.
process.env.DEALMACHINE_API_KEY='dm_sk_live_LOCAL_FIXTURE';
let claimed=false,paid=0,saved=0,original=0,timeout=false,admissions=0,denyBatch=false;
const db=async(path,method,body)=>{
 if(path==='rpc/icash_owner_batch_candidates')return claimed?[]:candidates;
 if(path==='rpc/icash_take_dealmachine_request'){admissions++;assert.equal(body.p_kind,'owner_preview','Paid capacity belongs to the atomic SQL batch claim');return true;}
 if(path==='rpc/icash_finish_dealmachine_request')return true;
 if(path==='rpc/icash_admit_owner_batch'){assert.equal(body.p_items.length,3);assert.deepEqual(body.p_preview,preview);if(denyBatch)return 'quota_wait';claimed=true;return 'claimed';}
 if(path==='rpc/icash_record_owner_batch_receipt'){original++;assert.deepEqual(body.p_receipt,receipt);return true;}
 if(path==='rpc/icash_save_owner_batch'){assert.equal(original,1);saved++;return true;}
 throw Error('Unexpected RPC '+path);
};
const transport=async(url,init)=>{const b=JSON.parse(init.body);if(url.endsWith('/properties/ids')){assert.equal(b.enrich,false);return Response.json(preview);}assert(claimed);paid++;assert.deepEqual(b.ids,ids);if(timeout)throw Error('timeout');return Response.json(receipt);};
const config={contact_rate_id:'rate',contact_credit_cap:25,property_credit_micros:10000,data_rights_until:'2099-01-01'};
denyBatch=true;await assert.rejects(enrichOwnerBatch(db,'account','1',config,250000,transport),OwnerPreviewRateLimitError);assert.equal(paid,0);assert.equal(claimed,false);denyBatch=false;admissions=0;
assert.equal((await enrichOwnerBatch(db,'account','1',config,250000,transport)).batchProperties,3);assert.equal(paid,1);assert.equal(saved,1);
assert.equal(admissions,1,'There is no second limiter call after financial admission');
assert.equal((await enrichOwnerBatch(db,'account','1',config,250000,transport)).status,'held');assert.equal(paid,1);
claimed=false;timeout=true;await assert.rejects(enrichOwnerBatch(db,'account','1',config,250000,transport),/timeout/);assert.equal(paid,2);
assert.equal((await enrichOwnerBatch(db,'account','1',config,250000,transport)).status,'held');assert.equal(paid,2);
console.log('Research efficiency: 25-record query policy, owner batching, exact aggregate allocation, protected contacts, telemetry and no paid replay passed.');
