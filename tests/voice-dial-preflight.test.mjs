// Real recording service, synthetic provider and database: never places a call.
import assert from 'node:assert/strict';
import {recordingService} from '../lib/required-call-recording-service.ts';
import {readRecordingReview,recordingAgentMatches,recordingPolicy,recordingBaseUrl,canonical,sha} from '../lib/required-call-recording.ts';
import {sellerAgreementToolConfig} from '../lib/seller-agreement-tool.ts';
const now=Date.now(),accountId='11111111-1111-4111-8111-111111111111',operationKey='voice:22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333',ac='AC'+'a'.repeat(32),ca='CA'+'b'.repeat(32);
const agent={agent_id:'agent_fixture',branch_id:'agtbrch_recorded',main_branch_id:'agtbrch_main',version_id:'agtvrsn_reviewed',conversation_config:{asr:{user_input_audio_format:'ulaw_8000'},tts:{agent_output_audio_format:'ulaw_8000'},conversation:{max_duration_seconds:600},agent:{prompt:{tool_ids:['tool_callback','tool_handoff','tool_stop','tool_contract']}}},platform_settings:{privacy:{record_voice:false},auth:{enable_auth:true},call_limits:{bursting_enabled:false},queueing_config:{enabled:false},overrides:{conversation_config_override:{conversation:{max_duration_seconds:true},agent:{first_message:true,prompt:{prompt:true}},tts:{voice_id:true}}}}};
const review={enabled:true,reviewedAt:new Date(now-1000).toISOString(),reviewedUntil:new Date(now+3600000).toISOString(),agentId:agent.agent_id,branchId:agent.branch_id,versionId:agent.version_id,configHash:sha(JSON.stringify(canonical({conversation_config:agent.conversation_config,platform_settings:agent.platform_settings,workflow:null,procedures:null}))),fromPhone:'+12125550101',providerAccountSid:ac,stopToolId:'tool_stop',contractToolId:'tool_contract',toolIds:[...agent.conversation_config.agent.prompt.tool_ids],approvedHoldCents:recordingPolicy.minimumHoldCents,retentionDays:30,maxTotalSeconds:600,policyVersion:recordingPolicy.version};
const stop={id:'tool_stop',tool_config:{type:'webhook',name:'icash_stop_recording',api_schema:{url:recordingBaseUrl+'/stop',method:'POST',request_headers:{Authorization:{variable_name:'secret__icash_recording_stop_token'}},request_body_schema:{type:'object',required:['recordingId'],properties:{recordingId:{type:'string',dynamic_variable:'icash_recording_id'}}}}}};
const contract={id:'tool_contract',tool_config:structuredClone(sellerAgreementToolConfig)};
assert(readRecordingReview(JSON.stringify(review),now));assert(recordingAgentMatches(review,agent));
const input={accountId,operationKey,principal:'Synthetic Principal',assistantName:'Alex',firstMessage:'Synthetic greeting',prompt:'Synthetic prompt',strategyKey:'cash_interest'};
function fixture({invalid=null,reject=null}={}){
 const started=[],events=[],gates=new Map(),resources={agent:structuredClone(agent),tool_contract:structuredClone(contract),tool_stop:structuredClone(stop)};
 let allowed=true;
 const read=async key=>{started.push(key);await new Promise(resolve=>gates.set(key,resolve));if(reject===key)throw Error('Synthetic preflight timeout');return key===invalid?{}:resources[key];};
 const row={id,account_id:accountId,operation_key:operationKey,provider_account_sid:ac,call_sid:null,state:'consent_pending',to_phone:'+12125550102',from_phone:review.fromPhone,max_total_seconds:600};
 const db=async(path,_method,body)=>{
  const action=path==='rpc/icash_create_direct_recorded_call'?'create':body.p_action;events.push(action);
  if(action==='bind_call')row.call_sid=body.p_payload.callSid;
  return structuredClone(row);
 };
 const provider={agent:async r=>{assert.equal(r.branchId,review.branchId);assert.equal(r.versionId,review.versionId);return read('agent');},tool:read,dial:async()=>{events.push('dial');return {sid:ca,account_sid:ac,from:row.from_phone,to:row.to_phone,direction:'outbound-api'};}};
 const service=recordingService({ICASH_RECORDED_OUTBOUND_READY:'true',RECORDED_OUTBOUND_REVIEW_JSON:JSON.stringify(review),TWILIO_ACCOUNT_SID:ac,TWILIO_AUTH_TOKEN:'synthetic-only'},{db,provider,now:()=>now,dispatchAllowed:()=>allowed});
 return {service,started,events,resources,release:key=>gates.get(key)(),pause:()=>{allowed=false;}};
}
const keys=['agent','tool_contract','tool_stop'];
for(const last of keys){
 const f=fixture(),pending=f.service.dispatch(input);
 await new Promise(setImmediate);assert.deepEqual(f.started,keys);assert.deepEqual(f.events,[]);
 for(const key of keys.filter(k=>k!==last))f.release(key);
 await new Promise(setImmediate);assert.deepEqual(f.events,[],'No admission while any exact review read remains pending');
 f.release(last);assert.equal((await pending).status,'recording_consent_pending');
 assert.deepEqual(f.events,['create','claim_dial','dial','bind_call']);
}
for(const kind of ['invalid','reject'])for(const key of keys){
 const f=fixture({[kind]:key}),pending=f.service.dispatch(input);
 await new Promise(setImmediate);assert.deepEqual(f.started,keys);
 for(const resource of keys)f.release(resource);
 if(kind==='reject')await assert.rejects(pending,/Synthetic preflight timeout/);
 else assert.equal((await pending).status,'recording_review_required');
 assert.deepEqual(f.events,[],'A failed review cannot create, claim or dial');
}
const paused=fixture(),pausePending=paused.service.dispatch(input);
await new Promise(setImmediate);paused.pause();for(const key of keys)paused.release(key);
assert.equal((await pausePending).status,'recording_release_required');assert.deepEqual(paused.events,[]);
// Another attempt always re-reads the reviewed resources; old success cannot
// hide drift. This second attempt never reaches recording creation or dialing.
const fresh=fixture(),first=fresh.service.dispatch(input);
await new Promise(setImmediate);for(const key of keys)fresh.release(key);await first;
fresh.resources.agent.version_id='agtvrsn_changed';const second=fresh.service.dispatch(input);
await new Promise(setImmediate);assert.equal(fresh.started.length,6);for(const key of keys)fresh.release(key);
assert.equal((await second).status,'recording_review_required');assert.equal(fresh.events.filter(e=>e==='dial').length,1);
console.log('PASS concurrent fresh agent/contract/stop review waits for every read, fails closed and preserves final release checks and one dial.');
