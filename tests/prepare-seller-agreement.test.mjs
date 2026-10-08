import {legacyAutomaticOfferGuardrail,automaticOfferGuardrails} from '../lib/automatic-offer-policy.ts';
import assert from 'node:assert/strict';
import {prepareSellerAgreement} from '../scripts/prepare-seller-agreement.mjs';
import {sellerOfferReceptionPolicyHash,sellerOfferReceptionPrompt} from '../lib/seller-offer-reception.ts';
import {sellerAgreementReceptionPolicy,sellerAgreementReceptionPolicyHash,sellerAgreementReceptionPrompt,noEmdReceptionPolicy,noEmdReceptionPolicyHash,noEmdReceptionPrompt,automaticOfferReceptionPolicy,automaticOfferReceptionPolicyHash,automaticOfferReceptionPrompt,legacyAutomaticOfferReceptionPolicy,legacyAutomaticOfferReceptionPolicyHash,legacyAutomaticOfferReceptionPrompt} from '../lib/seller-agreement-reception.ts';
import {sellerAgreementToolConfig,noEmdAgreementToolConfig,automaticOfferToolConfig} from '../lib/seller-agreement-tool.ts';
import {inspectRecordedReceptionAgent,recordedReceptionUrl} from '../lib/recorded-reception.ts';
import {receptionTarget} from '../lib/general-reception.ts';
import {directRecordedInstructions} from '../lib/direct-call-entry.ts';
import {canonical,sha,recordingPolicy,recordingAgentMatches} from '../lib/required-call-recording.ts';

async function testStaging(noEmd,automatic=false){
const oldAgreementTool={id:'tool_previous',tool_config:automatic?automaticOfferToolConfig:sellerAgreementToolConfig};
const c={id:'11111111-1111-4111-8111-111111111111',account_id:receptionTarget.accountId,owner_user_id:receptionTarget.ownerUserId,called_number:receptionTarget.calledNumber,agent_id:receptionTarget.agentId,call_profile:'normal',entry_policy:'direct_recorded_v1',branch_id:'agtbrch_oldin',reviewed_version_id:'agtvrsn_oldin',context_policy:'seller_offer_v2',context_policy_hash:sellerOfferReceptionPolicyHash,context_approval_reference:'Synthetic reviewed property script',stop_tool_id:'tool_stop',max_duration_seconds:600,config_hash:''};
const stop={id:c.stop_tool_id,tool_config:{type:'webhook',name:'icash_stop_reception_recording',api_schema:{url:recordedReceptionUrl+'/stop',method:'POST',request_headers:{Authorization:{variable_name:'secret__icash_reception_stop_token'}},request_body_schema:{type:'object',required:['recordingId'],properties:{recordingId:{type:'string',dynamic_variable:'icash_reception_recording_id'}}}}}};
const incoming={agent_id:c.agent_id,branch_id:c.branch_id,version_id:c.reviewed_version_id,main_branch_id:'agtbrch_mainin',conversation_config:{asr:{user_input_audio_format:'ulaw_8000'},tts:{agent_output_audio_format:'ulaw_8000'},conversation:{max_duration_seconds:600},agent:{first_message:'{{icash_property_greeting}}',prompt:{prompt:sellerOfferReceptionPrompt+directRecordedInstructions,max_tokens:120,tool_ids:[stop.id],tools:[],knowledge_base:[]}}},platform_settings:{privacy:{record_voice:false},auth:{enable_auth:true},call_limits:{agent_concurrency_limit:1,bursting_enabled:false},queueing_config:{enabled:false},overrides:{enable_conversation_initiation_client_data_from_webhook:false,conversation_config_override:{conversation:{max_duration_seconds:true}}},workspace_overrides:{webhooks:{post_call_webhook_id:null,events:[],send_audio:false}}}};
const branch=a=>({id:a.branch_id,agent_id:a.agent_id,current_live_percentage:0,is_archived:false,draft_exists:false});
if(noEmd||automatic){Object.assign(c,{context_policy:automatic?legacyAutomaticOfferReceptionPolicy:sellerAgreementReceptionPolicy,context_policy_hash:automatic?legacyAutomaticOfferReceptionPolicyHash:sellerAgreementReceptionPolicyHash,agreement_tool_id:oldAgreementTool.id});Object.assign(incoming.conversation_config.agent.prompt,{prompt:(automatic?legacyAutomaticOfferReceptionPrompt:sellerAgreementReceptionPrompt)+directRecordedInstructions,tool_ids:[stop.id,oldAgreementTool.id],tools:[oldAgreementTool.tool_config]});}
if(automatic){incoming.platform_settings.guardrails=automaticOfferGuardrails();incoming.platform_settings.guardrails.custom.config.configs=[legacyAutomaticOfferGuardrail];}
c.config_hash=inspectRecordedReceptionAgent(c,incoming,branch(incoming),true,stop,noEmd||automatic?oldAgreementTool:undefined).hash;
const outgoing=structuredClone(incoming);Object.assign(outgoing,{agent_id:'agent_outbound',branch_id:'agtbrch_oldout',version_id:'agtvrsn_oldout',main_branch_id:'agtbrch_mainout'});
outgoing.conversation_config.agent.prompt.tool_ids=['tool_outstop','tool_callback','tool_handoff','tool_oldcontract'];
Object.assign(outgoing.platform_settings.overrides.conversation_config_override,{agent:{first_message:true,prompt:{prompt:true}},tts:{voice_id:true}});
const now=Date.now(),review={...(automatic?{offerPolicy:'automatic_offer_v5'}:{}),enabled:true,reviewedAt:new Date(now-60000).toISOString(),reviewedUntil:new Date(now+86400000).toISOString(),agentId:outgoing.agent_id,branchId:outgoing.branch_id,versionId:outgoing.version_id,configHash:sha(JSON.stringify(canonical({conversation_config:outgoing.conversation_config,platform_settings:outgoing.platform_settings,workflow:null,procedures:null}))),fromPhone:'+12125550100',providerAccountSid:'AC'+'a'.repeat(32),stopToolId:'tool_outstop',contractToolId:'tool_oldcontract',toolIds:outgoing.conversation_config.agent.prompt.tool_ids,approvedHoldCents:977,retentionDays:30,maxTotalSeconds:600,policyVersion:recordingPolicy.version};
assert(recordingAgentMatches(review,outgoing));
const env={VERCEL_ENV:'production',ICASH_DIRECT_CALLS_PREPARE:'true',SUPABASE_URL:'https://db.invalid',SUPABASE_SECRET_KEY:'synthetic-private',ELEVENLABS_API_KEY:'synthetic-key',RECORDED_OUTBOUND_REVIEW_JSON:JSON.stringify(review)};
for(const scenario of (automatic?['ok','changed_tool','source_changed']:['ok','claim_denied','changed_tool','source_changed'])){
 const created=new Map(),writes=[];let tool;
 const fetcher=async(url,init)=>{
  const u=new URL(url),body=init.body?JSON.parse(init.body):undefined;let value;
  if(init.method==='POST')writes.push({path:u.pathname,body});
  if(u.pathname.endsWith('icash_get_recorded_reception_config'))value=c;
  else if(u.pathname.endsWith('icash_claim_seller_agreement_rollout'))value=scenario!=='claim_denied';
  else if(u.pathname.endsWith(automatic?'icash_stage_voice_offer_rollout':'icash_stage_seller_agreement_rollout')){
   assert.equal(body.p_tool,'tool_agreement');assert.equal(body.p_branch,'agtbrch_newin');assert.equal(body.p_outbound_review.branchId,'agtbrch_newout');
   assert.equal(body.p_outbound_review.contractToolId,body.p_tool);assert(!body.p_outbound_review.toolIds.includes('tool_oldcontract'));
   assert(recordingAgentMatches(body.p_outbound_review,created.get(outgoing.agent_id)));
   value={inboundConfigId:'candidate',outboundReview:body.p_outbound_review};
  }else if(u.pathname.endsWith('/settings'))value={webhooks:{post_call_webhook_id:null}};
  else if(u.pathname.endsWith('/tools/tool_stop'))value=stop;
  else if(u.pathname.endsWith('/tools/tool_previous'))value=oldAgreementTool;
  else if(u.pathname.endsWith('/tools/tool_agreement'))value=tool;
  else if(u.pathname.endsWith('/tools')&&init.method==='POST'){
   assert.deepEqual(body.tool_config,automatic?automaticOfferToolConfig:noEmd?noEmdAgreementToolConfig:sellerAgreementToolConfig);tool={id:'tool_agreement',tool_config:structuredClone(body.tool_config)};
   if(scenario==='changed_tool')tool.tool_config.api_schema.url='https://unexpected.invalid';value=tool;
  }else if(u.pathname.endsWith('/tools'))value={tools:[],has_more:false,next_cursor:null};
  else {
   const isIn=u.pathname.includes(incoming.agent_id),source=isIn?incoming:outgoing,id=isIn?'agtbrch_newin':'agtbrch_newout';
   if(u.pathname.endsWith('/branches')&&init.method==='POST'){
    assert.equal(body.parent_version_id,source.version_id);if(!automatic)assert.equal(body.platform_settings,undefined);
    assert.deepEqual(Object.keys(body.conversation_config),['agent']);
    const copy=structuredClone(source);if(body.platform_settings)Object.assign(copy.platform_settings,body.platform_settings);Object.assign(copy,{branch_id:id,version_id:isIn?'agtvrsn_newin':'agtvrsn_newout'});
    copy.conversation_config.agent={...copy.conversation_config.agent,...body.conversation_config.agent,prompt:{...copy.conversation_config.agent.prompt,...body.conversation_config.agent.prompt}};
    // Provider GET may expand canonical webhook definitions alongside tool IDs.
    copy.conversation_config.agent.prompt.tools=isIn?[stop.tool_config,tool.tool_config]:[tool.tool_config];
    created.set(source.agent_id,copy);value={created_branch_id:id};
   }else if(u.pathname.endsWith('/branches'))value={results:[branch(source),...(created.has(source.agent_id)?[{...branch(created.get(source.agent_id)),name:automatic?'automatic-offer-flow-20261008-v1':noEmd?'seller-agreement-no-emd-20261008':'seller-agreement-on-call-20261008'}]:[])]};
   else if(u.searchParams.get('branch_id')===id)value=created.get(source.agent_id);
   else {value=structuredClone(source);if(scenario==='source_changed'&&created.size)value.version_id='agtvrsn_changed';}
  }
  return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
 };
 if(scenario==='ok'){
  assert.equal((await prepareSellerAgreement(env,fetcher,noEmd,automatic,async(api,agents,id)=>{assert.equal(agents.length,2);assert.equal(id,"tool_agreement");})).status,'staged');
  const a=created.get(incoming.agent_id),candidate={...c,context_policy:automatic?automaticOfferReceptionPolicy:noEmd?noEmdReceptionPolicy:sellerAgreementReceptionPolicy,context_policy_hash:automatic?automaticOfferReceptionPolicyHash:noEmd?noEmdReceptionPolicyHash:sellerAgreementReceptionPolicyHash,agreement_tool_id:tool.id,branch_id:a.branch_id,reviewed_version_id:a.version_id};
  candidate.config_hash=inspectRecordedReceptionAgent(candidate,a,branch(a),true,stop,tool).hash;
  assert(inspectRecordedReceptionAgent(candidate,a,branch(a),true,stop,tool).safe);
  assert(!inspectRecordedReceptionAgent(candidate,a,branch(a),true,stop).safe);
  assert.equal(a.conversation_config.agent.prompt.prompt,(automatic?automaticOfferReceptionPrompt:noEmd?noEmdReceptionPrompt:sellerAgreementReceptionPrompt)+directRecordedInstructions);
  const bad=structuredClone(a);bad.conversation_config.agent.prompt.tools.push({...tool.tool_config,name:'unreviewed'});
  candidate.config_hash=inspectRecordedReceptionAgent(candidate,bad,branch(bad),true,stop,tool).hash;
  assert(!inspectRecordedReceptionAgent(candidate,bad,branch(bad),true,stop,tool).safe);
 }else await assert.rejects(prepareSellerAgreement(env,fetcher,noEmd,automatic,async(api,agents,id)=>{assert.equal(agents.length,2);assert.equal(id,"tool_agreement");}),new RegExp({claim_denied:'PRIOR_TOOL_CREATE_UNCONFIRMED',changed_tool:'AGREEMENT_TOOL_READBACK_REQUIRED',source_changed:'SOURCE_BRANCH_CHANGED'}[scenario]));
 assert(!writes.some(w=>/Calls|submissions|enable|Messages/.test(w.path)));
 if(scenario==='claim_denied')assert.equal(writes.filter(w=>w.path.endsWith('/tools')).length,0);
}
assert.equal((await prepareSellerAgreement({...env,VERCEL_ENV:'preview'},()=>{throw Error('UNEXPECTED_NETWORK');})).status,'not_requested');
}
await testStaging(false);await testStaging(true);await testStaging(false,true);
console.log('PASS isolated seller agreement staging, source preservation, exact additional tool validation, zero traffic and inert previews.');
