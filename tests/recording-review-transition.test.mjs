// Exact two-review cutover through actual dispatch and signed callback services.
// Persistence and provider transports are fixtures; no external contacts.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {recordingService} from '../lib/required-call-recording-service.ts';
import {recordingPolicy,recordingBaseUrl,canonical,sha} from '../lib/required-call-recording.ts';
import {readRecordingReviews,recordingReviewInPair,recordingReviewForConfig,recordingReviewForRow} from '../lib/recording-review-transition.ts';
const now=Date.now(),iso=new Date(now).toISOString(),account='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',operation='voice:33333333-3333-4333-8333-333333333333',ac='AC'+'a'.repeat(32),ca='CA'+'b'.repeat(32),re='RE'+'c'.repeat(32),nonce='d'.repeat(64);
const makeAgent=(tag,timeout)=>({agent_id:'agent_fixture',branch_id:'agtbrch_'+tag,main_branch_id:'agtbrch_main',version_id:'agtvrsn_'+tag,conversation_config:{asr:{user_input_audio_format:'ulaw_8000'},tts:{agent_output_audio_format:'ulaw_8000'},turn:{turn_timeout:timeout},conversation:{max_duration_seconds:600},agent:{prompt:{tool_ids:['tool_callback','tool_handoff','tool_stop']}}},platform_settings:{privacy:{record_voice:false},auth:{enable_auth:true},call_limits:{bursting_enabled:false},queueing_config:{enabled:false},overrides:{conversation_config_override:{conversation:{max_duration_seconds:true},agent:{first_message:true,prompt:{prompt:true}},tts:{voice_id:true}}}}});
const priorAgent=makeAgent('previous',3),currentAgent=makeAgent('current',6);
const makeReview=(agent,age)=>({enabled:true,reviewedAt:new Date(now-age).toISOString(),reviewedUntil:new Date(now+3600000).toISOString(),agentId:agent.agent_id,branchId:agent.branch_id,versionId:agent.version_id,configHash:sha(JSON.stringify(canonical({conversation_config:agent.conversation_config,platform_settings:agent.platform_settings,workflow:null,procedures:null}))),fromPhone:'+12125550101',providerAccountSid:ac,stopToolId:'tool_stop',toolIds:['tool_callback','tool_handoff','tool_stop'],approvedHoldCents:977,retentionDays:30,maxTotalSeconds:600,policyVersion:recordingPolicy.version});
const primary=makeReview(currentAgent,1000),previous=makeReview(priorAgent,2000);
const environment=(pair=true)=>({ICASH_LIVE_WORK_READY:'true',ICASH_RECORDED_OUTBOUND_READY:'true',ICASH_RECORDING_RECEIPTS_READY:'true',RECORDED_OUTBOUND_REVIEW_JSON:JSON.stringify(primary),...(pair?{RECORDED_OUTBOUND_PREVIOUS_REVIEW_JSON:JSON.stringify(previous)}:{}),TWILIO_ACCOUNT_SID:ac,TWILIO_AUTH_TOKEN:'synthetic-provider-token',ELEVENLABS_API_KEY:'synthetic-provider-key'});
const config=review=>({agent_id:review.agentId,agent_config_hash:review.configHash,max_duration_seconds:review.maxTotalSeconds,required_tool_ids:[...review.toolIds]});
const rowFor=review=>({id,account_id:account,operation_key:operation,entry_policy:'direct_recorded_v1',party:'seller',provider_account_sid:ac,call_sid:ca,nonce_hash:sha(nonce),stop_token_hash:sha('synthetic-stop'),state:'consent_pending',consent_at:null,recording_authorized_at:null,start_claimed_at:null,recording_sid:null,created_at:iso,from_phone:review.fromPhone,to_phone:'+12125550102',agent_id:review.agentId,branch_id:review.branchId,version_id:review.versionId,disclosure_version:recordingPolicy.disclosureVersion,max_total_seconds:600});
assert.deepEqual(readRecordingReviews(environment(),now),[primary,previous]);
assert.deepEqual(readRecordingReviews(environment(false),now),[primary],'the default remains one review');
assert.equal(recordingReviewForConfig(environment(false),config(previous),now),null);
assert.equal(recordingReviewForRow(environment(false),rowFor(previous),now),null);
for(const review of [primary,previous]){
 assert.deepEqual(recordingReviewForConfig(environment(),config(review),now),review);
 assert.deepEqual(recordingReviewForRow(environment(),rowFor(review),now),review);
 assert.deepEqual(recordingReviewInPair(environment(),structuredClone(review),now),review);
 for(const change of [{agent_id:'agent_other'},{agent_config_hash:'f'.repeat(64)},{max_duration_seconds:120},{required_tool_ids:['tool_stop','tool_stop','tool_callback']}])assert.equal(recordingReviewForConfig(environment(),{...config(review),...change},now),null);
 for(const change of [{agent_id:'agent_other'},{branch_id:'agtbrch_other'},{version_id:'agtvrsn_other'},{provider_account_sid:'AC'+'f'.repeat(32)},{disclosure_version:'unreviewed'}])assert.equal(recordingReviewForRow(environment(),{...rowFor(review),...change},now),null);
}
assert.equal(recordingReviewForRow(environment(),{...rowFor(previous),version_id:primary.versionId},now),null,'never combine one branch with another version');
assert.equal(recordingReviewInPair(environment(),{...primary,configHash:previous.configHash},now),null,'no synthesized review');
for(const slot of ['RECORDED_OUTBOUND_REVIEW_JSON','RECORDED_OUTBOUND_PREVIOUS_REVIEW_JSON'])for(const value of ['bad','null',JSON.stringify({...previous,reviewedUntil:iso}),JSON.stringify({...previous,enabled:false})]){
 const env=environment();env[slot]=value;assert.equal(readRecordingReviews(env,now),null,slot+': invalid review cannot fall back');
}
for(const patch of [{agentId:'agent_other'},{fromPhone:'+12125550999'},{providerAccountSid:'AC'+'e'.repeat(32)},{stopToolId:'tool_other',toolIds:['tool_callback','tool_handoff','tool_other']},{toolIds:['tool_callback','tool_other','tool_stop']},{reviewedUntil:new Date(now+7200000).toISOString()},{futureAuthority:true},{branchId:primary.branchId},{versionId:primary.versionId},{configHash:primary.configHash},{reviewedAt:new Date(now-500).toISOString()}]){
 const env=environment();env.RECORDED_OUTBOUND_PREVIOUS_REVIEW_JSON=JSON.stringify({...previous,...patch});assert.equal(readRecordingReviews(env,now),null,JSON.stringify(patch));
}
const reordered=environment();reordered.RECORDED_OUTBOUND_PREVIOUS_REVIEW_JSON=JSON.stringify({...previous,toolIds:[...previous.toolIds].reverse()});assert.equal(readRecordingReviews(reordered,now).length,2);
const stop={id:'tool_stop',tool_config:{type:'webhook',name:'icash_stop_recording',api_schema:{url:recordingBaseUrl+'/stop',method:'POST',request_headers:{Authorization:{variable_name:'secret__icash_recording_stop_token'}},request_body_schema:{type:'object',required:['recordingId'],properties:{recordingId:{type:'string',dynamic_variable:'icash_recording_id'}}}}}};
const input={accountId:account,operationKey:operation,principal:'Fixture Buyer',assistantName:'Alex',firstMessage:'Fixture greeting',prompt:'Fixture prompt',strategyKey:'cash_interest'};
async function dispatch({selected=primary,pair=true,omitSelected=false,providerFailure=false,providerDrift=false,changeAt,changeSlot='RECORDED_OUTBOUND_PREVIOUS_REVIEW_JSON'}={}){
 const env=environment(pair),events=[];let row={...rowFor(primary),call_sid:null};
 const event=name=>{events.push(name);if(name===changeAt)env[changeSlot]+=' ';};
 const db=async(path,_method,body)=>{
  if(path==='rpc/icash_create_direct_recorded_call'){event('create');row={...rowFor(selected??primary),call_sid:null,branch_id:body.p_context.branchId,version_id:body.p_context.versionId};return structuredClone(row);}
  assert.equal(path,'rpc/icash_transition_call_recording');event(body.p_action);if(body.p_action==='bind_call')row.call_sid=body.p_payload.callSid;return structuredClone(row);
 };
 const provider={agent:async review=>{event('agent:'+review.branchId);if(providerFailure)throw Error('synthetic provider read failed');const agent=review.branchId===primary.branchId?currentAgent:priorAgent;return providerDrift?{...agent,version_id:'agtvrsn_drift'}:agent;},tool:async()=>{event('tool');return stop;},dial:async()=>{event('dial');return {sid:ca,account_sid:ac,from:row.from_phone,to:row.to_phone,direction:'outbound-api',date_created:iso};}};
 const {recordingServer}=await loadService('lib/required-call-recording-server.ts',{db,createRecordingProviders:()=>provider,recordingService,readRecordingReviews,recordingReviewInPair,process:{env}});
 let result,error;try{result=await recordingServer(undefined,'dispatch',omitSelected?undefined:selected).dispatch(input);}catch(e){error=e;}
 return {result,error,events,row};
}
for(const review of [primary,previous]){
 const f=await dispatch({selected:review});assert.equal(f.result.status,'recording_consent_pending');assert.equal(f.row.branch_id,review.branchId);assert.equal(f.row.version_id,review.versionId);assert.equal(f.events.filter(x=>x==='dial').length,1);assert.deepEqual(f.events.filter(x=>x.startsWith('agent:')),['agent:'+review.branchId]);
 for(const failure of ['providerFailure','providerDrift']){
  const f=await dispatch({selected:review,[failure]:true});assert(f.error||f.result.status==='recording_review_required');assert(!f.events.includes('create'));assert(!f.events.includes('dial'));assert.deepEqual(f.events.filter(x=>x.startsWith('agent:')),['agent:'+review.branchId],'provider failure never tries the other approval');
 }
}
for(const selected of [null,{}, {...previous,versionId:primary.versionId}]){
 const f=await dispatch({selected});assert(!f.events.includes('agent:'+primary.branchId));assert(!f.events.includes('create'));assert(!f.events.includes('dial'),'invalid explicit selection cannot use the default review');
}
assert.equal((await dispatch({selected:primary,pair:false})).result.status,'recording_consent_pending');
assert.equal((await dispatch({selected:previous,pair:false})).result.status,'recording_release_required');
for(const pair of [false,true]){
 const f=await dispatch({pair,omitSelected:true});assert.equal(f.result.status,'recording_consent_pending');assert.equal(f.row.branch_id,primary.branchId);assert.deepEqual(f.events.filter(x=>x.startsWith('agent:')),['agent:'+primary.branchId],'omitting selection uses only the primary review');
}
for(const selected of [primary,previous])for(const changeSlot of ['RECORDED_OUTBOUND_REVIEW_JSON','RECORDED_OUTBOUND_PREVIOUS_REVIEW_JSON'])for(const changeAt of ['tool','create','claim_dial']){
 const f=await dispatch({selected,changeAt,changeSlot});assert.equal(f.result.status,'recording_release_required');assert(!f.events.includes('dial'));if(changeAt==='tool')assert(!f.events.includes('create'),'either raw review changing stops before admission');
}
async function callback({review=previous,pair=true,providerFailure=false,providerDrift=false,foreignRow=false,badSignature=false,changeSlot}={}){
 const env=environment(pair),events=[];let row=rowFor(review);
 if(foreignRow)row.version_id=review===previous?primary.versionId:previous.versionId;
 const db=async(path,_method,body)=>{
  if(path.startsWith('icash_call_recordings?'))return [structuredClone(row)];
  assert.equal(path,'rpc/icash_transition_call_recording');const action=body.p_action;events.push(action);
  if(action==='authorize_recording')row.recording_authorized_at=iso;
  if(action==='claim_start'){row.state='starting';row.start_claimed_at=iso;}
  if(action==='started'){row.state='recording';row.recording_sid=re;row.provider_started_at=iso;}
  if(action==='stop'){row.state='stopping';row.end_requested_at=iso;}
  if(action==='call_ended')row.call_ended_at=iso;
  return structuredClone(row);
 };
 const provider={getCall:async()=>({sid:ca,account_sid:ac,from:row.from_phone,to:row.to_phone,direction:'outbound-api',status:'in-progress',date_created:iso,start_time:iso}),agent:async selected=>{events.push('agent:'+selected.branchId);if(changeSlot)env[changeSlot]+=' ';if(providerFailure)throw Error('synthetic read failed');const agent=selected.branchId===primary.branchId?currentAgent:priorAgent;return providerDrift?{...agent,version_id:'agtvrsn_drift'}:agent;},tool:async()=>stop,start:async()=>{events.push('start');return {sid:re,account_sid:ac,call_sid:ca,status:'in-progress',start_time:iso};},register:async r=>{events.push('register:'+r.branch_id);assert.equal(r.state,'recording');assert.equal(r.recording_sid,re);return '<Response><Connect><Stream url="wss://fixture.invalid"/></Connect></Response>';},end:async()=>{events.push('end');return {sid:ca,account_sid:ac,status:'completed'};}};
 const {recordingServer}=await loadService('lib/required-call-recording-server.ts',{db,createRecordingProviders:()=>provider,recordingService:(env,deps)=>recordingService(env,{...deps,now:()=>now}),readRecordingReviews,recordingReviewInPair,process:{env}});
 const service=recordingServer();
 const url=recordingBaseUrl+'/connect?id='+id+'&nonce='+nonce,form=new URLSearchParams({AccountSid:ac,CallSid:ca});
 const signature=createHmac('sha1',env.TWILIO_AUTH_TOKEN).update(url+[...form.keys()].sort().map(k=>k+form.get(k)).join('')).digest('base64');
 const request=new Request(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':badSignature?'invalid':signature},body:form});
 const warn=console.warn;console.warn=()=>{};let text;try{text=await (await service.consent(request,false,true)).text();}finally{console.warn=warn;}
 return {text,events,row};
}
for(const review of [primary,previous]){
 const f=await callback({review});assert.match(f.text,/<Connect/);assert.deepEqual(f.events.filter(x=>x.startsWith('agent:')),['agent:'+review.branchId]);assert(f.events.includes('register:'+review.branchId));assert.equal(f.events.filter(x=>x==='start').length,1);
 for(const options of [{providerFailure:true},{providerDrift:true},{foreignRow:true},{badSignature:true},{changeSlot:'RECORDED_OUTBOUND_REVIEW_JSON'},{changeSlot:'RECORDED_OUTBOUND_PREVIOUS_REVIEW_JSON'}]){
  const f=await callback({review,...options});assert.match(f.text,/<Hangup/);assert(!f.events.includes('start'));assert(!f.events.some(x=>x.startsWith('register:')));assert(f.events.filter(x=>x.startsWith('agent:')).length<=1,'callback cannot fall back to the other branch');
 }
}
assert.match((await callback({review:previous,pair:false})).text,/<Hangup/);
assert.match((await callback({review:primary,pair:false})).text,/<Connect/);
console.log('PASS exact review cutover: same-authority pair, config/hash and row/branch/version selection, fresh provider checks without fallback, invalid and changed review rejection, one dial/start, signed callbacks, and unchanged single-review operation. No external calls.');
