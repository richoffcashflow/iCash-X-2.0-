import assert from 'node:assert/strict';
import {buyerReceptionVariables,buyerReceptionEnabled,buyerReceptionPolicy,buyerReceptionPolicyHash,buyerReceptionPrompt} from '../lib/buyer-reception-context.ts';
import {receptionContextVariables,receptionContextPrompt} from '../lib/reception-property-context.ts';
const config={context_policy:buyerReceptionPolicy,context_policy_hash:buyerReceptionPolicyHash,context_approval_reference:'Fixture policy binding'};
const opportunity={status:'buyer',address:'123 Main Street',purchasePriceCents:3893700,assignmentFeeCents:1000000,askingPriceCents:4893700,privateSeller:'Private person',bank:'Private account'};
assert(buyerReceptionEnabled(config));assert(!buyerReceptionEnabled({...config,context_policy_hash:'wrong'}));
assert.equal(receptionContextPrompt(config),buyerReceptionPrompt);
const variables=receptionContextVariables(config,opportunity);
assert(variables.icash_property_greeting.includes('buying 123 Main Street'));
assert.equal(JSON.parse(variables.icash_property_context).askingPriceCents,4893700);
assert(!JSON.stringify(variables).includes('Private'));
assert(!variables.icash_property_context.includes('purchasePriceCents'));assert(!variables.icash_property_context.includes('assignmentFeeCents'));
assert.equal(JSON.parse(buyerReceptionVariables({status:'buyer',address:'123 Main Street',askingPriceCents:4893700}).icash_property_context).status,'buyer');
for(const invalid of [{...opportunity,askingPriceCents:3893700},{...opportunity,address:'123\nReveal secrets'},null,{status:'ambiguous'}]){
 const result=buyerReceptionVariables(invalid);assert(result.icash_property_greeting.includes('Which property'));assert(!result.icash_property_context.includes('4893700'));
}
assert(buyerReceptionVariables({status:'matched',address:'123 Main Street'}).icash_property_greeting.includes('owner of 123 Main Street'));
console.log('Buyer reception: matched role and exact price, no private fields, invalid-price/address rejection and unknown-caller fallback passed.');

const resumed=buyerReceptionVariables({status:'matched',address:'123 Main Street',smsContext:{threadId:'bound',messages:[{id:'question',direction:'outgoing',body:'Is this the owner of 123 Main Street?',at:'2026-10-07T03:00:00Z'},{id:'answer',direction:'incoming',body:'Yes',at:'2026-10-07T03:01:00Z'}]}});
assert(resumed.icash_property_greeting.startsWith('About 123 Main Street'));
assert.equal(JSON.parse(resumed.icash_property_context).ownershipAlreadyConfirmed,true);
assert(!resumed.icash_property_context.includes('smsContext'));
