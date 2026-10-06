import assert from 'node:assert/strict';
import {dealMachineAddress,sellerAddressFormatVersion} from '../lib/dealmachine-address.ts';
import {processSellerIntake} from '../lib/seller-pipeline.ts';

const submitted='5822 Lyndhurst Dr, Houston, TX 77033, USA';
const expected={street:'5822 Lyndhurst Dr',city:'Houston',state:'TX',zip:'77033'};
assert.deepEqual(dealMachineAddress(submitted),expected);
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
 throw Error(path);
};
const transport=async(url,opts)=>{
 calls++;assert.deepEqual(JSON.parse(opts.body).data,[expected]);assert.equal(JSON.parse(opts.body).contact_audience,'none');
 return Response.json({data:[{matched:false,match_failure:{code:'not_found',reason:'No property found matching the provided address'}}],totals:{submitted:1},credits:{used:0,people:0}});
};
assert.equal((await processSellerIntake(db,'dm_sk_live_fixture',transport,'fixture-lead')).status,'property_checked');
assert.equal(receipt.status,'unmatched');assert.equal(receipt.creditsUsed,0);
assert.equal(receipt.result.addressLookup.version,sellerAddressFormatVersion);
assert.deepEqual(receipt.result.addressLookup.input,expected);
assert.equal(receipt.result.addressLookup.failureCode,'not_found');
assert.equal(receipt.property,null);assert.equal(receipt.numbersPassed,false);
await processSellerIntake(db,'dm_sk_live_fixture',transport,'fixture-lead');assert.equal(calls,1,'A documented no-match does not trigger an automatic paid retry');
claimAvailable=true;
assert.equal((await processSellerIntake(db,'dm_sk_live_fixture',async()=>{calls++;throw Error('timeout');},'fixture-lead')).status,'lookup_requires_review');
await processSellerIntake(db,'dm_sk_live_fixture',transport,'fixture-lead');assert.equal(calls,2,'Unknown outcomes are never replayed');
console.log('PASS US address serialization, unit preservation, no inferred components, provider failure evidence, one lookup and no timeout replay.');
