import assert from 'node:assert/strict';
import {twilioUsdChargeMicros as parse} from '../lib/twilio-usd-cost.ts';
for(const unit of ['USD','usd']){
 for(const value of ['-0.0085','-0.0085000','-0.008500000000'])assert.equal(parse(value,unit),8500);
 assert.equal(parse('-0.00000100',unit),1);assert.equal(parse('0.0000000',unit),0);
 for(const value of [null,undefined,0,-0.0085,'0.0085','-0.0000001','-1e-3','NaN','Infinity','-9007199254.740992'])assert.equal(parse(value,unit),null);
}
for(const unit of [null,'EUR','unknown','Usd'])assert.equal(parse('-0.0085',unit),null);
console.log('PASS: exact Twilio decimal costs normalize without rounding or inventing charges.');
