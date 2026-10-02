import assert from 'node:assert/strict';
import {runScreeningJob} from '../lib/screening-job.ts';
import {tick,createRpc} from '../worker/runner.mjs';
const now=Date.now();
const snapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:100000,raw:{data:{dm_property_id:'prop_123',full_address:'Fixture only',estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:50000}}};
assert.equal(runScreeningJob(snapshot,now).financialCheck.status,'eligible');
assert.equal(runScreeningJob(snapshot,now).outreachAuthorized,false);
assert.equal(runScreeningJob({...snapshot,propertyType:'land'},now).financialCheck.status,'hold');
assert.equal(runScreeningJob({...snapshot,sellerCostReserveCents:undefined},now).financialCheck.status,'hold');
assert.throws(()=>runScreeningJob({...snapshot,fetchedAt:'bad'},now));
assert.throws(()=>runScreeningJob(snapshot,now+86400001));
const calls=[];await tick(async(name,args)=>{calls.push({name,args});return name==='icash_claim_screening'?{id:'j',leaseToken:'t',snapshot}:true;});
assert.equal(calls.length,2);assert.equal(calls[1].args.p_result.financialCheck.status,'eligible');
let invoked=false;assert.equal(await tick(async()=>null,()=>{invoked=true;}),false);assert.equal(invoked,false);
await tick(async(name,args)=>{if(name==='icash_claim_screening')return {id:'j',leaseToken:'t',snapshot:null};assert.equal(args.p_error,'INVALID_SNAPSHOT');});
assert.throws(()=>createRpc('https://other.example','secret'));
await assert.rejects(createRpc('https://example.supabase.co','fixture',async()=>new Response('secret error',{status:500}))('icash_claim_screening',{}),{message:'SCREENING_DATABASE_UNAVAILABLE'});
console.log('Screening worker: stale data, underwriting, no outreach, empty queue and error handling passed');

// Same 70% ARV discount and assignment fee, using exactly one provider repair figure.
const scalarSnapshot={...snapshot,assignmentFeeCents:1500000,raw:{data:{...snapshot.raw.data,estimated_repair_cost_low:30000,estimated_repair_cost_high:50000}}};
const scalarJob=runScreeningJob(scalarSnapshot,now);
assert.equal(scalarJob.property.screeningBuyerCeilingCents,10000000);
assert.equal(scalarJob.preliminarySellerCeilingCents,8500000);
for(const repairs of [null,undefined,'40000',-1]){
 const job=runScreeningJob({...scalarSnapshot,raw:{data:{...scalarSnapshot.raw.data,estimated_repair_cost:repairs}}},now);
 assert.equal(job.preliminarySellerCeilingCents,null);
 assert.notEqual(job.financialCheck.status,'eligible');
 assert.equal(job.offerAuthorized,false);
}
assert.equal(runScreeningJob({...scalarSnapshot,raw:{data:{...scalarSnapshot.raw.data,estimated_repair_cost:0}}},now).preliminarySellerCeilingCents,12500000);
