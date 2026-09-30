import assert from 'node:assert/strict';
import {dealCardSummary} from '../lib/deal-card-summary.ts';
const deal={id:'own',stage:'draft',terms:{priceCents:10000000}};
const signature={deal_id:'own',kind:'purchase',state:'completed',test_mode:false};
assert.equal(dealCardSummary(undefined,[]),null);
for(const e of [{...signature,test_mode:true},{...signature,deal_id:'other'},{...signature,state:'awaiting_counterparty'}]){
 const view=dealCardSummary(deal,[e]);assert.equal(view.priceCents,null);assert.equal(view.steps[0].done,false);
}
assert.equal(dealCardSummary(deal,[{...signature,kind:'assignment'}]).steps[1].done,false);
const signed=dealCardSummary(deal,[signature]);assert.equal(signed.priceCents,10000000);assert.equal(signed.steps[0].done,true);assert.equal(signed.steps[3].done,false);
assert.equal(dealCardSummary({...deal,stage:'closing'},[signature]).steps[3].done,false);
assert.equal(dealCardSummary({...deal,stage:'canceled'},[signature]).steps[3].done,false);
assert.equal(dealCardSummary({...deal,stage:'closed'},[signature]).steps[3].done,true);
console.log('Deal cards exclude test/other-deal signatures and do not imply closing or unsigned prices.');
