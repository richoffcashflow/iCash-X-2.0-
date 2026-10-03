// Synthetic-only dispatch race tests. No provider traffic, credentials, or live state.
import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {recordingService} from '../lib/required-call-recording-service.ts';
import {readRecordingReview,recordingPolicy,recordingBaseUrl,canonical,sha} from '../lib/required-call-recording.ts';
const now=Date.now(),iso=new Date(now).toISOString(),accountId='11111111-1111-4111-8111-111111111111',operationKey='voice:22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333',ac='AC'+'a'.repeat(32),ca='CA'+'b'.repeat(32);
const agent={agent_id:'agent_fixture',branch_id:'agtbrch_recorded',main_branch_id:'agtbrch_main',version_id:'agtvrsn_reviewed',conversation_config:{asr:{user_input_audio_format:'ulaw_8000'},tts:{agent_output_audio_format:'ulaw_8000'},conversation:{max_duration_seconds:600},agent:{prompt:{tool_ids:['tool_callback','tool_handoff','tool_stop']}}},platform_settings:{privacy:{record_voice:false},auth:{enable_auth:true},call_limits:{bursting_enabled:false},queueing_config:{enabled:false},overrides:{conversation_config_override:{conversation:{max_duration_seconds:true},agent:{first_message:true,prompt:{prompt:true}},tts:{voice_id:true}}}}};
const review={enabled:true,reviewedAt:new Date(now-1000).toISOString(),reviewedUntil:new Date(now+3600000).toISOString(),agentId:agent.agent_id,branchId:agent.branch_id,versionId:agent.version_id,configHash:sha(JSON.stringify(canonical({conversation_config:agent.conversation_config,platform_settings:agent.platform_settings,workflow:null,procedures:null}))),fromPhone:'+12125550101',providerAccountSid:ac,stopToolId:'tool_stop',toolIds:['tool_callback','tool_handoff','tool_stop'],approvedHoldCents:977,retentionDays:30,maxTotalSeconds:600,policyVersion:recordingPolicy.version};
const tool={id:'tool_stop',tool_config:{type:'webhook',name:'icash_stop_recording',api_schema:{url:recordingBaseUrl+'/stop',method:'POST',request_headers:{Authorization:{variable_name:'secret__icash_recording_stop_token'}},request_body_schema:{type:'object',required:['recordingId'],properties:{recordingId:{type:'string',dynamic_variable:'icash_recording_id'}}}}}};
async function fixture(changeAt,change=env=>env.ICASH_RECORDED_OUTBOUND_READY='false',invalidTool=false){
 const env={ICASH_LIVE_WORK_READY:'true',ICASH_RECORDED_OUTBOUND_READY:'true',ICASH_RECORDING_RECEIPTS_READY:'true',RECORDED_OUTBOUND_REVIEW_JSON:JSON.stringify(review),TWILIO_ACCOUNT_SID:ac,TWILIO_AUTH_TOKEN:'synthetic-provider-token-only',ELEVENLABS_API_KEY:'synthetic-only'},events=[];
 const row={id,account_id:accountId,operation_key:operationKey,provider_account_sid:ac,call_sid:null,state:'consent_pending',to_phone:'+12125550102',from_phone:review.fromPhone};
 const event=name=>{events.push(name);if(changeAt===name)change(env);};
 const db=async(path,method,body)=>{
  if(path==='rpc/icash_create_call_recording'){event('create');return structuredClone(row);}
  assert.equal(path,'rpc/icash_transition_call_recording');event(body.p_action);
  if(body.p_action==='bind_call')row.call_sid=ca;
  return structuredClone(row);
 };
 const provider={agent:async()=>{event('agent');return agent;},tool:async()=>{event('tool');return invalidTool?{...tool,id:'tool_wrong'}:tool;},dial:async(_from,_to,twiml)=>{event('dial');assert(!twiml.includes('<Record'));assert(twiml.indexOf('</Say>')<twiml.indexOf('<Gather'));return {sid:ca,account_sid:ac,from:row.from_phone,to:row.to_phone,direction:'outbound-api',date_created:iso};},start:async()=>{throw Error('Never capture before affirmative consent');},register:async()=>{throw Error('Never connect the AI before affirmative consent');}};
 const {recordingServer}=await loadService('lib/required-call-recording-server.ts',{db,createRecordingProviders:()=>provider,readRecordingReview,recordingService,process:{env}});
 if(changeAt==='before')change(env);
 const result=await recordingServer().dispatch({accountId,operationKey,principal:'Synthetic Principal',assistantName:'Alex',firstMessage:'Synthetic greeting',prompt:'Synthetic prompt',strategyKey:'cash_interest'});
 return {result,events};
}
for(const stage of ['before','agent','tool','create','claim_dial'])for(const change of [env=>env.ICASH_RECORDED_OUTBOUND_READY='false',env=>env.ICASH_RECORDING_RECEIPTS_READY='false',env=>env.ICASH_LIVE_WORK_READY='false',env=>env.RECORDED_OUTBOUND_REVIEW_JSON=JSON.stringify({...review,reviewedUntil:new Date(now-1).toISOString()})]){
 const {result,events}=await fixture(stage,change);assert.equal(result.status,'recording_release_required',stage);assert(!events.includes('dial'),stage);if(['before','agent','tool'].includes(stage))assert(!events.includes('create'));if(stage==='create')assert(!events.includes('claim_dial'));
}
const changed=await fixture('tool',env=>env.RECORDED_OUTBOUND_REVIEW_JSON=JSON.stringify({...review,versionId:'agtvrsn_changed'}));assert.equal(changed.result.status,'recording_release_required');assert(!changed.events.includes('create'));
const invalid=await fixture(null,undefined,true);assert.equal(invalid.result.status,'recording_review_required');assert(!invalid.events.includes('create'));assert(!invalid.events.includes('dial'));
const ready=await fixture(null);assert.equal(ready.result.status,'recording_consent_pending');assert.deepEqual(ready.events,['agent','tool','create','claim_dial','dial','bind_call']);
console.log('PASS actual server/service: final live/capture/receipts/review races stop before carrier dial, stop-tool review fails closed, ready path dials once with disclosure before listening and no recording/AI before consent');
// Admission-only guards must not disable receipt settlement for past calls.
const {settleReviewedReception}=await import('../lib/general-reception-settlement.ts');
const {receptionProfiles}=await import('../lib/general-reception.ts');
for(const call_profile of ['normal','owner_quick_test']){
 const profile=receptionProfiles[call_profile],calls=[],receipt={receipt_id:id,account_id:accountId,operation_key:'reception:'+ca,call_sid:ca,receipt_nonce:'c'.repeat(64),config_hash:'d'.repeat(64),agent_id:review.agentId,branch_id:review.branchId,reviewed_version_id:review.versionId,call_profile,rate_id:profile.rateId,max_duration_seconds:profile.maxDurationSeconds,customer_charge_cap_cents:profile.customerChargeCapCents};
 const result=await settleReviewedReception(receipt,'conv_historical',30,{twilioUsdMicros:8500,elevenLabsUsdMicros:29000,twilioReceiptHash:'e'.repeat(64),elevenLabsReceiptHash:'f'.repeat(64)},{rpc:async(name,body)=>{calls.push({name,body});return {settled:true,chargedCents:14,costBasis:'verified',providerMarginVerified:true};}},AbortSignal.timeout(1000));
 assert.equal(result.settled,true);assert.equal(calls.length,1);assert.equal(calls[0].name,'icash_settle_general_reception');assert.equal(calls[0].body.p_attestation.binding.callProfile,call_profile);assert.equal(calls[0].body.p_attestation.binding.customerChargeCapCents,profile.customerChargeCapCents);
}
console.log('PASS historical normal430/owner65 receipt settlements remain available with exact original tier and reviewed cost attestations');
