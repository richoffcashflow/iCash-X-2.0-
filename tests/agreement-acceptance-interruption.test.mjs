import assert from 'node:assert/strict';
import {callOfferEvidence,spokenMoneyAmounts} from '../lib/call-offer-evidence.ts';
import {receptionContextVariables} from '../lib/reception-property-context.ts';
import {speakingBuyerReceptionPolicyHash} from '../lib/seller-agreement-reception.ts';
import {buyerSpeakingPolicy} from '../lib/buyer-speaking-policy.ts';
const agent={role:'agent',message:'We can offer seventy-four thousand dollars cash, as is. Does that fit?'};
const accepted=text=>callOfferEvidence({transcript:[agent,{role:'user',message:text}]},{action:'accept_offer',priceCents:7400000});
for(const answer of [
 "Um, yeah, that fit, that fits with what I, uh, what I had in mind. Um, I want the closing date to be in 30 days from now. Uh, what's the next step?",
 'Uh, yes. I want to close in 30 days.',
 'Well, yeah, 74k works. Can we close November 10, 2026?',
 'Yes, 74k works. I want November 10th, 2026.',
 'Yes. I want to close 2026-11-10.',
 'Yes, in 2 weeks.',
])assert(accepted(answer),answer);
for(const answer of [
 'Um, no.', 'Um, yeah, but I need $80,000.', 'Yes, I want 80k.',
 'Yes, only if you close in 30 days.', 'Yes, $30.', 'Yes, $30 days from now.',
 'Yes, not at that price.', 'Maybe. Let me think.',
])assert(!accepted(answer),answer);
assert.deepEqual(spokenMoneyAmounts('Repairs are $30,000'),[3000000]);
const config={context_policy:buyerSpeakingPolicy,context_policy_hash:speakingBuyerReceptionPolicyHash};
const seller=receptionContextVariables(config,{status:'matched',address:'45 Fixture Lane',purchaseTerms:{inspectionDays:10}});
assert.match(seller.icash_role_instructions,/Tool execution was abandoned due to user input/);
assert.match(seller.icash_role_instructions,/retry that exact action once/);
assert(!seller.icash_role_instructions.includes('DELIVERY FAILURE RESPONSE:'));
const buyer=receptionContextVariables(config,{status:'buyer',address:'45 Fixture Lane'});
assert(!buyer.icash_role_instructions.includes('AGREEMENT DELIVERY AND INTERRUPTIONS:'));
console.log('PASS conversational acceptance and timing, counteroffer/conditional refusal guards, and seller-only inbound recovery instructions.');
