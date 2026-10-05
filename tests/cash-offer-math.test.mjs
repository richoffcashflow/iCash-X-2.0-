import assert from 'node:assert/strict';
import {cashOfferCalculation,wholesaleFeeForArv} from '../lib/cash-offer-math.ts';
const prescott=cashOfferCalculation(21100000,5918500);
assert.equal(prescott.afterRepairsCents,15181500);
assert.equal(prescott.buyerCeilingCents,10627050);
assert.equal(prescott.assignmentFeeCents,1000000);
assert.equal(prescott.sellerCeilingCents,9627050);
assert.equal(wholesaleFeeForArv(29999999),1000000);
assert.equal(wholesaleFeeForArv(30000000),2000000);
assert.equal(cashOfferCalculation(30000000,5000000).sellerCeilingCents,15500000);
for(const input of [null,undefined,NaN,Infinity,-1,1.5,'21100000',Number.MAX_SAFE_INTEGER+1]){
 assert.equal(cashOfferCalculation(input,100),null);
 assert.equal(cashOfferCalculation(21100000,input),null);
}
assert.equal(cashOfferCalculation(20000000,0).sellerCeilingCents,13000000);
for(const repairs of [20000000,21000000,19500000])assert.equal(cashOfferCalculation(20000000,repairs).sellerCeilingCents,null);
assert.equal(cashOfferCalculation(101,0,{assignmentFeeCents:0}).sellerCeilingCents,70);
const huge=cashOfferCalculation(Number.MAX_SAFE_INTEGER,0,{assignmentFeeCents:0});
assert.equal(huge.buyerCeilingCents,Number(BigInt(Number.MAX_SAFE_INTEGER)*7000n/10000n));
assert.throws(()=>cashOfferCalculation(100,0,{ruleBasisPoints:70.5}));
assert.throws(()=>cashOfferCalculation(100,0,{ruleBasisPoints:7001}));
assert.throws(()=>cashOfferCalculation(100,0,{assignmentFeeCents:-1}));
assert.match(cashOfferCalculation(100,0,{ruleBasisPoints:6500}).formula,/65%/);
console.log('Cash offer formula, exact cents, fee tiers and invalid inputs passed');
