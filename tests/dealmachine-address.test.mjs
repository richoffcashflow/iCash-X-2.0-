import assert from 'node:assert/strict';
import {dealMachineAddress,sellerAddressFormatVersion} from '../lib/dealmachine-address.ts';
import {processSellerIntake} from '../lib/seller-pipeline.ts';

const submitted='5822 Lyndhurst Dr, Houston, TX 77033, USA';
const expected={street:'5822 Lyndhurst Dr',city:'Houston',state:'TX',zip:'77033'};
assert.deepEqual(dealMachineAddress(submitted),expected);
assert.deepEqual(dealMachineAddress('650 Gladiola Lp, Kyle, TX 78640, USA'),{street:'650 Gladiola Loop',city:'Kyle',state:'TX',zip:'78640'});
assert.deepEqual(dealMachineAddress('650 Gladiola lp. Apt 2, Kyle, TX 78640'),{street:'650 Gladiola Loop',unit:'Apt 2',city:'Kyle',state:'TX',zip:'78640'});
assert.equal(dealMachineAddress('12 Lp Ranch Rd, Kyle, TX 78640').street,'12 Lp Ranch Rd');
assert.equal(dealMachineAddress('12 Oak St Unit LP, Kyle, TX 78640').unit,'Unit LP');
assert.deepEqual(dealMachineAddress('650 Gladiola Lp Kyle TX 78640'),{full_address:'650 Gladiola Lp Kyle TX 78640'});
assert.deepEqual(dealMachineAddress(' 5822 Lyndhurst Dr ,  Houston , tx 77033-1234, United States '),expected);
for(const unit of ['Apt 4B','Unit 12','# 203','Suite 200']) {
 const result={street:'123 Test St',unit,city:'Austin',state:'TX',zip:'78701'};
 assert.deepEqual(dealMachineAddress(`123 Test St ${unit}, Austin, TX 78701, USA`),result);
 assert.deepEqual(dealMachineAddress(`123 Test St, ${unit}, Austin, TX 78701`),result);
}
assert.deepEqual(dealMachineAddress('123 Test St, St. Louis, MO, USA'),{street:'123 Test St',city:'St. Louis',state:'MO'});
for(const address of ['123 Test St Austin TX 78701','123 Test St, Unknown district, Austin, TX 78701','123 Test St, Austin, ZZ 78701','123 Test St, Montréal, QC, Canada']) {
 assert.deepEqual(dealMachineAddress(address),{full_address:address},'Ambiguous/manual/non-US components must not be guessed or discarded');
}
assert.throws(()=>dealMachineAddress(''));
const options={assignmentFeeCents:1000000,sellerCostReserveCents:100000};
let claimAvailable=true,calls=0,receipt;
const db=async(path,method,body)=>{
 if(path==='rpc/icash_take_dealmachine_request')return true;
 if(path==='rpc/icash_claim_seller_lookup_for') {assert.equal(body.p_id,'fixture-lead');if(!claimAvailable)return null;claimAvailable=false;return {id:'fixture-lead',token:'fixture-token',address:submitted,...options};}
 if(path==='rpc/icash_finish_seller_lookup') {receipt=body.p_output;return true;}
 if(method==='PATCH')return [{id:'fixture-lead'}];
 throw Error(path);
};
const transport=async(url,opts)=>{
 calls++;assert.deepEqual(JSON.parse(opts.body).data,[calls===1?expected:{full_address:'5822 Lyndhurst Dr, Houston, TX 77033'}]);assert.equal(JSON.parse(opts.body).contact_audience,'none');
 return Response.json({data:[{matched:false,match_failure:{code:'not_found',reason:'No property found matching the provided address'}}],totals:{submitted:1},credits:{used:0,people:0}});
};
assert.equal((await processSellerIntake(db,'dm_sk_live_fixture',transport,'fixture-lead')).status,'property_checked');
assert.equal(receipt.status,'unmatched');assert.equal(receipt.creditsUsed,0);
assert.equal(receipt.result.addressLookup.version,sellerAddressFormatVersion);
assert.deepEqual(receipt.result.addressAttempts[0].lookup.input,expected);
assert.deepEqual(receipt.result.addressLookup.input,{full_address:'5822 Lyndhurst Dr, Houston, TX 77033'});
assert.equal(receipt.result.addressLookup.failureCode,'not_found');
assert.equal(receipt.property,null);assert.equal(receipt.numbersPassed,false);
await processSellerIntake(db,'dm_sk_live_fixture',transport,'fixture-lead');assert.equal(calls,2,'Only one alternate format after an explicit no-charge no-match; no retry loop');
claimAvailable=true;
assert.equal((await processSellerIntake(db,'dm_sk_live_fixture',async()=>{calls++;throw Error('timeout');},'fixture-lead')).status,'lookup_requires_review');
await processSellerIntake(db,'dm_sk_live_fixture',transport,'fixture-lead');assert.equal(calls,3,'Unknown outcomes are never replayed');
console.log('PASS US address serialization, Loop suffix, unit preservation, one zero-cost alternate format and no timeout replay.');
