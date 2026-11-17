import assert from 'node:assert/strict';
import {callOfferEvidence,spokenMoneyAmounts} from '../lib/call-offer-evidence.ts';
import {receptionContextVariables} from '../lib/reception-property-context.ts';
import {speakingBuyerReceptionPolicyHash} from '../lib/seller-agreement-reception.ts';
import {buyerSpeakingPolicy} from '../lib/buyer-speaking-policy.ts';
import {sellerUnqualifiedAgreementAnswer} from '../lib/seller-answer-evidence.ts';
import {sellerAgreementEvidence,sellerAgreementConfirmationHold} from '../lib/seller-agreement-evidence.ts';
import {automaticCallOffer} from '../lib/automatic-call-offer.ts';
import {dealTermsSchema} from '../lib/deal-documents.ts';
const agent={role:'agent',message:'We can offer seventy-four thousand dollars cash, as is. Does that fit?'};
const accepted=text=>callOfferEvidence({transcript:[agent,{role:'user',message:text}]},{action:'accept_offer',priceCents:7400000});
const priceOnlyAnswers=[
 "Um, yeah, that fit, that fits with what I, uh, what I had in mind. Um, I want the closing date to be in 30 days from now. Uh, what's the next step?",
 'Uh, yes. I want to close in 30 days.',
 'Well, yeah, 74k works. Can we close November 10, 2026?',
 'Yes, 74k works. I want November 10th, 2026.',
 'Yes. I want to close 2026-11-10.',
 'Yes, in 2 weeks.',
 'Yes. I want to close in thirty days. What happens next?',
 'Yes. Can we close November eleventh, twenty twenty-six?',
 'Yes. I want to close on 11/11/2026.',
 'Yes. I want to close in 30 days. Please text the agreement.',
];
for(const answer of priceOnlyAnswers)assert(accepted(answer),answer);
const rejectedAnswers=[
 'Um, no.', 'Um, yeah, but I need $80,000.', 'Yes, I want 80k.',
 'Yes, only if you close in 30 days.', 'Yes, $30.', 'Yes, $30 days from now.',
 'Yes, not at that price.', 'Maybe. Let me think.',
 'Yes. I want to close in 30 days only if my wife agrees.',
 'Yes. Can we close in 30 days? I have another mortgage.',
 'Yes. What’s the next step if you pay $80k?',
 'Yes. I want November 10, 2026, not for $74k.',
 'Yes. I want to speak to somebody before closing in 30 days.',
 'My agent said yes. I want to close in 30 days.',
 'Yes. I want $30 days from now.',
 'Yes. I want to close in thirty days, unless the lien is higher.',
 'Yes. I want to close in 30 days. Stop texting me.',
 'Yes. I want to close in 30 days. The house has fire damage.',
 'Yes. I want to close in 30 days. Can I speak to a real person?',
 'Yes. I want to close in 30 days, but I need $80k.',
 'Yes. I want to close November 10, 2026 or November 20, 2026.',
 'Yes?',
];
for(const answer of rejectedAnswers){
 assert(!accepted(answer),answer);
 assert(!accepted('Um, '+answer.replaceAll("'",'’')),'fillers and apostrophes preserve the complete answer: '+answer);
}
const laterObjections=[
 'Yes. Can we close in 30 days if you pay $80k?',
 'You can close in 30 days only after my attorney approves.',
 'I don’t agree anymore.',
 'I no longer accept.',
 'I’d like to speak to a real person.',
 'There is a tax lien.',
 'My sister owns half the house.',
];
const priorAcceptance=[agent,{role:'user',message:'Yes.'},{role:'agent',message:'What closing date works?'}];
for(const answer of laterObjections){
 assert.equal(callOfferEvidence({transcript:[...priorAcceptance,{role:'user',message:answer}]},{action:'accept_offer',priceCents:7400000}),false,'later contrary evidence invalidates the old price answer: '+answer);
}
for(const answer of ['I’d like to speak to a real person.','There is a tax lien.','My sister owns half the house.']){
 assert.equal(callOfferEvidence({transcript:[...priorAcceptance,{role:'user',message:answer},agent,{role:'user',message:'Yes.'}]},{action:'accept_offer',priceCents:7400000}),false,'a generic fresh yes cannot resolve new property or human review: '+answer);
}
for(const answer of ['November 11, 2026.','I do not have a tax lien.','My sister does not own the house.']){
 assert.equal(callOfferEvidence({transcript:[...priorAcceptance,{role:'user',message:answer}]},{action:'accept_offer',priceCents:7400000}),true,'an ordinary timing answer or negated material fact is not a change: '+answer);
}
const terms=dealTermsSchema.parse({seller:'Fixture Seller',priceCents:7400000,closingDate:'2026-11-11',inspectionDays:10});
for(const answer of priceOnlyAnswers){
 assert.equal(sellerUnqualifiedAgreementAnswer(answer),false,'price-only timing never confirms final terms: '+answer);
 assert.equal(sellerAgreementEvidence({transcript:[{role:'agent',message:sellerAgreementConfirmationHold(terms).nextQuestion},{role:'user',message:answer}]},terms,Date.parse('2026-10-13T20:00:00Z')),false,'fresh final confirmation remains necessary: '+answer);
}
assert.deepEqual(spokenMoneyAmounts('Repairs are $30,000'),[3000000]);
// Exercise the actual offer-saving path with its original saved revision and
// snapshot lock. Only the provider transcript is evidence; I/O is local.
const now=Date.parse('2026-10-13T20:00:00Z'),address='45 Fixture Lane',token='a'.repeat(64),conversationId='conv_fixture';
const snapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:address,estimated_value:200000,estimated_repair_cost:56000,total_estimated_loan_balance:20000,estimated_equity_percentage:90}}};
const base={party:'seller',accountId:'account',dealId:'deal',address,snapshot,offerState:null,offerVersion:0};
for(const answer of [...priceOnlyAnswers,...rejectedAnswers,...laterObjections]){
 let current=structuredClone(base),saves=0;
 const transcript={transcript:[...(laterObjections.includes(answer)?priorAcceptance:[agent]),{role:'user',message:answer}]};
 const dependencies={now:()=>now,bind:async()=>{},verifyQualification:async()=>({ready:true}),verifyInput:async input=>callOfferEvidence(transcript,input),db:async(path,method,body)=>{
  if(path==='rpc/icash_call_offer_context')return structuredClone(current);
  assert.equal(path,'rpc/icash_save_call_offer');assert.equal(method,'POST');assert.equal(body.p_expected_version,current.offerVersion);assert.deepEqual(body.p_expected_snapshot,current.snapshot);
  current.offerState=structuredClone(body.p_state);current.offerVersion++;saves++;return true;
 }};
 const quote=await automaticCallOffer(token,{action:'get_offer',conversationId},dependencies);
 assert.equal(quote.priceCents,7400000);
 const result=await automaticCallOffer(token,{action:'accept_offer',conversationId,priceCents:quote.priceCents,quoteRevision:quote.quoteRevision},dependencies);
 if(priceOnlyAnswers.includes(answer)){
  assert.equal(result.status,'verbally_accepted',answer);assert.equal(current.offerState.acceptedPriceCents,7400000);assert.equal(saves,2);
 }else{
  assert.equal(result.reason,'acceptance_confirmation_required',answer);assert.equal(current.offerState.acceptedPriceCents,undefined);assert.equal(saves,1,'unsupported whole answer cannot save acceptance');
 }
}
const config={context_policy:buyerSpeakingPolicy,context_policy_hash:speakingBuyerReceptionPolicyHash};
const seller=receptionContextVariables(config,{status:'matched',address:'45 Fixture Lane',purchaseTerms:{inspectionDays:10}});
assert.match(seller.icash_role_instructions,/Tool execution was abandoned due to user input/);
assert.match(seller.icash_role_instructions,/retry that exact action once/);
assert(!seller.icash_role_instructions.includes('DELIVERY FAILURE RESPONSE:'));
const buyer=receptionContextVariables(config,{status:'buyer',address:'45 Fixture Lane'});
assert(!buyer.icash_role_instructions.includes('AGREEMENT DELIVERY AND INTERRUPTIONS:'));
console.log('PASS conversational acceptance and timing, counteroffer/conditional refusal guards, and seller-only inbound recovery instructions.');
