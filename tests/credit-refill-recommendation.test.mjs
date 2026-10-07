import assert from 'node:assert/strict';
import {creditRefillRecommendation as recommend,fundingReasonAtAmount} from '../lib/credit-refill-recommendation.ts';
import {workspaceConversionOffer} from '../lib/workspace-conversion.ts';
const now=Date.parse('2026-10-07T21:00:00Z');
const history=(amounts)=>amounts.map((price_cents,index)=>({price_cents,credited_at:new Date(now-index*86400000).toISOString(),auto_recharge:false}));
assert.equal(recommend(0,[],[],now).amountCents,1000);
for(const usual of [1000,2500,5000,7500,10000,3742]){
 const result=recommend(0,history([usual,usual,usual]),[],now);
 assert.equal(result.amountCents,usual,'Use the customer’s usual confirmed upload');
 assert.equal(result.lowBalanceCents,Math.max(500,Math.ceil(usual*.2)));
}
assert.equal(recommend(0,history([1000,1000,100000]),[],now).amountCents,1000,'An unusually large deposit does not dominate');
assert.equal(recommend(0,history([1000,1000,1000,1000,1000,100000]),[],now).amountCents,1000);
assert.equal(recommend(0,[...history([1000]),{...history([100000])[0],auto_recharge:true}],[],now).amountCents,1000);
assert.equal(recommend(0,[{...history([10000])[0],credited_at:new Date(now-31*86400000).toISOString()}],[],now).amountCents,1000);
const usage=[{delta_cents:-8300,created_at:new Date(now-3600000).toISOString()}];
assert.equal(recommend(0,history([2500]),usage,now).amountCents,8500);
assert.equal(recommend(4000,history([2500]),usage,now).amountCents,4500,'Remaining credits reduce the additional usage estimate');
assert.equal(recommend(10000,history([2500]),usage,now).amountCents,2500);
assert.equal(recommend(0,history([2500]),Array(1001).fill(usage[0]),now).amountCents,2500,'Truncated usage is not presented as a reliable rate');
assert.equal(recommend(0,history([2500]),[{...usage[0],delta_cents:-1000000}],now).amountCents,100000,'Respect maximum purchase');
assert.equal(fundingReasonAtAmount('Research queued. Add $75 in credits for work.',5000),'Research queued. Add $50 in credits for work.');
assert.equal(fundingReasonAtAmount('Add $1,000 in credits for work.',3742),'Add $37.42 in credits for work.');
assert.equal(fundingReasonAtAmount('Add $75 in credits for work.',null),'Choose an amount in credits for work.');
const base={balanceCents:700,paused:false,billingReview:false,identityReady:true,membershipActive:true,canFund:true,autoRechargeEnabled:false,recentPurchase:false,queuedResearch:0,completedResearch:0,vipAvailable:true,vip:false};
assert.equal(workspaceConversionOffer({...base,refill:recommend(700,history([1000]),[],now)}).action,'vip');
const offer=workspaceConversionOffer({...base,refill:recommend(700,history([7500]),[],now)});
assert.equal(offer.action,'funding');assert.equal(offer.amountCents,7500);assert.match(offer.button,/\$75/);assert.match(offer.detail,/\$75/);
console.log('PASS personalized funding: usual manual deposits, outlier resistance, usage/balance adjustment, bounds, dynamic low threshold, and editable matching copy.');
