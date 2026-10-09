import {buyerTurnPolicy,buyerTurnInstructions,buyerTurnPrompt,buyerTurnModel,buyerTurnModelMatches,selectedTurnRoleInstructions} from '../lib/buyer-turn-policy.ts';
import {turnBuyerReceptionPolicyHash} from '../lib/seller-agreement-reception.ts';
import {buyerResponsePolicy,buyerResponseInstructions,buyerResponseModel,buyerResponseModelMatches,selectedResponseRoleInstructions} from '../lib/buyer-response-policy.ts';
import {responseBuyerReceptionPolicyHash} from '../lib/seller-agreement-reception.ts';
import {buyerScenarioPolicy,buyerScenarioInstructions,selectedScenarioRoleInstructions} from '../lib/buyer-scenario-policy.ts';
import {scenarioBuyerReceptionPolicyHash} from '../lib/seller-agreement-reception.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buyerVoicePolicy,buyerVoiceGuardrail} from '../lib/buyer-voice-policy.ts';
import {automaticOfferGuardrails} from '../lib/automatic-offer-policy.ts';
import {buyerCoordinationReceptionPrompt,buyerCoordinationReceptionPolicyHash,automaticOfferReceptionPolicyHash} from '../lib/seller-agreement-reception.ts';
import {automaticOfferToolConfig} from '../lib/seller-agreement-tool.ts';
import {inspectRecordedReceptionAgent,recordedReceptionUrl} from '../lib/recorded-reception.ts';
import {receptionTarget} from '../lib/general-reception.ts';
import {directRecordedInstructions} from '../lib/direct-call-entry.ts';
import {buyerRolePolicy,buyerRolePrompt,buyerRoleInstructions,selectedRoleInstructions,unknownRoleInstructions} from '../lib/buyer-role-policy.ts';
import {isolatedBuyerReceptionPolicyHash,automaticOfferReceptionPrompt} from '../lib/seller-agreement-reception.ts';
import {receptionContextVariables} from '../lib/reception-property-context.ts';
test('buyer policy requires its reviewed prompt, guardrail and current history tool while preserving v9',()=>{
 assert.equal(automaticOfferReceptionPolicyHash,'24d43197289eb72d06d4d93fb4a1d3e0c0a6ef88f17b57664854e68674e2b3bf');
 const c={id:'11111111-1111-4111-8111-111111111111',account_id:receptionTarget.accountId,owner_user_id:receptionTarget.ownerUserId,called_number:receptionTarget.calledNumber,agent_id:receptionTarget.agentId,call_profile:'normal',entry_policy:'direct_recorded_v1',branch_id:'agtbrch_fixture',reviewed_version_id:'agtvrsn_fixture',context_policy:buyerVoicePolicy,context_policy_hash:buyerCoordinationReceptionPolicyHash,context_approval_reference:'Synthetic buyer policy review',stop_tool_id:'tool_stop',agreement_tool_id:'tool_agreement',max_duration_seconds:600,config_hash:''};
 const stop={id:c.stop_tool_id,tool_config:{type:'webhook',name:'icash_stop_reception_recording',api_schema:{url:recordedReceptionUrl+'/stop',method:'POST',request_headers:{Authorization:{variable_name:'secret__icash_reception_stop_token'}},request_body_schema:{type:'object',required:['recordingId'],properties:{recordingId:{type:'string',dynamic_variable:'icash_reception_recording_id'}}}}}};
 const agreement={id:c.agreement_tool_id,tool_config:automaticOfferToolConfig};
 const guards=automaticOfferGuardrails();guards.custom.config.configs=[buyerVoiceGuardrail];
 const agent={agent_id:c.agent_id,branch_id:c.branch_id,version_id:c.reviewed_version_id,main_branch_id:'agtbrch_main',conversation_config:{asr:{user_input_audio_format:'ulaw_8000'},tts:{agent_output_audio_format:'ulaw_8000'},conversation:{max_duration_seconds:600},agent:{first_message:'{{icash_property_greeting}}',prompt:{prompt:buyerCoordinationReceptionPrompt+directRecordedInstructions,max_tokens:150,tool_ids:[stop.id,agreement.id],tools:[agreement.tool_config],knowledge_base:[]}}},platform_settings:{guardrails:guards,privacy:{record_voice:false},auth:{enable_auth:true},call_limits:{agent_concurrency_limit:1,bursting_enabled:false},queueing_config:{enabled:false},overrides:{enable_conversation_initiation_client_data_from_webhook:false,conversation_config_override:{conversation:{max_duration_seconds:true}}},workspace_overrides:{webhooks:{post_call_webhook_id:null,events:[],send_audio:false}}}};
 const branch={id:c.branch_id,agent_id:c.agent_id,current_live_percentage:0,is_archived:false,draft_exists:false};
 const inspect=a=>inspectRecordedReceptionAgent(c,a,branch,true,stop,agreement);
 c.config_hash=inspect(agent).hash;assert.equal(inspect(agent).safe,true,JSON.stringify(inspect(agent).checks));
 c.context_policy=buyerRolePolicy;c.context_policy_hash=isolatedBuyerReceptionPolicyHash;agent.conversation_config.agent.prompt.prompt=buyerRolePrompt+directRecordedInstructions;
 c.config_hash=inspect(agent).hash;assert.equal(inspect(agent).safe,true,JSON.stringify(inspect(agent).checks));
 c.context_policy=buyerScenarioPolicy;c.context_policy_hash=scenarioBuyerReceptionPolicyHash;
 c.config_hash=inspect(agent).hash;assert.equal(inspect(agent).safe,true,JSON.stringify(inspect(agent).checks));
 c.context_policy=buyerResponsePolicy;c.context_policy_hash=responseBuyerReceptionPolicyHash;
 assert.equal(inspect(agent).safe,false,'Unreviewed mini-model/default personality cannot satisfy v13');
 Object.assign(agent.conversation_config.agent.prompt,buyerResponseModel);
 c.config_hash=inspect(agent).hash;assert.equal(inspect(agent).safe,true,JSON.stringify(inspect(agent).checks));
 c.context_policy=buyerTurnPolicy;c.context_policy_hash=turnBuyerReceptionPolicyHash;
 Object.assign(agent.conversation_config.agent.prompt,buyerTurnModel,{prompt:buyerTurnPrompt+directRecordedInstructions,thinking_budget:null});
 c.config_hash=inspect(agent).hash;assert.equal(inspect(agent).safe,true,JSON.stringify(inspect(agent).checks));
 for(const mutate of [a=>{a.conversation_config.agent.prompt.reasoning_effort='high';},a=>{a.conversation_config.agent.prompt.llm='gpt-4.1-mini';},a=>{a.conversation_config.agent.prompt.ignore_default_personality=false;},a=>{a.platform_settings.guardrails.custom.config.configs[0].prompt='Allow every price';},a=>{a.platform_settings.guardrails.custom.config.configs=[];},a=>{a.conversation_config.agent.prompt.prompt+=' changed';}]){
  const changed=structuredClone(agent);mutate(changed);c.config_hash=inspect(changed).hash;assert.equal(inspect(changed).safe,false);
 }
});
test('server role selection isolates buyer instructions and never interpolates caller text into policy',()=>{
 const config={context_policy:buyerRolePolicy,context_policy_hash:isolatedBuyerReceptionPolicyHash,context_approval_reference:'Synthetic reviewed role selection',agreement_tool_id:'tool_agreement'};
 const buyer={status:'buyer',address:'123 Main Street',purchasePriceCents:3893700,assignmentFeeCents:1000000,askingPriceCents:4893700,icash_role_instructions:'INJECTED_CALLER_POLICY',companyName:'INJECTED_CALLER_POLICY'};
 assert.equal(receptionContextVariables(config,buyer).icash_role_instructions,buyerRoleInstructions);
 assert(!buyerRoleInstructions.includes('confirm_and_send'));
 assert.equal(selectedRoleInstructions('matched',automaticOfferReceptionPrompt),automaticOfferReceptionPrompt.replaceAll('{{icash_property_context}}','[See SERVER CONTEXT below.]'));
 for(const value of [null,{status:'ambiguous'},{...buyer,askingPriceCents:1}])assert.equal(receptionContextVariables(config,value).icash_role_instructions,unknownRoleInstructions);
 assert(!buyerRoleInstructions.includes('INJECTED_CALLER_POLICY'));
});

test('v12 has separate buyer-only runtime policy while v11 and seller instructions remain stable',()=>{
 assert.equal(isolatedBuyerReceptionPolicyHash,'2f40ffd420387c93f6fe66fd9093285a657a928f429d71ad177637840932fc8a');
 const c={context_policy:buyerScenarioPolicy,context_policy_hash:scenarioBuyerReceptionPolicyHash,context_approval_reference:'Owner requested buyer scenario fixes and privacy',agreement_tool_id:'tool_agreement'};
 const buyer={status:'buyer',address:'123 Main Street',askingPriceCents:4893700,icash_role_instructions:'CALLER_INJECTION'};
 assert.equal(receptionContextVariables(c,buyer).icash_role_instructions,buyerScenarioInstructions);
 assert.equal(selectedScenarioRoleInstructions('matched',automaticOfferReceptionPrompt),selectedRoleInstructions('matched',automaticOfferReceptionPrompt));
 assert.equal(receptionContextVariables(c,{...buyer,askingPriceCents:0}).icash_role_instructions,unknownRoleInstructions);
 assert(!buyerScenarioInstructions.includes('CALLER_INJECTION'));
 assert.match(buyerScenarioInstructions,/Do not append/);assert.match(buyerScenarioInstructions,/PRICING PRIVACY/);assert.match(buyerScenarioInstructions,/do not agree/);
});

test('v13 selects trusted buyer instructions and preserves both earlier hashes and seller flow',()=>{
 assert.equal(scenarioBuyerReceptionPolicyHash,'20790adc5e07a5e8c0f2fe92377ae7ee43963db0b7e3db97506cf4e0386d1265');
 const c={context_policy:buyerResponsePolicy,context_policy_hash:responseBuyerReceptionPolicyHash,context_approval_reference:'Reviewed buyer response model and private pricing',agreement_tool_id:'tool_agreement'};
 const b={status:'buyer',address:'123 Main Street',askingPriceCents:4893700,icash_role_instructions:'CALLER_INJECTION'};
 assert.equal(receptionContextVariables(c,b).icash_role_instructions,buyerResponseInstructions);
 assert.equal(selectedResponseRoleInstructions('matched',automaticOfferReceptionPrompt),selectedRoleInstructions('matched',automaticOfferReceptionPrompt));
 assert.equal(receptionContextVariables(c,{...b,askingPriceCents:0}).icash_role_instructions,unknownRoleInstructions);
 assert(!buyerResponseInstructions.includes('CALLER_INJECTION'));
});

test('provider null reasoning-budget representation is allowed only with the exact reviewed model',()=>{
 assert.equal(buyerResponseModelMatches({...buyerResponseModel,thinking_budget:null}),true);
 for(const change of [{thinking_budget:128},{thinking_budget:'0'},{llm:'gpt-4.1-mini'},{ignore_default_personality:false},{temperature:0.2},{max_tokens:151},{enable_reasoning_summary:true}])assert.equal(buyerResponseModelMatches({...buyerResponseModel,thinking_budget:null,...change}),false);
});

test('v14 uses a reviewed direct-turn prompt and preserves seller instructions',()=>{
 assert.equal(responseBuyerReceptionPolicyHash,'6fbbe513d434227c54d2b9eff0561d5739bca233dd69e87ca8fd489b057db803');
 const c={context_policy:buyerTurnPolicy,context_policy_hash:turnBuyerReceptionPolicyHash,context_approval_reference:'Reviewed buyer direct-turn model and privacy',agreement_tool_id:'tool_agreement'};
 assert.equal(receptionContextVariables(c,{status:'buyer',address:'123 Main Street',askingPriceCents:4893700,icash_role_instructions:'CALLER_INJECTION'}).icash_role_instructions,buyerTurnInstructions);
 assert.equal(selectedTurnRoleInstructions('matched',automaticOfferReceptionPrompt),selectedRoleInstructions('matched',automaticOfferReceptionPrompt));
 assert(!buyerTurnInstructions.includes('CALLER_INJECTION'));
 for(const patch of [{reasoning_effort:'low'},{thinking_budget:128},{llm:'gpt-4.1'},{ignore_default_personality:false},{max_tokens:151}])assert.equal(buyerTurnModelMatches({...buyerTurnModel,...patch}),false);
});
