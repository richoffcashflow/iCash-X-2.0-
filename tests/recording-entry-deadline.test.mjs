// Actual callback server/service with a deterministic clock. No live providers.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {recordingService} from '../lib/required-call-recording-service.ts';
import {readRecordingReview,recordingPolicy,recordingBaseUrl,canonical,sha} from '../lib/required-call-recording.ts';
import {sellerAgreementToolConfig} from '../lib/seller-agreement-tool.ts';
import {RecordingProviderError} from '../lib/required-call-recording-provider.ts';
const base=Date.now(),iso=new Date(base).toISOString(),id='11111111-1111-4111-8111-111111111111',account='22222222-2222-4222-8222-222222222222',op='voice:33333333-3333-4333-8333-333333333333',ac='AC'+'a'.repeat(32),ca='CA'+'b'.repeat(32),re='RE'+'c'.repeat(32),nonce='d'.repeat(64);
const agent={agent_id:'agent_fixture',branch_id:'agtbrch_recorded',main_branch_id:'agtbrch_main',version_id:'agtvrsn_reviewed',conversation_config:{asr:{user_input_audio_format:'ulaw_8000'},tts:{agent_output_audio_format:'ulaw_8000'},conversation:{max_duration_seconds:600},agent:{prompt:{tool_ids:['tool_callback','tool_handoff','tool_stop','tool_contract']}}},platform_settings:{privacy:{record_voice:false},auth:{enable_auth:true},call_limits:{bursting_enabled:false},queueing_config:{enabled:false},overrides:{conversation_config_override:{conversation:{max_duration_seconds:true},agent:{first_message:true,prompt:{prompt:true}},tts:{voice_id:true}}}}};
const review={enabled:true,reviewedAt:new Date(base-1000).toISOString(),reviewedUntil:new Date(base+3600000).toISOString(),agentId:agent.agent_id,branchId:agent.branch_id,versionId:agent.version_id,configHash:sha(JSON.stringify(canonical({conversation_config:agent.conversation_config,platform_settings:agent.platform_settings,workflow:null,procedures:null}))),fromPhone:'+12125550101',providerAccountSid:ac,stopToolId:'tool_stop',contractToolId:'tool_contract',toolIds:[...agent.conversation_config.agent.prompt.tool_ids],approvedHoldCents:recordingPolicy.minimumHoldCents,retentionDays:30,maxTotalSeconds:600,policyVersion:recordingPolicy.version};
const stop={id:'tool_stop',tool_config:{type:'webhook',name:'icash_stop_recording',api_schema:{url:recordingBaseUrl+'/stop',method:'POST',request_headers:{Authorization:{variable_name:'secret__icash_recording_stop_token'}},request_body_schema:{type:'object',required:['recordingId'],properties:{recordingId:{type:'string',dynamic_variable:'icash_recording_id'}}}}}};
const contract={id:'tool_contract',tool_config:structuredClone(sellerAgreementToolConfig)};
async function run(options={}){
 let elapsed=0,finished=false,signal,serviceEnv;const tasks=[],events=[],diagnostics=[],caller=new AbortController();
 const schedule=(ms,fn)=>tasks.push({at:elapsed+ms,fn});
 const timerApi={any:AbortSignal.any,timeout:ms=>{const c=new AbortController();schedule(ms,()=>c.abort(new DOMException('Synthetic deadline','TimeoutError')));return c.signal;}};
 const sleep=async ms=>{signal.throwIfAborted();await new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});schedule(ms,()=>{signal.removeEventListener('abort',abort);resolve();});});signal.throwIfAborted();};
 const row={id,account_id:account,operation_key:op,entry_policy:'direct_recorded_v1',party:'seller',provider_account_sid:ac,call_sid:ca,nonce_hash:sha(nonce),stop_token_hash:sha('stop-fixture'),state:'consent_pending',consent_at:null,recording_authorized_at:null,start_claimed_at:null,recording_sid:null,created_at:iso,from_phone:review.fromPhone,to_phone:'+12125550102',agent_id:review.agentId,branch_id:review.branchId,version_id:review.versionId,disclosure_version:recordingPolicy.disclosureVersion,max_total_seconds:600};
 const stamp=()=>new Date(base+elapsed).toISOString(),event=name=>events.push({name,at:elapsed});
 const env={ICASH_LIVE_WORK_READY:'true',ICASH_RECORDED_OUTBOUND_READY:'true',ICASH_RECORDING_RECEIPTS_READY:'true',RECORDED_OUTBOUND_REVIEW_JSON:JSON.stringify(review),TWILIO_ACCOUNT_SID:ac,TWILIO_AUTH_TOKEN:'synthetic-provider-token-only'};
 const db=async(path,_method,body,dbSignal)=>{
  assert.equal(dbSignal,signal);const action=body?.p_action??'read';event(action);
  await sleep(action==='read'?500:action==='authorize_recording'?500:250);
  if(options.fail===action)throw new DOMException('secret database payload','TimeoutError');
  if(action==='read')return [structuredClone(row)];
  if(action===options.hold)return null;
  if(action==='authorize_recording')row.recording_authorized_at=stamp();
  if(action==='claim_start'){assert(row.recording_authorized_at);assert.equal(row.start_claimed_at,null);row.start_claimed_at=stamp();row.state='starting';}
  if(action==='started'){row.recording_sid=body.p_payload.recordingSid;row.provider_started_at=body.p_payload.providerStartedAt;row.state='recording';}
  if(action==='decline')row.state='declined';
  if(action==='stop'){row.end_requested_at=stamp();row.state='stopping';}
  if(action==='call_ended')row.call_ended_at=stamp();
  return structuredClone(row);
 };
 const read=async(name,value,ms)=>{event(name);await sleep(options.slow===name?13000:ms);if(options.changeReview&&name==='call')serviceEnv.RECORDED_OUTBOUND_REVIEW_JSON=JSON.stringify({...review,configHash:'f'.repeat(64)});if(options.reject===name)throw new RecordingProviderError(503);return options.invalid===name?{}:value;};
 const provider={
  getCall:()=>read('call',{sid:ca,account_sid:ac,from:row.from_phone,to:row.to_phone,direction:'outbound-api',status:'in-progress',date_created:iso,start_time:iso},6000),
  agent:()=>read('agent',agent,5000),tool:key=>read(key,key==='tool_stop'?stop:contract,4500),
  start:async()=>{event('start');await sleep(750);if(options.fail==='start')throw Error('private provider error');return {sid:re,account_sid:ac,call_sid:ca,status:'in-progress',start_time:stamp()};},
  register:async r=>{event('register');assert.equal(r.state,'recording');assert.equal(r.recording_sid,re);await sleep(750);return '<Response><Connect><Stream url="wss://api.elevenlabs.io/fixture"/></Connect></Response>';},
  end:async()=>{event('end');return {sid:ca,account_sid:ac,status:'completed'};},
 };
 const {recordingServer}=await loadService('lib/required-call-recording-server.ts',{db,createRecordingProviders:(_env,_fetch,s)=>{signal=s;return provider;},readRecordingReview,recordingService:(env,deps)=>{serviceEnv=env;return recordingService(env,{...deps,now:()=>base+elapsed});},process:{env},AbortSignal:timerApi});
 const url=recordingBaseUrl+'/connect?id='+id+'&nonce='+nonce;
 const form=new URLSearchParams({AccountSid:ac,CallSid:options.foreignCall?'CA'+'f'.repeat(32):ca,...(options.optOut?{SpeechResult:'stop calling me',Confidence:'.99'}:{})});
 const signature=createHmac('sha1',env.TWILIO_AUTH_TOKEN).update(url+[...form.keys()].sort().map(k=>k+form.get(k)).join('')).digest('base64');
 const request=new Request(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':options.badSignature?'invalid':signature},body:form,signal:caller.signal});
 if(options.disconnect)schedule(options.disconnect,()=>caller.abort());
 const warn=console.warn;console.warn=(name,payload)=>diagnostics.push({name,payload});
 let response;
 try{
  const pending=recordingServer(caller.signal).consent(request,false,true).then(r=>{finished=true;response=r;},e=>{finished=true;throw e;});
  for(let i=0;i<80&&!finished;i++){
   await new Promise(setImmediate);if(finished)break;assert(tasks.length,'Pending work has a bounded timer');
   elapsed=Math.min(...tasks.map(x=>x.at));const due=tasks.filter(x=>x.at===elapsed);
   for(const task of due){tasks.splice(tasks.indexOf(task),1);task.fn();}
  }
  assert(finished,'Callback completes within its bounded deadline');await pending;
 }finally{console.warn=warn;}
 const text=await response.text();
 for(const secret of [nonce,env.TWILIO_AUTH_TOKEN,row.to_phone,'private provider error','secret database payload'])assert(!JSON.stringify(diagnostics).includes(secret));
 assert(events.filter(x=>x.name==='start').length<=1);assert(events.filter(x=>x.name==='register').length<=1);
 return {text,elapsed,events,diagnostics,row};
}
const success=await run();assert.match(success.text,/<Connect/);assert(success.elapsed<12000);
assert.deepEqual(success.events.filter(x=>['call','agent','tool_stop','tool_contract'].includes(x.name)).map(x=>x.at),[500,500,500,500]);
assert.deepEqual(success.events.map(x=>x.name),['read','call','agent','tool_contract','tool_stop','authorize_recording','claim_start','start','started','register']);
assert.equal(success.elapsed,9000);assert.deepEqual(success.diagnostics,[]);
// With those same delays, serial carrier + agent reads take 11.5s. The next
// authorization response reaches the 12s deadline, leaving no recording claim.
assert.equal(500+6000+5000+500,12000);
for(const key of ['call','agent','tool_contract','tool_stop'])for(const mode of ['invalid','reject']){
 const f=await run({[mode]:key});assert.match(f.text,/<Hangup/);assert(!f.events.some(x=>x.name==='start'||x.name==='register'));
 if(mode==='reject')assert.equal(f.diagnostics[0].payload.providerStatus,503);
}
for(const action of ['authorize_recording','claim_start']){
 const f=await run({hold:action});assert.match(f.text,/<Hangup/);assert(!f.events.some(x=>x.name==='start'));assert.equal(f.diagnostics[0].payload.reason,'admission_changed');
}
const lost=await run({fail:'claim_start'});assert.equal(lost.diagnostics[0].payload.stage,'recording_claim');assert.equal(lost.diagnostics[0].payload.reason,'deadline_exceeded');assert(!lost.events.some(x=>x.name==='start'));
const changed=await run({changeReview:true});assert.match(changed.text,/<Hangup/);assert(!changed.events.some(x=>['authorize_recording','claim_start','start','register'].includes(x.name)));assert.equal(changed.diagnostics[0].payload.reason,'review_or_call_window_invalid');
for(const options of [{slow:'agent'},{disconnect:7000}]){const f=await run(options);assert.match(f.text,/<Hangup/);assert(!f.events.some(x=>x.name==='register'));assert(f.events.some(x=>x.name==='end'));}
for(const options of [{badSignature:true},{foreignCall:true}]){const f=await run(options);assert(!f.events.some(x=>['call','agent','start','register','end'].includes(x.name)));}
const optOut=await run({optOut:true});assert(optOut.events.some(x=>x.name==='contact_opt_out'));assert(!optOut.events.some(x=>['agent','tool_contract','tool_stop','start','register'].includes(x.name)));
const unknown=await run({fail:'start'});assert.equal(unknown.events.filter(x=>x.name==='start').length,1);assert(!unknown.events.some(x=>x.name==='register'));assert(unknown.events.some(x=>x.name==='start_unknown'));assert.equal(unknown.diagnostics[0].payload.stage,'recording_start');
console.log('PASS actual callback deadline: concurrent fresh checks connect in 9 simulated seconds; the same serial checks exhaust 12 seconds. Identity, review, opt-out, changed admission, disconnect, unknown start and private diagnostics remain enforced.');
