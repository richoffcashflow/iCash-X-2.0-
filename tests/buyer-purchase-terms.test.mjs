import test from 'node:test';
import assert from 'node:assert/strict';
import {buyerDepositCents,sellerViewingSlots,viewingSlotLabel} from '../lib/buyer-purchase-terms.ts';
import {calculateAutomaticCallOffer,automaticCallOffer} from '../lib/automatic-call-offer.ts';
import {renderBuyerPackage} from '../lib/buyer-disposition.ts';
const now=Date.parse('2026-10-09T19:00:00Z');
const slot={startsAt:'2026-10-16T19:00:00.000Z',endsAt:'2026-10-16T21:00:00.000Z',timezone:'America/Chicago'};
const buyer={address:'45 Fixture Lane',purchasePriceCents:15227050,assignmentFeeCents:1000000,askingPriceCents:16227050,depositCents:200000,closingDate:'2026-11-07',viewingSlots:[slot]};
test('deposit uses integer cents, rounds once and never exceeds $5,000',()=>{
 for(const [fee,deposit] of [[0,0],[1000000,200000],[2499999,500000],[2500000,500000],[9000000,500000],[100000000000,500000],[1000003,200001]])assert.equal(buyerDepositCents(fee),deposit);
 for(const fee of [-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER,'1000000'])assert.throws(()=>buyerDepositCents(fee));
});
test('only future valid windows reach buyer copy, with AM/PM and timezone',()=>{
 assert.deepEqual(sellerViewingSlots([slot,{...slot,startsAt:'2026-09-01'},{...slot,timezone:'invalid'},{...slot,endsAt:slot.startsAt},{...slot,endsAt:'2026-10-18T21:00:00Z'},{quote:'door code 1234'}],now),[slot]);
 const label=viewingSlotLabel(slot);assert.match(label,/Friday, October 16, 2026/);assert.match(label,/2:00 PM CDT to 4:00 PM CDT/);
});
test('buyer gets exact total price, additional closing costs, deposit dollars and optional viewing',()=>{
 const result=calculateAutomaticCallOffer({party:'buyer',buyer},{},now);
 assert.equal(result.priceCents,16227050);assert.equal(result.depositCents,200000);assert.equal(result.viewingOptional,true);assert.equal(result.closingCostsIncluded,false);
 assert.equal(result.spokenDeposit,'The non-refundable deposit is two thousand dollars, under the assignment agreement. It is credited toward your assignment fee, not added to the asking price.');
 assert(!/20%|twenty percent|5,000|five thousand/.test(result.spokenDeposit));
 assert.deepEqual(result.depositPaymentMethods,['check','wire','cash_app','zelle']);assert.match(result.viewingSlots[0],/2:00 PM/);
 assert.match(result.instruction,/without verified evidence/);assert.match(result.instruction,/Viewing is optional/);assert.match(result.instruction,/cleared deposit funds are verified/);
});
test('reserved property never solicits a second deposit and missing deposit is not guessed',()=>{
 const reserved=calculateAutomaticCallOffer({party:'buyer',buyer:{...buyer,reserved:true}},{},now);assert.equal(reserved.quoteAllowed,false);assert.equal(reserved.reason,'buyer_reserved');
 for(const value of [undefined,null,0,500001,-1,'200000']){const r=calculateAutomaticCallOffer({party:'buyer',buyer:{...buyer,depositCents:value}},{},now);assert.equal(r.depositCents,null);assert.equal(r.spokenDeposit,null);}
});
test('signed seller contract goes directly to viewing coordination, without offer writes',async()=>{
 const calls=[];const result=await automaticCallOffer('fixture',{action:'get_offer',conversationId:'conv_fixture'},{bind:async()=>{},verifyInput:async()=>false,db:async(path)=>{calls.push(path);return {party:'seller',sellerContractSigned:true,address:'45 Fixture Lane',viewingSlots:[slot]};},now:()=>now});
 assert.equal(result.status,'seller_viewing_coordination');assert.equal(result.quoteAllowed,false);assert.deepEqual(calls,['rpc/icash_call_offer_context']);assert.match(result.instruction,/already signed/);
});
test('package keeps seller messages private, explains credit and supports optional visits',()=>{
 const html=renderBuyerPackage({...buyer,viewingSlots:[{...slot,startsAt:new Date(Date.now()+86400000).toISOString(),endsAt:null}],principal:'Fixture Company',repairsCents:null,arvCents:null,businessPhone:null,fetchedAt:null});
 assert.match(html,/\$2,000\.00/);assert.match(html,/check, wire, Cash App or Zelle/);assert.match(html,/without viewing/);assert(!html.includes('20%'));
 const reserved=renderBuyerPackage({...buyer,reserved:true,principal:'Fixture',repairsCents:null,arvCents:null,businessPhone:null,fetchedAt:null});assert.match(reserved,/not accepting another reservation deposit/);
});
