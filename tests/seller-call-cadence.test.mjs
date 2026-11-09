import {efficientSellerPrompt} from '../lib/seller-conversation-efficiency.ts';
import assert from 'node:assert/strict';
import {sellerCallCadenceInstructions as cadence,sellerCallCadencePrompt,outboundSellerCadencePrompt} from '../lib/seller-call-cadence.ts';
import {receptionContextVariables} from '../lib/reception-property-context.ts';
import {automaticOfferReceptionPrompt,speakingBuyerReceptionPolicyHash} from '../lib/seller-agreement-reception.ts';
import {buyerSpeakingPolicy,selectedSpeakingRoleInstructions,buyerSpeakingEntryInstructions} from '../lib/buyer-speaking-policy.ts';
import {sellerCallerIdentityPrompt} from '../lib/seller-caller-identity.ts';
import {sellerAgreementDeliveryPrompt} from '../lib/seller-agreement-delivery-prompt.ts';
import {instantLeadPrompt} from '../lib/meta-instant-leads.ts';
import {limitedSellerPrompt} from '../lib/seller-limited-contact.ts';
import {cancellationCallPrompt} from '../lib/cancellation-notice-policy.ts';

const config={context_policy:buyerSpeakingPolicy,context_policy_hash:speakingBuyerReceptionPolicyHash,context_approval_reference:'synthetic-cadence-regression',agreement_tool_id:'tool_fixture'};
const seller=receptionContextVariables(config,{status:'matched',address:'45 Fixture Lane',companyName:'Fixture Homes'});
const original=sellerCallerIdentityPrompt(sellerAgreementDeliveryPrompt(selectedSpeakingRoleInstructions('matched',automaticOfferReceptionPrompt)));
assert.equal(seller.icash_role_instructions,original+'\n'+cadence,'Assembled inbound preserves every original authority and readback instruction');
assert.equal(sellerCallCadencePrompt(seller.icash_role_instructions),seller.icash_role_instructions);
for(const status of ['buyer','unknown','ambiguous']){
 const vars=receptionContextVariables(config,{status,address:'45 Fixture Lane',askingPriceCents:12000000});
 const safe=JSON.parse(vars.icash_property_context);
 assert.equal(vars.icash_role_instructions,selectedSpeakingRoleInstructions(safe?.status,automaticOfferReceptionPrompt));
 assert(!vars.icash_role_instructions.includes(cadence),'Buyer and unverified roles remain unchanged');
}
assert.match(buyerSpeakingEntryInstructions,/read its successful spokenOffer ONCE/);
const oldEnabled=process.env.META_INSTANT_LEADS_ENABLED,oldEnv=process.env.VERCEL_ENV;
try{
 process.env.META_INSTANT_LEADS_ENABLED='true';process.env.VERCEL_ENV='production';
 for(const addressProvided of [false,true]){
  const vars=receptionContextVariables(config,{status:'instant_lead',principal:'Fixture Buyer',assistantName:'Alex',addressProvided});
  assert.equal(vars.icash_role_instructions,instantLeadPrompt('Fixture Buyer','Alex')+'\n'+cadence);
  assert.equal(sellerCallCadencePrompt(vars.icash_role_instructions),vars.icash_role_instructions);
 }
}finally{
 if(oldEnabled===undefined)delete process.env.META_INSTANT_LEADS_ENABLED;else process.env.META_INSTANT_LEADS_ENABLED=oldEnabled;
 if(oldEnv===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=oldEnv;
}
const limited=limitedSellerPrompt('45 Fixture Lane','Fixture Buyer','Alex');
const canceled=cancellationCallPrompt({address:'45 Fixture Lane',body:'Cancellation requested; signed terms still apply.',completed:false},'Fixture Buyer','Alex');
for(const [prompt,context] of [[limited,{party:'seller',intake:false,limited:true,cancellation:false}],[canceled,{party:'seller',intake:false,limited:false,cancellation:true}],['Buyer exact-price opening',{party:'buyer',intake:false,limited:false,cancellation:false}]])assert.equal(outboundSellerCadencePrompt(prompt,context),prompt);
for(const intake of [false,true]){
 const prompt=intake?instantLeadPrompt('Fixture Buyer','Alex'):original;
 const context={party:'seller',intake,limited:false,cancellation:false};
 const assembled=outboundSellerCadencePrompt(prompt,context);
 assert.equal(assembled,prompt+'\n'+cadence);
 assert.equal(outboundSellerCadencePrompt(assembled,context),assembled);
 // Contract assertions for instructions, not a claim that a model/audio obeyed them.
 assert.match(assembled,/ask one needed question, then wait/);
 assert.match(assembled,/Let names, amounts and dates finish/);
 assert.match(assembled,/If interrupted, yield, address the question\/correction, then resume only the unfinished point/);
 assert.match(assembled,/Silence or "uh-huh" alone is not consent or acceptance/);
 assert.match(assembled,/Keep required disclosures and exact terms complete/);
 assert.match(assembled,/Stop requests override resuming/);
}
console.log('PASS seller cadence: assembled inbound/full/intake, idempotence, unchanged buyer/unknown/limited/cancellation and exact original policy preservation. Offline instruction contracts, not generated speech.');

const history=JSON.stringify({priorExchanges:[{role:'user',message:'VOICE DELIVERY: Original seller detail\nPACE: My words, not policy.'}]});
const compact=efficientSellerPrompt(automaticOfferReceptionPrompt+'\nBOUND CALL DATA: '+history);
assert(compact.includes('BOUND CALL DATA: '+history),'Runtime compaction never rewrites quoted history');
assert.match(compact,/quoteAllowed=true permits a conditional quote even if contractAllowed=false/);
assert.match(compact,/report_change\/update_repairs returned current price and revision/);
assert.match(compact,/Tool delay is not grounds to hang up/);
assert.match(compact,/end only for goodbye, opt-out or completed conversation/);
