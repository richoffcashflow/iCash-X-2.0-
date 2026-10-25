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
  if(path==='rpc/icash_create_direct_recorded_call'){event('create');return structuredClone(row);}
  assert.equal(path,'rpc/icash_transition_call_recording');event(body.p_action);
  if(body.p_action==='bind_call')row.call_sid=ca;
  return structuredClone(row);
 };
 const provider={agent:async()=>{event('agent');return agent;},tool:async()=>{event('tool');return invalidTool?{...tool,id:'tool_wrong'}:tool;},dial:async(_from,_to,twiml)=>{event('dial');assert(!twiml.includes('<Record'));assert(twiml.includes('<Redirect method="POST">'));assert(twiml.includes('/recording/connect?id='));assert(!twiml.includes('<Gather'));return {sid:ca,account_sid:ac,from:row.from_phone,to:row.to_phone,direction:'outbound-api',date_created:iso};},start:async()=>{throw Error('Never capture before affirmative consent');},register:async()=>{throw Error('Never connect the AI before affirmative consent');}};
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
console.log('PASS actual server/service: final live/capture/receipts/review races stop before carrier dial, stop-tool review fails closed, ready direct-entry path dials once and leaves recording authorization to its bound callback');
// Abort the real server's provider deadline at exact boundaries. No sleeps,
// provider traffic or production data: only receipt writes may outlive it.
async function deadlineFixture(scenario){
 const env={ICASH_LIVE_WORK_READY:'true',ICASH_RECORDED_OUTBOUND_READY:'true',ICASH_RECORDING_RECEIPTS_READY:'true',RECORDED_OUTBOUND_REVIEW_JSON:JSON.stringify(review),TWILIO_ACCOUNT_SID:ac,TWILIO_AUTH_TOKEN:'synthetic-provider-token-only',ELEVENLABS_API_KEY:'synthetic-only'};
 const caller=new AbortController(),timers=[],events=[],diagnostics=[];let providerSignal,dialCount=0,claimed=false;
 const row={id,account_id:accountId,operation_key:operationKey,provider_account_sid:ac,call_sid:null,state:'consent_pending',to_phone:'+12125550102',from_phone:review.fromPhone,max_total_seconds:600};
 const timerApi={any:signals=>AbortSignal.any(signals),timeout:ms=>{const controller=new AbortController();timers.push({ms,controller});return controller.signal;}};
 const expire=()=>timers[0].controller.abort(new DOMException('Synthetic timeout','TimeoutError'));
 const db=async(path,_method,body,signal)=>{
  signal.throwIfAborted();const action=path==='rpc/icash_create_direct_recorded_call'?'create':body.p_action;events.push(action);
  if(action==='create'){assert.equal(signal,providerSignal);if(scenario==='after_create')expire();return structuredClone(row);}
  if(action==='claim_dial'){
   assert.equal(signal,providerSignal);claimed=true;
   if(['after_claim','claim_response_lost'].includes(scenario))expire();
   if(scenario==='claim_response_lost')throw providerSignal.reason;
   return structuredClone(row);
  }
  assert(['bind_call','dial_unknown'].includes(action),'Independent writer cannot admit or start work');
  assert.notEqual(signal,providerSignal);assert.equal(signal.aborted,false);assert.equal(timers.at(-1).ms,8000);
  if(scenario==='receipt_write_failed')throw Error('Synthetic receipt database unavailable');
  if(action==='bind_call')row.call_sid=body.p_payload.callSid;
  if(action==='dial_unknown')assert.equal(claimed,true);
  return structuredClone(row);
 };
 const provider={agent:async()=>{providerSignal.throwIfAborted();events.push('agent');return agent;},tool:async()=>{providerSignal.throwIfAborted();events.push('tool');return tool;},dial:async()=>{
  providerSignal.throwIfAborted();events.push('dial');dialCount++;
  if(['dial_timeout','result_after_deadline'].includes(scenario))expire();
  if(scenario==='dial_timeout')throw providerSignal.reason;
  if(scenario==='result_after_disconnect')caller.abort();
  return {sid:ca,account_sid:ac,from:row.from_phone,to:row.to_phone,direction:'outbound-api',date_created:new Date().toISOString()};
 }};
 if(scenario==='already_aborted')caller.abort();
 const {recordingServer}=await loadService('lib/required-call-recording-server.ts',{db,createRecordingProviders:(_env,_fetch,signal)=>{providerSignal=signal;return provider;},readRecordingReview,recordingService,process:{env},AbortSignal:timerApi});
 const warn=console.warn;console.warn=(name,payload)=>diagnostics.push({name,payload});
 let result;try{result=await recordingServer(caller.signal).dispatch({accountId,operationKey,principal:'Synthetic Principal',assistantName:'Alex',firstMessage:'Synthetic greeting',prompt:'Synthetic prompt',strategyKey:'cash_interest'});}finally{console.warn=warn;}
 assert.equal(timers[0].ms,12000);assert(timers.slice(1).every(t=>t.ms===8000));
 assert(dialCount<=1,'No provider retry after any timeout or failed receipt write');
 assert(!JSON.stringify(diagnostics).includes(row.to_phone));assert(!JSON.stringify(diagnostics).includes(env.TWILIO_AUTH_TOKEN));
 return {result,events,diagnostics,dialCount,row};
}
for(const scenario of ['already_aborted','after_create','after_claim']){
 const f=await deadlineFixture(scenario);assert.equal(f.result.status,'recording_release_required');assert.equal(f.dialCount,0);
 if(scenario==='already_aborted')assert.deepEqual(f.events,[]);
 if(scenario==='after_create')assert(!f.events.includes('claim_dial'));
}
for(const scenario of ['claim_response_lost','dial_timeout']){
 const f=await deadlineFixture(scenario);assert.equal(f.result.status,'recording_dial_unknown_no_retry');assert.equal(f.events.at(-1),'dial_unknown');
 assert.equal(f.dialCount,scenario==='dial_timeout'?1:0);assert.equal(f.row.call_sid,null);
 assert.deepEqual(f.diagnostics,[{name:'recording_dispatch_held',payload:{stage:scenario==='dial_timeout'?'dial':'dial_claim',recordingId:id,reason:'deadline_exceeded',holdSaved:true}}]);
}
for(const scenario of ['result_after_deadline','result_after_disconnect']){
 const f=await deadlineFixture(scenario);assert.equal(f.result.status,'recording_consent_pending');assert.equal(f.events.at(-1),'bind_call');assert.equal(f.row.call_sid,ca);assert.equal(f.dialCount,1);assert.deepEqual(f.diagnostics,[]);
}
const failedReceipt=await deadlineFixture('receipt_write_failed');assert.equal(failedReceipt.result.status,'recording_dial_unknown_no_retry');assert.equal(failedReceipt.dialCount,1);assert.equal(failedReceipt.row.call_sid,null);assert.equal(failedReceipt.diagnostics[0].payload.holdSaved,false);assert.equal(failedReceipt.diagnostics[0].payload.stage,'bind_call');
console.log('PASS actual server/service: expired admission never dials, ambiguous claim retains hold, confirmed results and timeout holds use bounded independent writes, failed writes never retry the provider');
// Admission-only guards must not disable receipt settlement for past calls.
const {settleReviewedReception}=await import('../lib/general-reception-settlement.ts');
const {receptionProfiles}=await import('../lib/general-reception.ts');
for(const call_profile of ['normal','owner_quick_test']){
 const profile=receptionProfiles[call_profile],calls=[],receipt={receipt_id:id,account_id:accountId,operation_key:'reception:'+ca,call_sid:ca,receipt_nonce:'c'.repeat(64),config_hash:'d'.repeat(64),agent_id:review.agentId,branch_id:review.branchId,reviewed_version_id:review.versionId,call_profile,rate_id:profile.rateId,max_duration_seconds:profile.maxDurationSeconds,customer_charge_cap_cents:profile.customerChargeCapCents};
 const result=await settleReviewedReception(receipt,'conv_historical',30,{twilioUsdMicros:8500,elevenLabsUsdMicros:29000,twilioReceiptHash:'e'.repeat(64),elevenLabsReceiptHash:'f'.repeat(64)},{rpc:async(name,body)=>{calls.push({name,body});return {settled:true,chargedCents:14,costBasis:'verified',providerMarginVerified:true};}},AbortSignal.timeout(1000));
 assert.equal(result.settled,true);assert.equal(calls.length,1);assert.equal(calls[0].name,'icash_settle_general_reception');assert.equal(calls[0].body.p_attestation.binding.callProfile,call_profile);assert.equal(calls[0].body.p_attestation.binding.customerChargeCapCents,profile.customerChargeCapCents);
}
console.log('PASS historical normal430/owner65 receipt settlements remain available with exact original tier and reviewed cost attestations');
