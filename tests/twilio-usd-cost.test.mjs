import assert from 'node:assert/strict';
import {twilioUsdChargeMicros as parse,twilioUnansweredCall} from '../lib/twilio-usd-cost.ts';
for(const unit of ['USD','usd']){
 for(const value of ['-0.0085','-0.0085000','-0.008500000000'])assert.equal(parse(value,unit),8500);
 assert.equal(parse('-0.00000100',unit),1);assert.equal(parse('0.0000000',unit),0);
 for(const value of [null,undefined,0,-0.0085,'0.0085','-0.0000001','-1e-3','NaN','Infinity','-9007199254.740992'])assert.equal(parse(value,unit),null);
}
for(const unit of [null,'EUR','unknown','Usd'])assert.equal(parse('-0.0085',unit),null);
for(const status of ['busy','failed','no-answer','canceled'])assert.equal(twilioUnansweredCall({status,duration:null,price:null,price_unit:null}),true);
for(const call of [{status:'completed',duration:'0',price:null,price_unit:null},{status:'in-progress',duration:null,price:null,price_unit:null},{status:'failed',duration:'1',price:null,price_unit:null},{status:'busy',duration:'0',price:'-0.01',price_unit:'USD'}])assert.equal(twilioUnansweredCall(call),false);
console.log('PASS: exact Twilio decimal costs normalize; only unanswered terminal calls are nonbillable.');
