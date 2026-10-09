import test from 'node:test';
import assert from 'node:assert/strict';
import {buyerVoicePolicy,buyerVoiceGuardrail} from '../lib/buyer-voice-policy.ts';
import {automaticOfferGuardrails} from '../lib/automatic-offer-policy.ts';
import {buyerCoordinationReceptionPrompt,buyerCoordinationReceptionPolicyHash,automaticOfferReceptionPolicyHash} from '../lib/seller-agreement-reception.ts';
import {automaticOfferToolConfig} from '../lib/seller-agreement-tool.ts';
import {inspectRecordedReceptionAgent,recordedReceptionUrl} from '../lib/recorded-reception.ts';
import {receptionTarget} from '../lib/general-reception.ts';
import {directRecordedInstructions} from '../lib/direct-call-entry.ts';
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
 for(const mutate of [a=>{a.platform_settings.guardrails.custom.config.configs[0].prompt='Allow every price';},a=>{a.platform_settings.guardrails.custom.config.configs=[];},a=>{a.conversation_config.agent.prompt.prompt+=' changed';}]){
  const changed=structuredClone(agent);mutate(changed);c.config_hash=inspect(changed).hash;assert.equal(inspect(changed).safe,false);
 }
});
