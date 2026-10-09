import test from 'node:test';
import assert from 'node:assert/strict';
import {automaticCallOffer,calculateAutomaticCallOffer} from '../lib/automatic-call-offer.ts';
const input={action:'get_offer',conversationId:'conv_fixture'},token='a'.repeat(64);
const buyer={address:'45 Fixture Lane',askingPriceCents:16227050,purchasePriceCents:15227050,assignmentFeeCents:1000000,depositCents:200000,closingDate:'2026-11-07',titleSelectionStatus:'not_selected'};
test('current call authority needs only one database round trip for buyer price',async()=>{
 const calls=[];const result=await automaticCallOffer(token,input,{db:async(path)=>{calls.push(path);return {party:'buyer',buyer};},bind:async()=>assert.fail('Bound call must not repeat provider/binding lookup'),verifyInput:async()=>assert.fail()});
 assert.equal(result.priceCents,16227050);assert.deepEqual(calls,['rpc/icash_call_offer_context']);
});
test('unbound, expired or denied calls cannot skip canonical identity or authorize a price',async()=>{
 for(const bound of [false,true]){
  const calls=[];let verified=false;
  const result=await automaticCallOffer(token,input,{db:async()=>{calls.push('context');return verified&&bound?{party:'buyer',buyer}:null;},bind:async()=>{calls.push('bind');verified=true;},verifyInput:async()=>false});
  assert.deepEqual(calls,['context','bind','context']);assert.equal(result.quoteAllowed,bound);
 }
 await assert.rejects(automaticCallOffer(token,input,{db:async()=>null,bind:async()=>{throw Error('unconfirmed_call');},verifyInput:async()=>false}),/unconfirmed_call/);
});
test('buyer speech stays concise with complete terms and a conditional title preference',()=>{
 const result=calculateAutomaticCallOffer({party:'buyer',buyer},{},Date.parse('2026-10-09T19:00:00Z'));
 assert(result.spokenOffer.split(/\s+/).length<80);assert.match(result.spokenOffer,/fifty cents/);assert.match(result.spokenOffer,/closing costs separately/);assert.match(result.spokenOffer,/November 7, 2026/);assert.match(result.spokenOffer,/non-refundable deposit is two thousand dollars/);
 assert.equal(result.titleSelectionStatus,'not_selected');assert.match(result.instruction,/closed an assignment deal with a wholesaler/);assert.match(result.instruction,/one question per turn/);assert.match(result.instruction,/not a selected or verified closer/);assert.match(result.instruction,/one or two short sentences/);
 const selected=calculateAutomaticCallOffer({party:'buyer',buyer:{...buyer,titleSelectionStatus:'selected'}},{},0);assert(!selected.instruction.includes('No title company has been selected'));assert.match(selected.instruction,/Do not say title is undecided/);
 const unknown=calculateAutomaticCallOffer({party:'buyer',buyer:{...buyer,titleSelectionStatus:undefined}},{},0);assert(!unknown.instruction.includes('No title company has been selected'));
});
