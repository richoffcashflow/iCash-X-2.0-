import assert from 'node:assert/strict';
import {cashOfferCalculation,wholesaleFeeForArv} from '../lib/cash-offer-math.ts';
const prescott=cashOfferCalculation(21100000,5918500);
assert.equal(prescott.afterRepairsCents,15181500);
assert.equal(prescott.buyerCeilingCents,8851500);
assert.equal(prescott.assignmentFeeCents,1000000);
assert.equal(prescott.sellerCeilingCents,7851500);
assert.equal(wholesaleFeeForArv(29999999),1000000);
assert.equal(wholesaleFeeForArv(30000000),2000000);
assert.equal(cashOfferCalculation(30000000,5000000).sellerCeilingCents,14000000);
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

assert.equal(prescott.version,'arv_70_less_repairs_v3');
assert.equal(prescott.formula,'ARV × 70% - repairs - wholesale fee');
assert.equal(cashOfferCalculation(101,1,{assignmentFeeCents:0}).sellerCeilingCents,69,'subtract the entire repair amount after flooring 70% of ARV');
assert.equal(cashOfferCalculation(10000,7000,{assignmentFeeCents:0}).sellerCeilingCents,null);
assert.equal(cashOfferCalculation(10000,7001,{assignmentFeeCents:0}).buyerCeilingCents,0);
assert.equal(cashOfferCalculation(10000,0,{assignmentFeeCents:7000}).sellerCeilingCents,null);
assert.equal(cashOfferCalculation(30000000,5000000,{assignmentFeeCents:1500000,ruleBasisPoints:6500}).sellerCeilingCents,13000000);
for(const [arv,repairs,fee] of [[101,1,0],[20000000,4000000,1000000],[30000000,5000000,2000000],[Number.MAX_SAFE_INTEGER,1,0]]){
 const actual=cashOfferCalculation(arv,repairs,{assignmentFeeCents:fee});
 const exact=BigInt(arv)*7000n/10000n-BigInt(repairs)-BigInt(fee);
 assert.equal(actual.sellerCeilingCents,exact>0n?Number(exact):null);
}
