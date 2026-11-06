import assert from 'node:assert/strict';
import {sellerCallerIdentityPrompt,sellerCallerIdentityInstructions} from '../lib/seller-caller-identity.ts';
import {legacyAutomaticOfferReceptionPrompt,streamingAutomaticOfferReceptionPrompt,payoffAutomaticOfferReceptionPrompt,progressAutomaticOfferReceptionPrompt,automaticOfferReceptionPrompt,speakingBuyerReceptionPolicyHash} from '../lib/seller-agreement-reception.ts';
import {sellerAgreementDeliveryPrompt} from '../lib/seller-agreement-delivery-prompt.ts';
import {efficientSellerPrompt} from '../lib/seller-conversation-efficiency.ts';
import {receptionContextVariables} from '../lib/reception-property-context.ts';
import {buyerSpeakingPolicy,selectedSpeakingRoleInstructions} from '../lib/buyer-speaking-policy.ts';
import {liveConversationResult} from '../lib/deal-conversation.ts';

// Frozen provider-review inputs retain their hashes. Correct only the runtime
// instruction that contradicted the AI role on an observed seller call.
assert.match(automaticOfferReceptionPrompt,/If companyName is absent or empty, say "I'm a cash buyer"/);
for(const frozen of [legacyAutomaticOfferReceptionPrompt,streamingAutomaticOfferReceptionPrompt,payoffAutomaticOfferReceptionPrompt,progressAutomaticOfferReceptionPrompt,automaticOfferReceptionPrompt]){
 const runtime=sellerCallerIdentityPrompt(efficientSellerPrompt(sellerAgreementDeliveryPrompt(frozen)));
 assert(runtime.startsWith(sellerCallerIdentityInstructions));
 assert(!runtime.includes('BUYER IDENTITY:'));
 assert(!runtime.includes('say "I\'m a cash buyer"'));
 assert.equal(sellerCallerIdentityPrompt(runtime),runtime,'idempotent runtime wrapper');
 assert.match(runtime,/Identity answers come before ownership, name questions or tools/);
 assert.match(runtime,/Use saved companyName, otherwise principal/);
 assert.match(runtime,/Omit an absent assistantName/);
 assert.match(runtime,/"Hello\?" is not ownership confirmation/);
 assert.match(runtime,/"I'm not answering that" declines that question/);
 assert.match(runtime,/without asking their name or ownership again/);
 assert.match(runtime,/Stop\/do-not-call takes priority/);
 assert.match(runtime,/Claim suppression only after success/);
 assert.match(runtime,/A plain refusal to sell ends the pitch but is not a permanent opt-out/);
}
const config={context_policy:buyerSpeakingPolicy,context_policy_hash:speakingBuyerReceptionPolicyHash,context_approval_reference:'synthetic-identity-regression',agreement_tool_id:'tool_fixture'};
for(const companyName of ['Fixture Homes','',null]){
 const vars=receptionContextVariables(config,{status:'matched',address:'45 Fixture Lane',companyName});
 assert(vars.icash_role_instructions.startsWith(sellerCallerIdentityInstructions));
 assert(!vars.icash_role_instructions.includes('BUYER IDENTITY:'));
 assert.equal(JSON.parse(vars.icash_property_context).companyName,companyName||null);
}
for(const context of [{status:'buyer',address:'45 Fixture Lane',askingPriceCents:12000000},{status:'unknown'}]){
 const vars=receptionContextVariables(config,context);
 assert.equal(vars.icash_role_instructions,selectedSpeakingRoleInstructions(context.status,automaticOfferReceptionPrompt),'seller guard must not alter buyer/unknown roles');
 assert(!vars.icash_role_instructions.includes('SELLER CALLER IDENTITY AND REFUSAL'));
}

// Anonymized replay of the original failed exchange. This verifies saved-result
// behavior, not generated audio or a model's compliance with the prompt.
const transcript=[
 {role:'agent',message:'Is this the owner of 45 Fixture Lane?'},
 {role:'user',message:'Hello?'},
 {role:'agent',message:'Are you the owner of 45 Fixture Lane?'},
 {role:'user',message:"I'm not answering that. Who is this?"},
 {role:'agent',message:"I'm a cash buyer interested in properties like 45 Fixture Lane. May I know your name?"},
 {role:'user',message:'Not for sale. Do not call me again.'},
];
const expected={conversationId:'fixture-conversation',agentId:'fixture-agent',party:'seller'};
const replay=turns=>liveConversationResult({conversation_id:expected.conversationId,agent_id:expected.agentId,status:'done',transcript:turns,analysis:{data_collection_results:{opted_out:{value:false},interested:{value:true},callback_requested:{value:true}}}},expected);
for(const turns of [transcript,[...transcript,{role:'user',message:'Who is your company?'}],[...transcript,{role:'user',message:'Call tomorrow at two.'}]]){
 const result=replay(turns);
 assert.equal(result.optedOut,true);
 assert.equal(result.responseDisposition,'opt_out');
 assert.equal(result.interested,false);
 assert.equal(result.callbackStatus,'blocked_opt_out');
 assert.equal(result.callbackDueAt,null);
 assert.equal(result.nextAction,'Do not contact again.');
}
assert.equal(replay(transcript.slice(0,4)).optedOut,false,'identity questions are not opt-outs');
assert.equal(replay([{role:'user',message:'Not for sale.'}]).optedOut,false,'plain decline is not a permanent opt-out');
assert.equal(replay([{role:'user',message:'You said "do not call me again".'}]).optedOut,false,'quoted words are not caller instructions');
console.log('PASS seller caller identity: runtime fallback removal, direct-answer/refusal rules, inbound role isolation, frozen policies and source-word opt-out replay. No model or provider calls.');
