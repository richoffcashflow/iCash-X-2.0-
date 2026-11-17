import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {carrierAnswerDisposition,carrierAnswerPolicy} from '../lib/call-answer-detection.ts';
import {recordingService} from '../lib/required-call-recording-service.ts';
import {createRecordingProviders} from '../lib/required-call-recording-provider.ts';
import {recordingPolicy,recordingPricing,recordingBaseUrl,canonical,sha} from '../lib/required-call-recording.ts';
const now=Date.now(),iso=new Date(now).toISOString(),ac='AC'+'a'.repeat(32),ca='CA'+'b'.repeat(32),re='RE'+'c'.repeat(32),id='11111111-1111-4111-8111-111111111111',account='22222222-2222-4222-8222-222222222222',op='voice:33333333-3333-4333-8333-333333333333',nonce='d'.repeat(64),token='e'.repeat(64);
const agent={agent_id:'agent_fixture',branch_id:'agtbrch_recorded',main_branch_id:'agtbrch_main',version_id:'agtvrsn_reviewed',conversation_config:{asr:{user_input_audio_format:'ulaw_8000'},tts:{agent_output_audio_format:'ulaw_8000'},conversation:{max_duration_seconds:600},agent:{prompt:{tool_ids:['tool_callback','tool_handoff','tool_stop']}}},platform_settings:{privacy:{record_voice:false},auth:{enable_auth:true},call_limits:{bursting_enabled:false},queueing_config:{enabled:false},overrides:{conversation_config_override:{conversation:{max_duration_seconds:true},agent:{first_message:true,prompt:{prompt:true}},tts:{voice_id:true}}}}};
const review={enabled:true,reviewedAt:new Date(now-1000).toISOString(),reviewedUntil:new Date(now+3600000).toISOString(),agentId:agent.agent_id,branchId:agent.branch_id,versionId:agent.version_id,configHash:sha(JSON.stringify(canonical({conversation_config:agent.conversation_config,platform_settings:agent.platform_settings,workflow:null,procedures:null}))),fromPhone:'+12125550101',providerAccountSid:ac,stopToolId:'tool_stop',toolIds:['tool_callback','tool_handoff','tool_stop'],approvedHoldCents:977,retentionDays:30,maxTotalSeconds:600,policyVersion:recordingPolicy.version};
const env={ICASH_RECORDED_OUTBOUND_READY:'true',RECORDED_OUTBOUND_REVIEW_JSON:JSON.stringify(review),TWILIO_ACCOUNT_SID:ac,TWILIO_AUTH_TOKEN:'synthetic-only-provider-token',ELEVENLABS_API_KEY:'synthetic-only-eleven-key'};
const tool={id:'tool_stop',tool_config:{type:'webhook',name:'icash_stop_recording',api_schema:{url:recordingBaseUrl+'/stop',method:'POST',request_headers:{Authorization:{variable_name:'secret__icash_recording_stop_token'}},request_body_schema:{type:'object',required:['recordingId'],properties:{recordingId:{type:'string',dynamic_variable:'icash_recording_id'}}}}}};

async function run(answer,options={}){
 const effects=[],writes=[],diagnostics=[];
 const row={entry_policy:'direct_recorded_v1',party:'seller',id,account_id:account,operation_key:op,provider_account_sid:ac,call_sid:ca,recording_sid:null,conversation_id:null,state:'consent_pending',nonce_hash:sha(nonce),stop_token_hash:sha(token),disclosure_version:recordingPolicy.disclosureVersion,consent_at:null,recording_authorized_at:null,start_claimed_at:null,provider_started_at:null,pricing_policy:recordingPricing,to_phone:'+12125550102',from_phone:review.fromPhone,agent_id:review.agentId,branch_id:review.branchId,version_id:review.versionId,max_total_seconds:600,created_at:iso,call_context:{...(options.legacy?{}:{answerPolicy:carrierAnswerPolicy})}};
 if(options.policy!==undefined)row.call_context.answerPolicy=options.policy;
 if(options.rowState)row.state=options.rowState;
 const db=async(path,method,body)=>{
  if(path.startsWith('icash_call_recordings?'))return [structuredClone(row)];
  assert.equal(path,'rpc/icash_transition_call_recording');
  assert.equal(body.p_id,id);assert.equal(body.p_account,account);assert.equal(body.p_operation,op);
  writes.push(body.p_action);
  if(options.writeFailure===body.p_action)throw Error('synthetic database failure');
  if(body.p_expected_state!==row.state)return null;
  switch(body.p_action){
   case 'fail':row.state='failed';row.last_error=body.p_payload.reason;break;
   case 'authorize_recording':row.recording_authorized_at=iso;break;
   case 'claim_start':assert(row.recording_authorized_at);row.start_claimed_at=iso;row.state='starting';break;
   case 'started':row.recording_sid=re;row.provider_started_at=iso;row.state='recording';break;
   case 'contact_opt_out':case 'decline':row.state='declined';break;
   default:assert.fail(body.p_action);
  }
  return structuredClone(row);
 };
 const provider={getCall:async()=>({sid:ca,account_sid:ac,from:options.foreignFrom?'+12125550999':row.from_phone,to:row.to_phone,direction:'outbound-api',status:'in-progress',date_created:iso,start_time:new Date(now-(options.callAgeSeconds??0)*1000).toISOString(),answered_by:options.canonicalMissing?null:options.canonicalEmpty?'':answer}),agent:async()=>{if(options.agentFailure)throw Error('provider read failed');return agent;},tool:async()=>tool,
  start:async()=>{effects.push('start');return {sid:re,account_sid:ac,call_sid:ca,status:'in-progress',start_time:iso};},
  register:async(_row,seconds)=>{assert.equal(seconds,600-(options.callAgeSeconds??0));effects.push('register');return '<Response><Connect><Stream url="wss://api.elevenlabs.io/fixture"/></Connect></Response>';},
  end:async sid=>{assert.equal(sid,ca);effects.push('end');if(options.endFailure)throw Error('provider end failed');return {sid:ca,account_sid:ac,status:'completed'};},
 };
 const url=recordingBaseUrl+'/connect?id='+id+'&nonce='+nonce;
 const form=new URLSearchParams({AccountSid:ac,CallSid:options.foreignCall?'CA'+'f'.repeat(32):ca,...((options.formAnswer??answer)!==undefined?{AnsweredBy:String(options.formAnswer??answer)}:{}),...(options.optOut?{SpeechResult:'stop calling me',Confidence:'.99'}:{})});
 const sig=createHmac('sha1',env.TWILIO_AUTH_TOKEN).update(url+[...form.keys()].sort().map(k=>k+form.get(k)).join('')).digest('base64');
 const request=new Request(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':options.badSignature?'bad':sig},body:form});
 const warn=console.warn;console.warn=(name,data)=>diagnostics.push({name,data});
 try{return {text:await (await recordingService(env,{db,provider,now:()=>now}).consent(request,false,true)).text(),effects,writes,row,diagnostics};}finally{console.warn=warn;}
}
for(const answer of ['machine','machine_start','machine_end_beep','machine_end_silence','machine_end_other','fax']){
 assert.equal(carrierAnswerDisposition(answer),'machine');
 const f=await run(answer);assert.match(f.text,/<Hangup/);assert.deepEqual(f.effects,['end']);assert.deepEqual(f.writes,['fail']);
 assert.equal(f.row.last_error,answer==='fax'?'carrier_fax_detected':'carrier_machine_detected');assert.equal(f.row.start_claimed_at,null);assert.equal(f.row.recording_sid,null);
 assert(!f.text.includes('<Say'));assert(!f.text.includes('<Connect'));
}
for(const answer of ['human','unknown']){
 const f=await run(answer);assert.match(f.text,/<Connect/);assert.deepEqual(f.effects,['start','register']);assert.equal(f.row.state,'recording');
}
for(const answer of [undefined,null,'','machine_unrecognized',{},'Human']){
 const f=await run(answer);assert.deepEqual(f.effects,['end']);assert.equal(f.row.last_error,'carrier_answer_unconfirmed');
}
// Canonical carrier identity and value, not claimed URL/form data, determine cutoff.
assert.deepEqual((await run('machine',{formAnswer:'human'})).effects,['end']);
assert.deepEqual((await run('human',{formAnswer:'machine'})).effects,['end']);
assert.deepEqual((await run('human',{canonicalMissing:true})).effects,['start','register']);
for(const answer of ['human','unknown'])assert.deepEqual((await run(answer,{canonicalEmpty:true})).effects,['start','register']);
assert.deepEqual((await run('machine',{canonicalMissing:true})).effects,['end']);
for(const options of [{badSignature:true},{foreignCall:true},{foreignFrom:true}]){
 const f=await run('machine',options);assert.match(f.text,/<Hangup/);assert.deepEqual(f.effects,[]);assert.deepEqual(f.writes,[]);
}
for(const options of [{writeFailure:'fail'},{agentFailure:true},{endFailure:true}]){
 const f=await run('machine',options);assert.match(f.text,/<Hangup/);assert.deepEqual(f.effects,['end']);assert(!f.writes.includes('claim_start'));
}
assert.deepEqual((await run('machine',{optOut:true})).writes,['contact_opt_out']);
assert.deepEqual((await run(undefined,{legacy:true})).effects,['start','register']);
assert.equal((await run('human',{policy:'unreviewed'})).row.last_error,'carrier_answer_unconfirmed');
for(const answer of ['human','unknown']){
 const delayed=await run(answer,{callAgeSeconds:46});assert.deepEqual(delayed.effects,['end']);assert(delayed.writes.includes('decline'));
 assert.deepEqual((await run(answer,{callAgeSeconds:7})).effects,['start','register']);
}
const replay=await run('machine',{rowState:'failed'});assert.deepEqual(replay.effects,['end']);assert.deepEqual(replay.writes,[]);
const network=[];
const wire=createRecordingProviders(env,async(url,init)=>{network.push({url,init});return Response.json({sid:ca});});
await wire.dial(review.fromPhone,'+12125550102','<Response/>','https://www.geticashx.com/fixture',600,carrierAnswerPolicy,recordingBaseUrl+'/connect?id='+id+'&nonce='+nonce);
const body=new URLSearchParams(network[0].init.body);
assert.equal(body.get('MachineDetection'),'Enable');assert.equal(body.get('AsyncAmd'),'false');assert.equal(body.get('MachineDetectionTimeout'),'8');
assert.equal(body.get('Twiml'),null);assert.equal(body.get('Url'),recordingBaseUrl+'/connect?id='+id+'&nonce='+nonce);assert.equal(body.get('Method'),'POST');
assert.equal(body.get('Record'),'false');assert.equal(body.get('TimeLimit'),'600');assert.equal(body.get('Timeout'),'20');
await wire.dial(review.fromPhone,'+12125550102','<Response/>','https://www.geticashx.com/fixture',600);
assert.equal(new URLSearchParams(network[1].init.body).has('MachineDetection'),false);
assert.throws(()=>wire.dial(review.fromPhone,'+12125550102','<Response/>','https://www.geticashx.com/fixture',600,'bad'),/CALL_ANSWER_POLICY_REQUIRED/);
for(const url of [undefined,'https://evil.invalid/connect?id='+id+'&nonce='+nonce,recordingBaseUrl+'/connect?id='+id+'&nonce='+nonce+'&extra=1']){
 assert.throws(()=>wire.dial(review.fromPhone,'+12125550102','<Response/>','https://www.geticashx.com/fixture',600,carrierAnswerPolicy,url),/CALL_ANSWER_URL_REQUIRED/);
}
assert.equal(network.length,2);
console.log('PASS carrier answer cutoff: canonical machine/fax ends without AI/recording; human/unknown and legacy continue; exact auth, failed writes/end, opt-out priority and synchronous bounded dial preserved.');
// Dispatch persists the exact policy before the one-use provider dial and carries
// it from the returned immutable row, not from mutable account settings.
{
 let saved,createBody;const effects=[];
 const db=async(path,method,body)=>{
  if(path==='rpc/icash_create_direct_recorded_call'){
   createBody=body;assert.equal(body.p_context.callContext.answerPolicy,carrierAnswerPolicy);
   saved={id,account_id:account,operation_key:op,provider_account_sid:ac,call_sid:null,from_phone:review.fromPhone,to_phone:'+12125550102',created_at:iso,state:'consent_pending',max_total_seconds:600,call_context:body.p_context.callContext};return structuredClone(saved);
  }
  assert.equal(path,'rpc/icash_transition_call_recording');
  if(body.p_action==='claim_dial'){effects.push('claim');saved.dial_claimed_at=iso;}
  else if(body.p_action==='bind_call'){effects.push('bind');saved.call_sid=body.p_payload.callSid;}
  else assert.fail(body.p_action);
  return structuredClone(saved);
 };
 const provider={agent:async()=>agent,tool:async()=>tool,dial:async(from,to,twiml,statusCallback,seconds,policy,answerUrl)=>{
  effects.push('dial');assert.deepEqual(effects,['claim','dial']);assert.equal(policy,carrierAnswerPolicy);assert.equal(seconds,600);assert.match(answerUrl,new RegExp('^'+recordingBaseUrl+'/connect\\?id='+id+'&nonce=[a-f0-9]{64}$'));
  assert.match(twiml,/<Redirect method="POST">/);assert.match(statusCallback,/\/terminal\?id=/);
  return {sid:ca,account_sid:ac,from,to,direction:'outbound-api',date_created:iso};
 }};
 const result=await recordingService(env,{db,provider,now:()=>now}).dispatch({accountId:account,operationKey:op,principal:'Fixture',assistantName:'Alex',firstMessage:'Hi',prompt:'Synthetic',strategyKey:'cash_interest'});
 assert.equal(result.status,'recording_consent_pending');assert(createBody);assert.deepEqual(effects,['claim','dial','bind']);
}
