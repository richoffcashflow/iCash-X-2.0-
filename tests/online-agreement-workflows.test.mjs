import assert from 'node:assert/strict';
import {onlineAgreementInstructions,onlineAgreementVoiceInstructions} from '../lib/online-agreement-policy.ts';
import {sellerAgreementDeliveryPrompt} from '../lib/seller-agreement-delivery-prompt.ts';
import {receptionContextVariables} from '../lib/reception-property-context.ts';
import {buyerSpeakingPolicy,buyerSpeakingPolicyHash} from '../lib/buyer-speaking-policy.ts';
import {analyzeText} from '../lib/text-ai-policy.ts';
const prompt=sellerAgreementDeliveryPrompt('Fixture seller instructions');
assert(prompt.includes(onlineAgreementVoiceInstructions));assert(prompt.includes('Fixture seller instructions'));
const inbound=receptionContextVariables({context_policy:buyerSpeakingPolicy,context_policy_hash:buyerSpeakingPolicyHash,context_approval_reference:'fixture-approved-policy'},{status:'matched',address:'100 Fixture St',principal:'Fixture buyer',assistantName:'Fixture',today:'2026-10-29',timeZone:'America/Chicago'});
assert(inbound.icash_role_instructions?.includes(onlineAgreementVoiceInstructions),'Matched inbound seller receives the same digital delivery policy');
for(const [party,conversationEnabled] of [['seller',false],['seller',true],['buyer',false]]){
 const response=await analyzeText({model:'fixture',context:{},party,conversationEnabled,messages:[{direction:'incoming',body:'Can you mail the contract?'}]},'fixture',async(url,options)=>{
  const body=JSON.parse(options.body);assert(body.messages[0].content.includes(onlineAgreementInstructions));
  return Response.json({id:'fixture',choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'review',reply:'',summary:'Can you mail the contract?',facts:[]})}}]});
 });
 assert.equal(response.analysis.action,'review','Delivery guidance must not invent permission to send a contract');
}
console.log('Online agreement policy reaches outbound seller, matched inbound seller and seller/buyer text analysis without changing tool authority. No live provider work.');
