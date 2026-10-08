import {directRecordedInstructions,recordingAuthorized} from '../lib/direct-call-entry.ts';
// LOCAL SYNTHETIC TESTS ONLY: every RPC/provider operation is an in-memory fixture.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {receptionTarget, receptionGreeting, receptionPrompt, rejectTwiml} from '../lib/general-reception.ts';
import {sha, affirmativeUtterances} from '../lib/required-call-recording.ts';
import {recordedReceptionPolicy, recordedReceptionUrl, recordedReceptionStopInstruction, validRecordedReceptionConfig, inspectRecordedReceptionAgent, recordedReceptionToolMatches, receptionCallerHash, receptionStopToken, receptionConsentTwiml, receptionConversationMatches, receptionAudioAvailable, receptionRecordingCosts} from '../lib/recorded-reception.ts';
import {recordedReceptionService} from '../lib/recorded-reception-service.ts';
import {createRecordedReceptionProviders} from '../lib/recorded-reception-provider.ts';

const now = Date.parse('2026-10-03T06:00:00.000Z'), iso = new Date(now).toISOString();
const accountSid = 'AC' + 'a'.repeat(32), callSid = 'CA' + 'b'.repeat(32), recordingSid = 'RE' + 'c'.repeat(32);
const id = '11111111-1111-4111-8111-111111111111', configId = '22222222-2222-4222-8222-222222222222', rateId = '33333333-3333-4333-8333-333333333333', foreignAccount = '44444444-4444-4444-8444-444444444444';
const caller = '+12125550199', operation = 'recorded-reception:' + callSid;
const env = {ICASH_RECORDED_RECEPTION_READY:'true', TWILIO_ACCOUNT_SID:accountSid, TWILIO_AUTH_TOKEN:'synthetic-only-twilio-token-not-live', ELEVENLABS_API_KEY:'synthetic-only-eleven-key-not-live'};
const clone = value => structuredClone(value);
const providerWrites = f => f.events.filter(e => ['boundCall','start','register','stop','end','deleteRecording'].includes(e.provider));
const streamXml = '<Response><Connect><Stream url="wss://api.us.elevenlabs.io/fixture"/></Connect></Response>';
// A missing dependency must never silently become a real network call.
globalThis.fetch = async () => { throw Error('UNEXPECTED_EXTERNAL_NETWORK_IN_SYNTHETIC_TEST'); };

function configuration(profile='normal') {
  const c = {id:configId, account_id:receptionTarget.accountId, owner_user_id:receptionTarget.ownerUserId, called_number:receptionTarget.calledNumber, agent_id:receptionTarget.agentId, branch_id:'agtbrch_recordedfixture', reviewed_version_id:'agtvrsn_recordedfixture', config_hash:'', enabled:true, funding_mode:'customer_credits', receipt_mode:'provider_readback', call_profile:profile, max_duration_seconds:profile==='normal'?600:60, customer_charge_cap_cents:profile==='normal'?479:96, rate_id:rateId, provider_account_sid:accountSid, stop_tool_id:'tool_stopfixture', approved_at:new Date(now-1000).toISOString(), reviewed_until:new Date(now+3600000).toISOString(), policy_version:recordedReceptionPolicy, pricing_policy:{version:recordedReceptionPolicy,retentionDays:30,recordingMicrosPerMinute:2500,storageMicrosPerMinuteMonth:500,speechGatherMicros:20000,streamMicrosPerMinute:4400,estimate:true}, disclosure_version:'required-audio-30d-speech-2026-10-03', context_policy:'message_only'};
  if (profile==='owner_quick_test') Object.assign(c, {owner_quick_test_enabled:true, owner_quick_test_approval_reference:'explicit-synthetic-owner-test-approval', owner_caller_hash:receptionCallerHash(caller, env)});
  const agent = {agent_id:c.agent_id, branch_id:c.branch_id, main_branch_id:'agtbrch_mainfixture', version_id:c.reviewed_version_id, conversation_config:{agent:{first_message:receptionGreeting, prompt:{prompt:receptionPrompt+recordedReceptionStopInstruction, max_tokens:120, tools:[], tool_ids:[c.stop_tool_id], mcp_server_ids:[], knowledge_base:[]}}, asr:{user_input_audio_format:'ulaw_8000'}, tts:{agent_output_audio_format:'ulaw_8000'}, conversation:{max_duration_seconds:c.max_duration_seconds}}, platform_settings:{workspace_overrides:{webhooks:{post_call_webhook_id:null, events:[], send_audio:false}}, auth:{enable_auth:true}, privacy:{record_voice:false}, call_limits:{agent_concurrency_limit:1, bursting_enabled:false}, queueing_config:{enabled:false}, overrides:{enable_conversation_initiation_client_data_from_webhook:false, conversation_config_override:{conversation:{max_duration_seconds:true}}}}};
  const branch = {id:c.branch_id, agent_id:c.agent_id, is_archived:false, current_live_percentage:0, draft_exists:false};
  const tool = {id:c.stop_tool_id, tool_config:{type:'webhook', name:'icash_stop_reception_recording', api_schema:{url:recordedReceptionUrl+'/stop', method:'POST', request_headers:{Authorization:{variable_name:'secret__icash_reception_stop_token'}}, request_body_schema:{type:'object', required:['recordingId'], properties:{recordingId:{type:'string',dynamic_variable:'icash_reception_recording_id'}}}}}};
  c.config_hash = inspectRecordedReceptionAgent(c,agent,branch,true).hash;
  return {c,agent,branch,tool};
}
function signed(path, fields={}, options={}) {
  const url = options.url ?? recordedReceptionUrl + '/' + path;
  const body = fields instanceof URLSearchParams ? fields : new URLSearchParams({AccountSid:accountSid,CallSid:callSid,...fields});
  const sig = createHmac('sha1',env.TWILIO_AUTH_TOKEN).update((options.signedUrl??url)+[...body.keys()].sort().map(k=>k+body.get(k)).join('')).digest('base64');
  return new Request(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':options.signature??sig,...options.headers},body});
}
const inboundRequest = (fields={}, options={}) => signed('inbound',{To:receptionTarget.calledNumber,From:caller,Direction:'inbound',CallStatus:'ringing',...fields},options);

function fixture(options={}) {
  const cfg=configuration(options.profile), events=[];
  if(options.direct){cfg.c.entry_policy='direct_recorded_v1';cfg.agent.conversation_config.agent.prompt.prompt=receptionPrompt+directRecordedInstructions;cfg.c.config_hash=inspectRecordedReceptionAgent(cfg.c,cfg.agent,cfg.branch,true).hash;}
  options.mutate?.(cfg);
  let row=null, nonce=null, clock=now, canonicalCall={sid:callSid,account_sid:accountSid,from:caller,to:receptionTarget.calledNumber,direction:'inbound',status:'ringing',date_created:iso,start_time:iso,...options.call};
  const snapshot = () => row ? clone(row) : null;
  const rpc = async (name,body={}) => {
    events.push({rpc:name,body:clone(body)});
    if (name==='icash_call_credit_available') return !options.emptyCredits;
    if (name==='icash_get_recorded_reception_config') return options.missingConfig?null:clone(cfg.c);
    if (name==='icash_get_recorded_reception_session') return row && body.p_id===row.id && (!body.p_account || body.p_account===row.account_id) ? snapshot() : null;
    if (name==='icash_reserve_flexible_reception'||name==='icash_reserve_direct_reception') {
      if (row || options.denied) return {allowed:false};
      row={id, entry_policy:options.direct?'direct_recorded_v1':'spoken_v1',recording_authorized_at:null, account_id:cfg.c.account_id, config_id:cfg.c.id, configuration:clone(cfg.c), operation_key:operation, provider_account_sid:accountSid, call_sid:callSid, from_phone:caller, to_phone:cfg.c.called_number, caller_hash:body.p_caller_hash, nonce_hash:body.p_nonce_hash, stop_token_hash:body.p_stop_token_hash, state:'reserved', row_version:1, agent_id:cfg.c.agent_id, branch_id:cfg.c.branch_id, version_id:cfg.c.reviewed_version_id, max_total_seconds:cfg.c.max_duration_seconds, rate_id:cfg.c.rate_id, charge_cap_cents:cfg.c.customer_charge_cap_cents, pricing_policy:clone(cfg.c.pricing_policy), created_at:iso, call_started_at:null, call_deadline_at:new Date(now+60000).toISOString(), consent_deadline_at:new Date(now+45000).toISOString(), consent_at:null, setup_claimed_at:null, bounded_at:null, setup_confirmed_at:null, start_claimed_at:null, register_claimed_at:null, recording_sid:null, provider_started_at:null, ended_at:null, duration_seconds:null, audio_expires_at:null, deleted_at:null, conversation_id:null, end_requested_at:null, call_ended_at:null, provider_recording_price_micros:null, ...options.badRow};
      return {allowed:true,session:snapshot()};
    }
    if (name==='icash_recorded_reception_property_context') return options.propertyContext??null;
    if (name!=='icash_transition_recorded_reception') throw Error('UNEXPECTED_RPC '+name);
    assert(row);
    assert.equal(body.p_id,row.id); assert.equal(body.p_account,row.account_id); assert.equal(body.p_operation,row.operation_key);
    if(body.p_expected_version!==row.row_version || options.rejectTransition===body.p_action) return null;
    const payload=body.p_payload, action=body.p_action;
    if (action==='claim_setup') {if(row.setup_claimed_at) return null; row.setup_claimed_at=iso;row.state='setup_pending';}
    else if (action==='bounded') {assert(row.setup_claimed_at);assert.equal(payload.timeLimitSeconds,row.max_total_seconds);row.bounded_at=iso;row.setup_confirmed_at=iso;row.state='consent_pending';}
    else if (action==='bind_call_start') {if(row.call_started_at)return null;row.call_started_at=payload.callStartedAt;row.call_deadline_at=new Date(Date.parse(payload.callStartedAt)+row.max_total_seconds*1000).toISOString();row.consent_deadline_at=new Date(Date.parse(payload.callStartedAt)+45000).toISOString();}
    else if (action==='authorize_recording'){if(row.recording_authorized_at||row.entry_policy!=='direct_recorded_v1')return null;assert.equal(payload.nonceHash,row.nonce_hash);row.recording_authorized_at=iso;}
    else if (action==='consent') {if(row.consent_at||row.state!=='consent_pending') return null;assert.equal(payload.nonceHash,row.nonce_hash);row.consent_at=iso;row.consent_evidence=clone(payload);}
    else if (action==='claim_start') {if(!recordingAuthorized(row)||row.start_claimed_at||row.end_requested_at)return null;row.start_claimed_at=iso;row.state='starting';}
    else if (action==='started') {if(row.recording_sid||row.end_requested_at)return null;assert(row.start_claimed_at);row.recording_sid=payload.recordingSid;row.provider_started_at=payload.providerStartedAt;row.audio_expires_at=new Date(now+30*86400000).toISOString();row.state='recording';}
    else if (action==='claim_register') {if(row.register_claimed_at||!row.recording_sid||row.end_requested_at)return null;row.register_claimed_at=iso;}
    else if (action==='decline') row.state='declined';
    else if (action==='stop' || action==='request_end') {if(action==='stop')assert.equal(payload.stopTokenHash,row.stop_token_hash);row.end_requested_at??=iso;row.state='stopping';}
    else if (action==='call_ended') {assert.equal(payload.callSid,row.call_sid);assert.equal(payload.direction,'inbound');assert.equal(payload.toPhone,row.to_phone);assert.equal(payload.fromPhone,row.from_phone);row.call_ended_at=iso;}
    else if (action==='available') {row.state='available';row.ended_at=payload.endedAt;row.duration_seconds=payload.durationSeconds;row.provider_recording_price_micros=payload.providerRecordingPriceMicros??null;}
    else if (action==='absent') row.state='absent';
    else if (!['setup_unknown','start_unknown','register_unknown'].includes(action)) throw Error('UNEXPECTED_TRANSITION '+action);
    row.row_version++; return snapshot();
  };
  let service;
  const p = {
    getCall:async sid => {events.push({provider:'getCall'});assert.equal(sid,callSid);return clone(canonicalCall);},
    agent:async()=>{events.push({provider:'agent'});return clone(cfg.agent);},
    branches:async()=>{events.push({provider:'branches'});return options.branches??{results:[clone(cfg.branch)],meta:{total:1}};},
    workspace:async()=>{events.push({provider:'workspace'});return options.workspace??{webhooks:{post_call_webhook_id:null}};},
    tool:async()=>{events.push({provider:'tool'});return clone(cfg.tool);},
    boundCall:async r=>{events.push({provider:'boundCall',seconds:r.max_total_seconds});assert(row.setup_claimed_at);assert.equal(canonicalCall.status,'in-progress','carrier cannot update a ringing call');if(options.boundThrows)throw Error('synthetic-write-unknown');return clone({...canonicalCall,...options.boundReceipt});},
    start:async(sid,callback)=>{events.push({provider:'start',callback});assert.equal(sid,callSid);assert(row.bounded_at);assert(recordingAuthorized(row));assert(row.start_claimed_at);assert.equal(row.register_claimed_at,null);if(options.startThrows)throw Error('synthetic-write-unknown');if(options.startCallback){const response=await service.status(signed('status?id='+id,{RecordingSid:recordingSid,RecordingStatus:'in-progress'}));assert.equal(response.status,204);}return {sid:recordingSid,call_sid:callSid,account_sid:accountSid,status:'in-progress',start_time:iso,...options.startReceipt};},
    register:async(r,seconds,context)=>{events.push({provider:'register',seconds,context});assert(recordingAuthorized(r));assert(r.start_claimed_at);assert(r.recording_sid);assert(r.register_claimed_at);assert.equal(r.state,'recording');if(options.registerThrows)throw Error('synthetic-write-unknown');return streamXml;},
    end:async sid=>{events.push({provider:'end'});assert.equal(sid,callSid);if(options.endThrows)throw Error('synthetic-write-unknown');canonicalCall.status='completed';return {sid:callSid,account_sid:accountSid,status:'completed',...options.endReceipt};},
    stop:async(sid,re)=>{events.push({provider:'stop'});assert.equal(sid,callSid);assert.equal(re,recordingSid);if(options.stopThrows)throw Error('synthetic-write-unknown');return {sid:recordingSid,call_sid:callSid,account_sid:accountSid,status:'stopped',...options.stopReceipt};},
    getRecording:async sid=>{events.push({provider:'getRecording'});assert.equal(sid,recordingSid);return {sid:recordingSid,call_sid:callSid,account_sid:accountSid,status:'in-progress',start_time:iso,...options.recordingReceipt};},
    media:async sid=>{events.push({provider:'media'});assert.equal(sid,recordingSid);if(options.expireDuringMedia)clock=Date.parse(row.audio_expires_at);return Buffer.from('synthetic-audio');},
  };
  service=recordedReceptionService({...env,...options.env},{rpc,provider:p,now:()=>clock});
  const f={...cfg, events, rpc, provider:p, service, get row(){return row;}, get nonce(){return nonce;}, setNow:ms=>{clock=ms;}, setCall:values=>Object.assign(canonicalCall,values),
    async answer(request=inboundRequest()){const response=await service.inbound(request);const text=await response.text();const match=/nonce=([a-f0-9]{64})/.exec(text);if(match)nonce=match[1];return {response,text};},
    setup(fields={CallStatus:'in-progress'},options={}){return service.setup(signed('setup?id='+id+'&nonce='+nonce,fields,options));},
    async admit(){const answer=await this.answer();if(!answer.text.includes('<Redirect'))return answer;canonicalCall.status='in-progress';const response=await this.setup();return {response,text:answer.text+await response.text()};},
    consent(fields={SpeechResult:'yes',Confidence:'.99'},options={}){return service.consent(signed('consent?id='+id+'&nonce='+nonce,fields,options));},
    async ready(){const result=await this.admit();assert.match(result.text,/<Gather /);canonicalCall.status='in-progress';return this;},
    stopRequest(token=receptionStopToken({operation_key:operation},env),body={recordingId:id}){return new Request(recordedReceptionUrl+'/stop',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});},
  };
  return f;
}

// node:test keeps independent failures visible instead of aborting at the first one.
test('default off performs zero RPC or provider operations',async()=>{
  for(const value of [undefined,'false','TRUE','1']){const f=fixture({env:{ICASH_RECORDED_RECEPTION_READY:value}});assert.equal((await f.admit()).text,rejectTwiml);assert.deepEqual(f.events,[]);}
});
test('the installed incoming carrier URL preserves signature, funding and recording consent checks',async()=>{
  const legacyUrl='https://www.geticashx.com/api/reception/inbound';
  const good=fixture();
  const answer=await good.answer(inboundRequest({}, {url:legacyUrl}));
  assert.match(answer.text,/<Play>/);assert.match(answer.text,/<Redirect /);assert.equal(providerWrites(good).length,0);
  good.setCall({status:'in-progress'});assert.match(await(await good.setup()).text(),/<Gather /);
  assert.deepEqual(providerWrites(good).map(e=>e.provider),['boundCall']);
  for(const options of [{signedUrl:recordedReceptionUrl+'/inbound'},{signedUrl:'https://other.invalid/api/reception/inbound'},{url:legacyUrl+'?extra=1'}]){
    const f=fixture();assert.equal(await(await f.service.inbound(inboundRequest({}, {url:legacyUrl,...options}))).text(),rejectTwiml);assert.deepEqual(f.events,[]);
  }
  const denied=fixture({denied:true});assert.equal(await(await denied.service.inbound(inboundRequest({}, {url:legacyUrl}))).text(),rejectTwiml);assert.equal(providerWrites(denied).length,0);
});
test('invalid signature, duplicate keys, method/content type, target/account/direction are rejected before reads',async()=>{
  const requests=[inboundRequest({}, {signature:'forged'}),inboundRequest({To:'+12125550999'}),inboundRequest({From:'<xml>'}),inboundRequest({AccountSid:'AC'+'d'.repeat(32)}),inboundRequest({Direction:'outbound-api'}),inboundRequest({CallStatus:'completed'}),inboundRequest({CallSid:'invalid'}),inboundRequest({}, {url:recordedReceptionUrl+'/inbound?extra=1'}),inboundRequest({}, {headers:{'content-type':'application/json'}}),inboundRequest({}, {signedUrl:'https://other.invalid/api/reception/recorded/inbound'}),new Request(recordedReceptionUrl+'/inbound')];
  const duplicates=new URLSearchParams({AccountSid:accountSid,CallSid:callSid,To:receptionTarget.calledNumber,From:caller,Direction:'inbound',CallStatus:'ringing'});duplicates.append('To',receptionTarget.calledNumber);requests.push(signed('inbound',duplicates));
  for(const req of requests){const f=fixture();assert.equal(await(await f.service.inbound(req)).text(),rejectTwiml);assert.deepEqual(f.events,[]);}
});
test('authenticated canonical incoming call must match every binding and be fresh',async()=>{
  for(const call of [{sid:'CA'+'d'.repeat(32)},{account_sid:'AC'+'d'.repeat(32)},{from:'+12125550999'},{to:'+12125550999'},{direction:'outbound-api'},{status:'completed'},{date_created:new Date(now-120001).toISOString()},{date_created:new Date(now+1).toISOString()},{date_created:'invalid'}]){const f=fixture({call});assert.equal((await f.admit()).text,rejectTwiml);assert.equal(providerWrites(f).length,0);assert(!f.events.some(e=>e.rpc==='icash_reserve_flexible_reception'));}
});
test('review/config failures cannot reserve or write provider state',async()=>{
  const changes=[c=>c.enabled=false,c=>c.account_id=foreignAccount,c=>c.owner_user_id=foreignAccount,c=>c.called_number='+12125550999',c=>c.agent_id='agent_foreignfixture',c=>c.provider_account_sid='AC'+'d'.repeat(32),c=>c.approved_at=new Date(now+1).toISOString(),c=>c.reviewed_until=new Date(now+1000).toISOString(),c=>c.policy_version='unknown',c=>c.max_duration_seconds=60,c=>c.funding_mode='business'];
  for(const change of changes){const f=fixture({mutate:({c})=>change(c)});assert.equal((await f.admit()).text,rejectTwiml);assert.equal(providerWrites(f).length,0);assert(!f.events.some(e=>e.rpc==='icash_reserve_flexible_reception'));}
});
test('only a reviewed stop tool is admitted; recording, transfer, MCP, alternate prompt and inherited exports fail closed',async()=>{
  const changes=[x=>x.agent.conversation_config.agent.prompt.tool_ids.push('tool_outboundfixture'),x=>x.agent.conversation_config.agent.prompt.prompt+=' Make an outbound call.',x=>x.agent.platform_settings.privacy.record_voice=true,x=>x.agent.conversation_config.agent.prompt.mcp_server_ids=['mcp_outboundfixture'],x=>x.agent.conversation_config.agent.prompt.built_in_tools={transfer_to_number:{type:'system',name:'transfer_to_number'}},x=>x.agent.conversation_config.agent.prompt.tools=[{type:'webhook',name:'send_email'}],x=>x.agent.platform_settings.workspace_overrides.webhooks.send_audio=true,x=>x.branch.current_live_percentage=1,x=>x.branch.draft_exists=true,x=>x.tool.tool_config.api_schema.url='https://other.invalid/stop',x=>x.tool.tool_config.api_schema.request_body_schema.properties.accountId={type:'string'},x=>x.tool.tool_config.api_schema.auth_connection='privileged'];
  for(const change of changes){const f=fixture({mutate:x=>{change(x);x.c.config_hash=inspectRecordedReceptionAgent(x.c,x.agent,x.branch,true).hash;}});assert.equal((await f.admit()).text,rejectTwiml);assert.equal(providerWrites(f).length,0);}
  for(const workspace of [{},{webhooks:{}},{webhooks:{post_call_webhook_id:'hook_foreignfixture'}}]){const f=fixture({workspace});assert.equal((await f.admit()).text,rejectTwiml);assert.equal(providerWrites(f).length,0);}
});
test('normal600 and explicitly approved owner60 each keep immutable funded tier and exact carrier cap',async()=>{
  for(const profile of ['normal','owner_quick_test']){const f=fixture({profile});assert(validRecordedReceptionConfig(f.c,now));await f.ready();assert.equal(f.row.max_total_seconds,profile==='normal'?600:60);assert.equal(f.row.charge_cap_cents,f.c.customer_charge_cap_cents);assert.deepEqual(providerWrites(f).map(e=>[e.provider,e.seconds]),[['boundCall',f.c.max_duration_seconds]]);const r=await f.consent();assert.match(await r.text(),/<Connect>/);assert.equal(providerWrites(f).find(e=>e.provider==='register').seconds,f.c.max_duration_seconds);}
  for(const mutate of [({c})=>c.owner_quick_test_enabled=false,({c})=>c.owner_quick_test_approval_reference='',({c})=>c.owner_caller_hash='0'.repeat(64)]){const f=fixture({profile:'owner_quick_test',mutate});assert.equal((await f.admit()).text,rejectTwiml);assert.equal(providerWrites(f).length,0);}
});
test('denied reservation never retries or fabricates a shorter funded call',async()=>{
  const f=fixture({denied:true});assert.equal((await f.admit()).text,rejectTwiml);const attempts=f.events.filter(e=>e.rpc==='icash_reserve_flexible_reception');assert.equal(attempts.length,1);assert.equal(attempts[0].body.p_config_id,configId);assert.equal(providerWrites(f).length,0);
});
test('spoken disclosure precedes listening; no recording or AI starts before speech consent',async()=>{
  const f=fixture();const {text}=await f.admit();assert(text.indexOf('</Play>')<text.indexOf('<Gather'));assert.match(text,/reception-v4-20261007\/notice.mp3/);assert.match(text,/reception-v4-20261007\/question.mp3/);assert(!text.includes('<Say'));assert.match(text,/input="speech"/);assert(!/<Record|<Connect|dtmf/.test(text));assert(text.includes(recordedReceptionUrl+'/consent'));assert.equal(f.row.state,'consent_pending');assert.deepEqual(providerWrites(f).map(e=>e.provider),['boundCall']);
  assert.equal(receptionConsentTwiml(id,'e'.repeat(64)).match(/<Gather/g).length,1);
});
test('replayed admission cannot repeat claimed provider bound/setup write',async()=>{
  const f=fixture();await f.ready();assert.equal((await f.admit()).text,rejectTwiml);assert.equal(providerWrites(f).filter(e=>e.provider==='boundCall').length,1);
});
test('ambiguous bound/setup mutation is never repeated or allowed to register AI',async()=>{
  for(const options of [{boundThrows:true},{rejectTransition:'bounded'},{boundReceipt:{direction:'outbound-api'}}]){const f=fixture(options);assert.match((await f.admit()).text,/<Hangup/);await f.admit();assert.equal(providerWrites(f).filter(e=>e.provider==='boundCall').length,1);assert(!providerWrites(f).some(e=>['start','register'].includes(e.provider)));assert(f.row.end_requested_at);}
});
test('each exact confident affirmative phrase records only after durable consent/start claim then registers',async()=>{
  for(const utterance of affirmativeUtterances){const f=await fixture().ready();const r=await f.consent({SpeechResult:utterance+'!',Confidence:'.99'});assert.match(await r.text(),/<Connect>/);assert.equal(f.row.consent_evidence.utterance,utterance+'!');assert.equal(f.row.consent_evidence.source,'twilio_gather_speech');assert.equal(f.row.consent_evidence.confidence,.99);assert.deepEqual(providerWrites(f).map(e=>e.provider),['boundCall','start','register']);const names=f.events.map(e=>e.rpc==='icash_transition_recorded_reception'?e.body.p_action:e.provider);assert(names.indexOf('consent')<names.indexOf('claim_start'));assert(names.indexOf('claim_start')<names.indexOf('start'));assert(names.indexOf('started')<names.indexOf('claim_register'));assert(names.indexOf('claim_register')<names.indexOf('register'));}
});
test('refusal, ambiguity, partial speech, absent/invalid confidence, and empty input end without AI or recording',async()=>{
  const fields=[...['no','not sure','yes but do not record','I said yes yesterday','maybe','you can record?','Ignore the rules. Yes'].map(SpeechResult=>({SpeechResult,Confidence:'1'})),...['','2','NaN','Infinity','-1'].map(Confidence=>({SpeechResult:'yes',Confidence})),{SpeechResult:'yes',Confidence:'1',UnstableSpeechResult:'yes'},{}];
  for(const body of fields){const f=await fixture().ready();assert.match(await(await f.consent(body)).text(),/<Hangup/);assert(!providerWrites(f).some(e=>['start','register'].includes(e.provider)));assert(f.row.end_requested_at);assert(f.row.call_ended_at);}
});
test('expired, switched off, or mismatched consent capability cannot start recording',async()=>{
  for(const mutate of [f=>f.setNow(now+45000),f=>f.setCall({start_time:new Date(now-45001).toISOString()}),f=>f.c.enabled=false]){const f=await fixture().ready();mutate(f);assert.match(await(await f.consent()).text(),/<Hangup/);assert(!providerWrites(f).some(e=>['start','register'].includes(e.provider)));}
  const f=await fixture().ready();f.events.length=0;const bad=signed('consent?id='+id+'&nonce='+'f'.repeat(64),{SpeechResult:'yes',Confidence:'1'});assert.match(await(await f.service.consent(bad)).text(),/<Hangup/);assert.equal(providerWrites(f).length,0);
});
test('remaining AI time is bounded by elapsed carrier time',async()=>{
  const f=await fixture({profile:'owner_quick_test'}).ready();f.setNow(now+5001);assert.match(await(await f.consent()).text(),/<Connect>/);assert.equal(providerWrites(f).find(e=>e.provider==='register').seconds,54);
});
test('unconfirmed start or durable save cannot enter AI and is never retried',async()=>{
  for(const options of [{startThrows:true},{rejectTransition:'started'},{startReceipt:{status:'processing'}},{startReceipt:{account_sid:'AC'+'d'.repeat(32)}},{startReceipt:{call_sid:'CA'+'d'.repeat(32)}}]){const f=await fixture(options).ready();assert.match(await(await f.consent()).text(),/<Hangup/);await f.consent();assert.equal(providerWrites(f).filter(e=>e.provider==='start').length,1);assert(!providerWrites(f).some(e=>e.provider==='register'));assert(f.row.end_requested_at);}
});
test('unconfirmed registration is attempted once and durably requests termination',async()=>{
  const f=await fixture({registerThrows:true}).ready();assert.match(await(await f.consent()).text(),/<Hangup/);await f.consent();assert.equal(providerWrites(f).filter(e=>e.provider==='start').length,1);assert.equal(providerWrites(f).filter(e=>e.provider==='register').length,1);assert(f.row.register_claimed_at);assert(f.row.end_requested_at);
});
test('concurrent consent callbacks have one durable start/registration winner',async()=>{
  const f=await fixture().ready();const results=await Promise.all([f.consent(),f.consent(),f.consent()]);for(const r of results)assert.match(await r.text(),/<Hangup|<Connect/);assert.equal(providerWrites(f).filter(e=>e.provider==='start').length,1);assert(providerWrites(f).filter(e=>e.provider==='register').length<=1);
});
test('authenticated start status racing the start response is adopted without duplicate start or registration',async()=>{
  const f=await fixture({startCallback:true}).ready();assert.match(await(await f.consent()).text(),/<Connect>/);assert.equal(providerWrites(f).filter(e=>e.provider==='start').length,1);assert.equal(providerWrites(f).filter(e=>e.provider==='register').length,1);assert.equal(f.row.recording_sid,recordingSid);
});
test('withdrawal stops partial audio but reports 503 unless call ending is confirmed, with durable end intent',async()=>{
  const f=await fixture({endThrows:true}).ready();await f.consent();const response=await f.service.stop(f.stopRequest());assert.equal(response.status,503);const body=await response.json();assert.equal(body.stopped,true);assert.equal(body.callEnded,false);assert(f.row.end_requested_at);assert.equal(f.row.call_ended_at,null);assert.match(body.instruction,/do not continue talking/i);assert.equal(providerWrites(f).filter(e=>e.provider==='stop').length,1);
});
test('confirmed withdrawal ends exactly the bound incoming call',async()=>{
  const f=await fixture().ready();await f.consent();const response=await f.service.stop(f.stopRequest());assert.equal(response.status,200);assert.equal((await response.json()).callEnded,true);assert(f.row.call_ended_at);assert(f.row.end_requested_at);
});
test('bad stop capabilities and cross-call/recording callbacks never mutate providers',async()=>{
  const f=await fixture().ready();await f.consent();
  for(const request of [f.stopRequest('f'.repeat(64)),f.stopRequest(undefined,{recordingId:foreignAccount}),f.stopRequest(undefined,{recordingId:id,accountId:foreignAccount})]){f.events.length=0;assert([400,401].includes((await f.service.stop(request)).status));assert.equal(providerWrites(f).length,0);}
  for(const fields of [{CallSid:'CA'+'d'.repeat(32),RecordingSid:recordingSid},{AccountSid:'AC'+'d'.repeat(32),RecordingSid:recordingSid},{RecordingSid:'RE'+'d'.repeat(32)}]){f.events.length=0;assert.equal((await f.service.status(signed('status?id='+id,fields))).status,401);assert.equal(providerWrites(f).length,0);assert(!f.events.some(e=>e.provider==='getRecording'));}
});
test('canonical recording callback rejects foreign account or call bindings despite a valid signature',async()=>{
  for(const recordingReceipt of [{call_sid:'CA'+'d'.repeat(32)},{account_sid:'AC'+'d'.repeat(32)}]){const f=await fixture({recordingReceipt}).ready();await f.consent();f.events.length=0;assert.equal((await f.service.status(signed('status?id='+id,{RecordingSid:recordingSid}))).status,409);assert.equal(providerWrites(f).length,0);}
});
test('recording absent callback ends the required-recording conversation',async()=>{
  const f=await fixture({recordingReceipt:{status:'absent'}}).ready();await f.consent();assert.equal((await f.service.status(signed('status?id='+id,{RecordingSid:recordingSid,RecordingStatus:'absent'}))).status,204);assert(f.row.end_requested_at);assert(f.row.call_ended_at);assert.equal(f.row.state,'absent');
});
test('terminal callback requires canonical incoming call receipt, not just a claimed terminal form field',async()=>{
  const f=await fixture().ready();assert.equal((await f.service.terminal(signed('terminal?id='+id,{CallStatus:'completed'}))).status,409);assert.equal(f.row.call_ended_at,null);f.setCall({status:'completed'});assert.equal((await f.service.terminal(signed('terminal?id='+id,{CallStatus:'completed'}))).status,204);assert(f.row.call_ended_at);
});
function makeAvailable(f){Object.assign(f.row,{call_started_at:iso,call_deadline_at:new Date(now+f.row.max_total_seconds*1000).toISOString(),state:'available',consent_at:iso,start_claimed_at:iso,recording_sid:recordingSid,provider_started_at:iso,conversation_id:'conv_recordedfixture',call_ended_at:iso,audio_expires_at:new Date(now+1000).toISOString(),duration_seconds:600});}
test('audio requires tenant, consent, started recording, exact conversation, call end, and unexpired media',async()=>{
  const f=await fixture().ready();makeAvailable(f);assert(receptionAudioAvailable(f.row,now));assert(!receptionAudioAvailable(f.row,now+1000));
  for(const mutation of [{state:'recording'},{consent_at:null},{start_claimed_at:null},{conversation_id:null},{call_ended_at:null},{deleted_at:iso},{audio_expires_at:iso}]){const saved=clone(f.row);Object.assign(f.row,mutation);f.events.length=0;assert.equal((await f.service.audio(f.row.account_id,id,null)).status,404);assert(!f.events.some(e=>e.provider==='media'));Object.assign(f.row,saved);}
  f.events.length=0;assert.equal((await f.service.audio(foreignAccount,id,null)).status,404);assert(!f.events.some(e=>e.provider==='media'));assert.equal(f.events[0].body.p_account,foreignAccount);
});
test('audio playback is private, range-bounded, and expires at the exact boundary',async()=>{
  const f=await fixture().ready();makeAvailable(f);let response=await f.service.audio(f.row.account_id,id,'bytes=0-3');assert.equal(response.status,206);assert.equal(await response.text(),'synt');assert.equal(response.headers.get('cache-control'),'private, no-store, max-age=0');assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(response.headers.get('content-range'),'bytes 0-3/15');
  for(const range of ['bytes=1-0','bytes=0-99','bytes=-5','bytes=0-1,3-4','items=0-2'])assert.equal((await f.service.audio(f.row.account_id,id,range)).status,416);
  f.setNow(now+1000);f.events.length=0;assert.equal((await f.service.audio(f.row.account_id,id,null)).status,404);assert(!f.events.some(e=>e.provider==='media'));
  const expires=await fixture({expireDuringMedia:true}).ready();makeAvailable(expires);assert.equal((await expires.service.audio(expires.row.account_id,id,null)).status,404);
});
test('provider conversation identity binds user, branch/version, incoming direction and both exact numbers',async()=>{
  const f=await fixture().ready();const row=f.row, user='icash-recorded-reception:'+id;
  const conversation={conversation_id:'conv_recordedfixture',agent_id:row.agent_id,branch_id:row.branch_id,version_id:row.version_id,user_id:user,conversation_initiation_client_data:{user_id:user,branch_id:row.branch_id,dynamic_variables:{icash_reception_recording_id:id}},metadata:{phone_call:{call_sid:callSid,direction:'inbound',external_number:caller,agent_number:row.to_phone}}};
  assert(receptionConversationMatches(row,conversation));
  for(const change of [c=>c.agent_id='agent_foreignfixture',c=>c.branch_id='agtbrch_foreignfixture',c=>c.version_id='agtvrsn_foreignfixture',c=>c.user_id='foreign',c=>c.conversation_initiation_client_data.user_id='foreign',c=>c.conversation_initiation_client_data.dynamic_variables.icash_reception_recording_id=foreignAccount,c=>c.metadata.phone_call.call_sid='CA'+'d'.repeat(32),c=>c.metadata.phone_call.direction='outbound',c=>c.metadata.phone_call.agent_number=caller,c=>c.metadata.phone_call.external_number=row.to_phone]){const bad=clone(conversation);change(bad);assert.equal(receptionConversationMatches(row,bad),false);}
});
test('recording/storage/speech add-ons remain estimates unless recording provider price is observed',async()=>{
  const f=await fixture().ready();makeAvailable(f);assert.deepEqual(receptionRecordingCosts(f.row),{recording:25000,storage:5358,speech:20000,total:50358,recordingObserved:false});f.row.provider_recording_price_micros=24000;assert.deepEqual(receptionRecordingCosts(f.row),{recording:24000,storage:5358,speech:20000,total:49358,recordingObserved:true});
  for(const duration of [null,-1,601,1.5,NaN]){f.row.duration_seconds=duration;assert.throws(()=>receptionRecordingCosts(f.row));}
});
test('recorded provider transport has no dial capability and binds carrier/AI direction and limits',async()=>{
  const f=await fixture().ready();await f.consent();const network=[];
  const provider=createRecordedReceptionProviders(env,async(url,init={})=>{network.push({url,init});return url.includes('register-call')?new Response(streamXml):Response.json({sid:callSid,account_sid:accountSid});});
  assert.equal(provider.dial,undefined);
  for(const max_total_seconds of [60,120,240,540,600]){await provider.boundCall({...f.row,max_total_seconds});const body=new URLSearchParams(network.at(-1).init.body);assert.equal(body.get('TimeLimit'),String(max_total_seconds));assert.equal(body.get('StatusCallback'),recordedReceptionUrl+'/terminal?id='+id);assert.equal(body.get('Record'),null);assert.equal(network.at(-1).init.redirect,'error');}
  await provider.register(f.row,587);const body=JSON.parse(network.at(-1).init.body);assert.equal(body.direction,'inbound');assert.equal(body.from_number,caller);assert.equal(body.to_number,receptionTarget.calledNumber);assert.equal(body.conversation_initiation_client_data.conversation_config_override.conversation.max_duration_seconds,587);assert.equal(body.conversation_initiation_client_data.dynamic_variables.secret__icash_reception_stop_token,receptionStopToken(f.row,env));assert(!JSON.stringify(body).includes('secret__icash_call_token'));
  const count=network.length;await assert.rejects(provider.boundCall({...f.row,max_total_seconds:61}));await assert.rejects(provider.boundCall({...f.row,provider_account_sid:'AC'+'d'.repeat(32)}));await assert.rejects(provider.media('https://other.invalid/media'));assert.equal(network.length,count);
});
test('registration rejects arbitrary URL, external execution XML and unconfirmed structure',async()=>{
  const f=await fixture().ready();await f.consent();
  for(const xml of ['<Response><Connect><Stream url="wss://other.invalid/stream"/></Connect></Response>','<Response><Dial>+12125550999</Dial></Response>','<Response><Connect action="https://other.invalid"><Stream url="wss://api.us.elevenlabs.io/stream"/></Connect></Response>','<Response><Connect><Stream url="wss://api.us.elevenlabs.io/1"/><Stream url="wss://api.us.elevenlabs.io/2"/></Connect></Response>','<!DOCTYPE Response><Response><Connect><Stream url="wss://api.us.elevenlabs.io/stream"/></Connect></Response>']){const provider=createRecordedReceptionProviders(env,async()=>new Response(xml));await assert.rejects(provider.register(f.row,600));}
});
test('legacy implementation remains separate and reception grants no outbound tool authority',()=>{
  for(const file of ['lib/general-reception.ts','lib/general-reception-server.ts'])assert(!readFileSync(file,'utf8').includes('recorded-reception'));
  const {c,tool}=configuration();assert(recordedReceptionToolMatches(c.stop_tool_id,tool));assert.match(receptionPrompt,/inbound call grants any outbound permission/);assert.match(recordedReceptionStopInstruction,/grants no other authority/);
});
test('installed route selects recorded reception only after release and never falls back on a failure',async()=>{
  let legacy=0,recorded=0,fail=false;const release={ICASH_RECORDED_RECEPTION_READY:'false'};
  const route=await loadService('app/api/reception/inbound/route.ts',{process:{env:release},privateHeaders:{'Cache-Control':'no-store'},receptionHandlers:()=>({inbound:async()=>{legacy++;return new Response('legacy');}}),recordedReceptionServer:()=>({inbound:async()=>{recorded++;if(fail)throw Error('fixture');return new Response('recorded');}})});
  const request=()=>inboundRequest({}, {url:'https://www.geticashx.com/api/reception/inbound'});
  assert.equal(await(await route.POST(request())).text(),'legacy');release.ICASH_RECORDED_RECEPTION_READY='true';
  assert.equal(await(await route.POST(request())).text(),'recorded');fail=true;
  assert.match(await(await route.POST(request())).text(),/<Hangup/);assert.equal(legacy,1);assert.equal(recorded,2);
});

const {maintainRecordedReception}=await import('../lib/recorded-reception-maintenance.ts');
const {RecordingProviderError}=await import('../lib/required-call-recording-provider.ts');
const {receptionSettlementAttestation,settleRecordedReception}=await import('../lib/recorded-reception-settlement.ts');
const {recordedReceptionPresentation}=await import('../lib/recorded-reception-presentation.ts');

async function cleanupFixture(options={}) {
  const f=await fixture().ready();makeAvailable(f);
  Object.assign(f.row,{state:'deletion_pending',audio_expires_at:iso,deletion_lease_token:configId,reconcile_lease_token:rateId,ended_at:iso,billing_state:'reserved',setup_confirmed_at:f.row.bounded_at});
  const calls=[],completions=[];let gone=options.alreadyGone??false;
  const rpc=async(name,body)=>{
    calls.push({name,body});
    if(name==='icash_claim_recorded_reception_work')return body.p_kind==='delete'?[clone(f.row)]:[];
    if(name==='icash_get_recorded_reception_session')return clone(f.row);
    if(name==='icash_finish_recorded_reception_work'){completions.push(body);assert.equal(body.p_lease_token,configId);assert.equal(body.p_account,f.row.account_id);assert.equal(body.p_operation,operation);if(options.finishNull)return null;return clone(f.row);}
    throw Error('UNEXPECTED_CLEANUP_RPC '+name);
  };
  const provider={...f.provider,
    getRecording:async(re,includeDeleted)=>{calls.push({provider:'getRecording'});assert.equal(re,recordingSid);assert.equal(includeDeleted,true);if(options.readError)throw new RecordingProviderError(options.readError);if(options.notFound)throw new RecordingProviderError(404);return {sid:recordingSid,account_sid:accountSid,call_sid:callSid,status:gone?'deleted':'completed',...options.badReceipt};},
    deleteRecording:async re=>{calls.push({provider:'deleteRecording'});assert.equal(re,recordingSid);if(options.deleteThrows)throw Error('synthetic-delete-unknown');if(!options.unconfirmed)gone=true;},
  };
  return {...f,calls,completions,rpc,provider};
}
test('independent deletion runs with capture disabled, bot paused and zero credits; absence must be verified',async()=>{
  const f=await cleanupFixture();const result=await maintainRecordedReception(f.rpc,f.provider,{...env,ICASH_RECORDED_RECEPTION_READY:'false',RECEPTION_ENABLED:'false',BOT_PAUSED:'true',CREDIT_BALANCE:'0'},now);assert.equal(result.deleted,1);assert.equal(result.held,0);assert.equal(f.calls.filter(e=>e.provider==='deleteRecording').length,1);assert.equal(f.calls.filter(e=>e.provider==='getRecording').length,2);assert.equal(f.completions[0].p_outcome,'deleted');assert(f.calls.filter(e=>e.name).every(e=>['icash_claim_recorded_reception_work','icash_get_recorded_reception_session','icash_finish_recorded_reception_work'].includes(e.name)));
});
test('provider 404/deleted is accepted for cleanup, but 403, foreign receipt or unconfirmed delete remains retryable',async()=>{
  for(const options of [{alreadyGone:true},{notFound:true}]){const f=await cleanupFixture(options);assert.equal((await maintainRecordedReception(f.rpc,f.provider,env,now)).deleted,1);assert.equal(f.calls.filter(e=>e.provider==='deleteRecording').length,0);}
  for(const options of [{readError:403},{badReceipt:{call_sid:'CA'+'d'.repeat(32)}},{deleteThrows:true},{unconfirmed:true}]){const f=await cleanupFixture(options);const result=await maintainRecordedReception(f.rpc,f.provider,env,now);assert.equal(result.deleted,0);assert.equal(result.held,1);assert.equal(f.completions.at(-1).p_outcome,'retry');}
});
test('cleanup cannot claim durable success when lease-specific completion loses its CAS',async()=>{
  const f=await cleanupFixture({finishNull:true});const result=await maintainRecordedReception(f.rpc,f.provider,env,now);assert.equal(result.deleted,0);assert.equal(result.held,1);
});
test('disabled-lane reconciliation still terminates an overdue gate without starting recording or AI',async()=>{
  const f=await fixture({endThrows:true}).ready();f.setNow(now+600000);const completions=[];
  const rpc=async(name,body)=>{if(name==='icash_claim_recorded_reception_work')return body.p_kind==='reconcile'?[{...clone(f.row),reconcile_lease_token:rateId}]:[];if(name==='icash_finish_recorded_reception_work'){completions.push(body);return clone(f.row);}return f.rpc(name,body);};
  const result=await maintainRecordedReception(rpc,f.provider,{...env,ICASH_RECORDED_RECEPTION_READY:'false',BOT_PAUSED:'true'},now+600000);assert(f.row.end_requested_at);assert.equal(result.held,1);assert.equal(completions[0].p_outcome,'retry');assert.equal(providerWrites(f).filter(e=>e.provider==='end').length,1);assert(!providerWrites(f).some(e=>['start','register'].includes(e.provider)));
});
function settlementInput(f) {
  makeAvailable(f);Object.assign(f.row,{register_claimed_at:iso,ended_at:new Date(now+600000).toISOString(),setup_confirmed_at:f.row.bounded_at,pricing_policy:{...f.row.pricing_policy,streamMicrosPerMinute:4400}});
  const row=f.row,user='icash-recorded-reception:'+id;
  return {row,call:{sid:callSid,account_sid:accountSid,from:caller,to:row.to_phone,direction:'inbound',start_time:iso,status:'completed',price_unit:'USD',price:'-0.100000',duration:'600'},conversation:{conversation_id:row.conversation_id,agent_id:row.agent_id,branch_id:row.branch_id,version_id:row.version_id,user_id:user,status:'done',conversation_initiation_client_data:{user_id:user,branch_id:row.branch_id,dynamic_variables:{icash_reception_recording_id:id}},metadata:{call_duration_secs:590,cost_fiat:0.2,phone_call:{call_sid:callSid,direction:'inbound',external_number:caller,agent_number:row.to_phone}}},recording:{sid:recordingSid,account_sid:accountSid,call_sid:callSid,status:'completed'}};
}
test('settlement keeps carrier/AI observations separate from recording/storage/speech/stream estimates',async()=>{
  const s=settlementInput(await fixture().ready());const a=receptionSettlementAttestation(s.row,s.call,s.conversation,s.recording);assert(a);assert.equal(a.mode,'recorded');assert.equal(a.binding.direction,'inbound');assert.equal(a.providers.twilio.amountMicros,100000);assert.equal(a.providers.elevenlabs.amountMicros,200000);assert.deepEqual(a.recording,{policyVersion:recordedReceptionPolicy,speechGatherMicros:20000,recordingMicros:25000,storageMicros:5358,streamMicros:44000,recordingEstimated:true});
  const calls=[];assert.deepEqual(await settleRecordedReception(async(name,body)=>{calls.push({name,body});return {settled:true,chargedCents:100,costBasis:'estimated'};},s.row,s.call,s.conversation,s.recording),{settled:true,chargedCents:100,costBasis:'estimated'});assert.equal(calls[0].name,'icash_settle_recorded_reception');assert.equal(calls[0].body.p_account,s.row.account_id);assert.equal(calls[0].body.p_operation,operation);
});
test('gate-only settlement contains no AI or recording charge; confirmed disclosure carries speech estimate',async()=>{
  const f=await fixture().ready();f.row.call_ended_at=iso;f.row.call_started_at=iso;f.row.setup_confirmed_at=f.row.bounded_at;const call={sid:callSid,account_sid:accountSid,from:caller,to:f.row.to_phone,direction:'inbound',start_time:iso,status:'completed',price_unit:'USD',price:'-0.001000',duration:'5'};
  const a=receptionSettlementAttestation(f.row,call,null,null);assert.equal(a.mode,'gate_only');assert.equal(a.providers.elevenlabs,undefined);assert.equal(a.recording.recordingMicros,0);assert.equal(a.recording.storageMicros,0);assert.equal(a.recording.streamMicros,0);assert.equal(a.recording.speechGatherMicros,20000);
  f.row.setup_confirmed_at=null;f.row.bounded_at=null;assert.equal(receptionSettlementAttestation(f.row,call,null,null).recording.speechGatherMicros,0);
});
test('failed AI conversations settle verified usage, but active conversations cannot settle',async()=>{
  const s=settlementInput(await fixture().ready());s.conversation.status='failed';
  assert.equal(receptionSettlementAttestation(s.row,s.call,s.conversation,s.recording).providers.elevenlabs.amountMicros,200000);
  for(const status of ['processing','in-progress','initiated']){s.conversation.status=status;assert.equal(receptionSettlementAttestation(s.row,s.call,s.conversation,s.recording),null);}
});
test('unanswered gate releases only with canonical terminal identity and no AI attempt',async()=>{
  const f=await fixture().ready();Object.assign(f.row,{call_ended_at:iso,call_started_at:iso,setup_confirmed_at:null,bounded_at:null});
  const call={sid:callSid,account_sid:accountSid,from:caller,to:f.row.to_phone,direction:'inbound',start_time:iso,status:'canceled',price_unit:null,price:null,duration:null};
  const a=receptionSettlementAttestation(f.row,call,null,null);assert.equal(a.mode,'gate_only');assert.equal(a.providers.twilio.amountMicros,0);
  assert.equal(receptionSettlementAttestation(f.row,{...call,status:'completed'},null,null),null);
  assert.equal(receptionSettlementAttestation(f.row,{...call,account_sid:'AC'+'d'.repeat(32)},null,null),null);
  f.row.register_claimed_at=iso;assert.equal(receptionSettlementAttestation(f.row,call,null,null),null);
});
test('empty credits end an active incoming call without starting another provider action',async()=>{
  const f=await fixture({emptyCredits:true}).ready();const completions=[];
  const rpc=async(name,body)=>{if(name==='icash_claim_recorded_reception_work')return body.p_kind==='reconcile'?[{...clone(f.row),reconcile_lease_token:rateId}]:[];if(name==='icash_finish_recorded_reception_work'){completions.push(body);return clone(f.row);}return f.rpc(name,body);};
  await maintainRecordedReception(rpc,f.provider,env,now);
  assert(f.row.end_requested_at);assert(f.row.call_ended_at);assert.equal(providerWrites(f).filter(e=>e.provider==='end').length,1);
});
test('incomplete, foreign, excessive or unknown-price settlement evidence cannot reach charging RPC',async()=>{
  const changes=[s=>s.call.price=null,s=>s.call.price='0.1',s=>s.call.price_unit='credits',s=>s.call.duration='601',s=>s.call.direction='outbound-api',s=>s.call.account_sid='AC'+'d'.repeat(32),s=>s.conversation.metadata.cost_fiat=null,s=>s.conversation.metadata.cost_fiat='0.2',s=>s.conversation.metadata.call_duration_secs=601,s=>s.conversation.branch_id='agtbrch_foreignfixture',s=>s.recording.call_sid='CA'+'d'.repeat(32),s=>s.row.pricing_policy.streamMicrosPerMinute=undefined];
  for(const change of changes){const s=settlementInput(await fixture().ready());change(s);let called=false;assert.equal((await settleRecordedReception(async()=>{called=true;},s.row,s.call,s.conversation,s.recording)).settled,false);assert.equal(called,false);}
  const s=settlementInput(await fixture().ready());for(const chargedCents of [-1,.5,s.row.charge_cap_cents+1])assert.equal((await settleRecordedReception(async()=>({settled:true,chargedCents}),s.row,s.call,s.conversation,s.recording)).settled,false);
});
test('public presentation allowlist hides raw provider/caller/capability data and labels estimates and expiry honestly',async()=>{
  const f=await fixture().ready();makeAvailable(f);f.row.setup_confirmed_at=f.row.bounded_at;Object.assign(f.row,{secret_fixture:'never-deliver',transcript:[{text:'private-fixture'}],provider_url:'https://provider.invalid/private'});
  const value=recordedReceptionPresentation(f.row,now);assert.equal(value.audioAvailable,true);assert.equal(value.recordingCostBasis,'estimated');assert.equal(value.storageEstimateMicros,5358);assert.equal(value.speechGatherEstimateMicros,20000);assert.equal(value.costBasis,'pending');assert.equal(value.chargedCents,null);assert.equal(recordedReceptionPresentation(f.row,now+1000).audioAvailable,false);assert.equal(recordedReceptionPresentation(f.row,now+1000).status,'expired');
  const serialized=JSON.stringify(value);for(const forbidden of ['nonce_hash','stop_token_hash','caller_hash','from_phone','to_phone','configuration','provider_url','secret_fixture','transcript','never-deliver','private-fixture'])assert(!serialized.includes(forbidden));
});

test('recording callbacks retry when final metadata is not durably saved',async()=>{
  const f=await fixture({rejectTransition:'available',recordingReceipt:{status:'completed',duration:'12',price:'-0.002500',price_unit:'USD'}}).ready();await f.consent();
  const response=await f.service.status(signed('status?id='+id,{RecordingSid:recordingSid,RecordingStatus:'completed'}));assert.equal(response.status,503);assert.notEqual(f.row.state,'available');
});
test('a malformed recording quote or disclosure is rejected before reservation',async()=>{
  for(const mutate of [({c})=>c.pricing_policy.streamMicrosPerMinute=0,({c})=>c.pricing_policy.version='legacy-unrecorded',({c})=>c.pricing_policy.retentionDays=7,({c})=>c.disclosure_version='unreviewed-disclosure']){const f=fixture({mutate});assert.equal((await f.admit()).text,rejectTwiml);assert.equal(providerWrites(f).length,0);}
});
test('property-aware recorded branch preserves reviewed context and does not look it up before consent',async()=>{
  const {propertyReceptionPolicy,propertyReceptionPolicyHash,propertyReceptionGreeting,propertyReceptionPrompt}=await import('../lib/reception-property-context.ts');
  const context={status:'matched',address:'10 Synthetic Lane',returningName:'Alex'};
  const f=fixture({propertyContext:context,mutate:x=>{Object.assign(x.c,{context_policy:propertyReceptionPolicy,context_policy_hash:propertyReceptionPolicyHash,context_approval_reference:'synthetic-explicit-property-policy-review'});x.agent.conversation_config.agent.first_message=propertyReceptionGreeting;x.agent.conversation_config.agent.prompt.prompt=propertyReceptionPrompt+recordedReceptionStopInstruction;x.c.config_hash=inspectRecordedReceptionAgent(x.c,x.agent,x.branch,true).hash;}});
  await f.ready();assert(!f.events.some(e=>e.rpc==='icash_recorded_reception_property_context'));await f.consent();
  const at=f.events.findIndex(e=>e.rpc==='icash_recorded_reception_property_context'),started=f.events.findIndex(e=>e.provider==='start');assert(at>started);assert.deepEqual(f.events.find(e=>e.provider==='register').context,context);
});


test('declined presentation claims call ended only after canonical terminal confirmation',async()=>{
 const f=await fixture({endThrows:true}).ready();await f.consent({SpeechResult:'no',Confidence:'.99'});
 assert.equal(f.row.state,'declined');assert.equal(recordedReceptionPresentation(f.row,now).callEnded,false);
 f.row.call_ended_at=iso;assert.equal(recordedReceptionPresentation(f.row,now).callEnded,true);
 const ui=readFileSync('components/reception-recordings.tsx','utf8');assert.match(ui,/declined:'Recording declined; ending call'/);assert.match(ui,/r.status==='declined'&&r.callEnded\?'Recording declined; call ended'/);
});

test('runtime admission uses independent exact inline stop proof for both bounded incoming profiles',async()=>{
 for(const profile of ['normal','owner_quick_test']){
  const f=fixture({profile,mutate:x=>{x.agent.conversation_config.agent.prompt.tools=[clone(x.tool.tool_config),{type:'system',name:'end_call',params:{system_tool_type:'end_call'}}];x.c.config_hash=inspectRecordedReceptionAgent(x.c,x.agent,x.branch,true).hash;}});
  const {text}=await f.admit();assert.match(text,/<Gather/);assert.equal(f.row.state,'consent_pending');
  assert.equal(f.events.filter(e=>e.rpc==='icash_reserve_flexible_reception').length,1);
  assert.deepEqual(providerWrites(f).map(e=>e.provider),['boundCall']);assert.equal(f.row.max_total_seconds,profile==='normal'?600:60);
 }
});
test('runtime rejects inline stop mismatches, duplicate tools and missing independent proof before reservation',async()=>{
 const changes=[x=>x.tool=null,x=>x.tool.id='tool_foreign',x=>x.agent.conversation_config.agent.prompt.tools[0].api_schema.url='https://foreign.invalid/stop',x=>x.agent.conversation_config.agent.prompt.tools[0].description='different from independent definition',x=>x.agent.conversation_config.agent.prompt.tools.push(clone(x.tool.tool_config))];
 for(const change of changes){
  const f=fixture({mutate:x=>{x.agent.conversation_config.agent.prompt.tools=[clone(x.tool.tool_config)];change(x);x.c.config_hash=inspectRecordedReceptionAgent(x.c,x.agent,x.branch,true).hash;}});
  assert.equal((await f.admit()).text,rejectTwiml);assert.equal(f.row,null);assert.equal(providerWrites(f).length,0);assert(!f.events.some(e=>e.rpc==='icash_reserve_flexible_reception'));
 }
});


test('ringing admission answers with disclosure, then signed setup bounds before gathering',async()=>{
 const f=fixture();const first=await f.answer();
 assert.match(first.text,/^<Response><Play>/);assert.match(first.text,/<Redirect method="POST">/);
 assert(!/<Gather|<Record|<Connect|<Pause/.test(first.text));assert.equal(f.row.state,'reserved');assert.equal(providerWrites(f).length,0);
 f.setCall({status:'in-progress'});
 const second=await(await f.setup()).text();assert.match(second,/^<Response><Gather /);assert.equal(f.row.state,'consent_pending');assert(f.row.call_started_at);
 assert.deepEqual(providerWrites(f).map(e=>e.provider),['boundCall']);
 const names=f.events.map(e=>e.rpc==='icash_transition_recorded_reception'?e.body.p_action:e.provider);
 assert(names.indexOf('claim_setup')<names.indexOf('boundCall'));assert(names.indexOf('boundCall')<names.indexOf('bounded'));assert(names.indexOf('bounded')<names.indexOf('bind_call_start'));
 const replay=await(await f.setup()).text();assert.match(replay,/<Hangup/);assert.equal(providerWrites(f).filter(e=>e.provider==='boundCall').length,1);
});
test('setup rejects forged, cross-call and nonce callbacks without a carrier mutation',async()=>{
 for(const variant of ['signature','nonce','call','extra','path']){
  const f=fixture();await f.answer();f.setCall({status:'in-progress'});f.events.length=0;
  const path='setup?id='+id+'&nonce='+(variant==='nonce'?'a'.repeat(64):f.nonce)+(variant==='extra'?'&extra=1':'');
  const req=signed(path,{CallStatus:'in-progress',...(variant==='call'?{CallSid:'CA'+'f'.repeat(32)}:{})},variant==='signature'?{signature:'forged'}:variant==='path'?{url:recordedReceptionUrl+'/terminal?id='+id+'&nonce='+f.nonce}:{});
  assert.match(await(await f.service.setup(req)).text(),/<Hangup/);assert.equal(providerWrites(f).length,0);assert.equal(f.row.setup_claimed_at,null);
 }
});
test('setup will not update an unanswered, ended, foreign or expired call',async()=>{
 for(const change of [f=>{},f=>f.setCall({status:'completed'}),f=>f.setCall({status:'in-progress',from:'+12125550000'}),f=>{f.setCall({status:'in-progress'});f.setNow(now+60001); }]){
  const f=fixture();await f.answer();change(f);assert.match(await(await f.setup()).text(),/<Hangup/);assert(!providerWrites(f).some(e=>['boundCall','start','register'].includes(e.provider)));
 }
});
test('carrier error diagnostics expose only numeric status and code',async()=>{
 const f=await fixture().ready();
 const provider=createRecordedReceptionProviders(env,async()=>new Response(JSON.stringify({code:21220,message:'private carrier details',uri:'secret'}),{status:400}));
 await assert.rejects(provider.boundCall(f.row),{message:'CALL_BOUND_HTTP_400_CODE_21220'});
 const malformed=createRecordedReceptionProviders(env,async()=>new Response(JSON.stringify({code:'private carrier details'}),{status:400}));
 await assert.rejects(malformed.boundCall(f.row),{message:'CALL_BOUND_HTTP_400_CODE_0'});
});

 test('incoming prompts use matching versioned audio without altering signed consent',()=>{
 const xml=receptionConsentTwiml(id,'e'.repeat(64));assert.equal((xml.match(/<Play>/g)||[]).length,2);assert(!xml.includes('<Say'));assert.match(xml,/input="speech"/);assert.match(xml,/actionOnEmptyResult="true"/);assert.match(xml,/<Hangup\/>/);
 const question=receptionConsentTwiml(id,'e'.repeat(64),false);assert.equal((question.match(/<Play>/g)||[]).length,1);assert(!question.includes('notice.mp3'));assert.match(question,/question.mp3/);
 });

test('missing carrier price uses only an explicit tariff approval, remains estimated, and retains exact identity',async()=>{
 const s=settlementInput(await fixture().ready());s.row.cost_policy_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';s.call.price=null;s.call.duration='61';
 const calls=[];const rpc=async(name,body)=>{calls.push({name,body});return name==='icash_get_reception_carrier_estimate'?{tariffVersion:'us-local-inbound-20261007',microsPerMinute:8500}:{settled:true,chargedCents:100,costBasis:'estimated'};};
 assert.equal((await settleRecordedReception(rpc,s.row,s.call,s.conversation,s.recording)).settled,true);
 assert.deepEqual(calls.map(c=>c.name),['icash_get_reception_carrier_estimate','icash_settle_recorded_reception']);
 const p=calls[1].body.p_attestation.providers.twilio;assert.equal(p.amountMicros,17000);assert.equal(p.basis,'estimated');assert.equal(p.pricePending,true);
 let charges=0;assert.equal((await settleRecordedReception(async name=>{if(name==='icash_settle_recorded_reception')charges++;return null;},s.row,s.call,s.conversation,s.recording)).settled,false);assert.equal(charges,0);
 for(const mutation of [x=>x.call.price='bad',x=>x.call.price='0.01',x=>x.call.price_unit='EUR',x=>x.call.sid='CA'+'f'.repeat(32),x=>x.call.duration='601',x=>x.call.status='in-progress',x=>x.conversation.metadata.cost_fiat=null]){
  const bad=structuredClone(s);mutation(bad);let reads=0;assert.equal((await settleRecordedReception(async()=>{reads++;},bad.row,bad.call,bad.conversation,bad.recording)).settled,false);assert.equal(reads,0);
 }
});

// Carrier and AI must use the affordable bound returned by the atomic reserve.
test('affordable incoming calls preserve reviewed config and use exact funded duration',async()=>{
 for(const max_total_seconds of [120,180,240,300,360,420,480,540]){
  const f=fixture({badRow:{max_total_seconds,charge_cap_cents:196}});await f.ready();
  assert.equal(f.c.max_duration_seconds,600);
  assert.deepEqual(providerWrites(f).map(e=>[e.provider,e.seconds]),[['boundCall',max_total_seconds]]);
  assert.match(await (await f.consent()).text(),/<Connect>/);
  assert.equal(providerWrites(f).find(e=>e.provider==='register').seconds,max_total_seconds);
 }
 for(const badRow of [{max_total_seconds:60},{max_total_seconds:121},{max_total_seconds:660},{charge_cap_cents:0},{charge_cap_cents:480}]){
  const f=fixture({badRow});assert.match((await f.admit()).text,/<Hangup/);
  assert(!providerWrites(f).some(e=>['boundCall','start','register'].includes(e.provider)));
 }
 const owner=fixture({profile:'owner_quick_test',badRow:{max_total_seconds:120}});
 assert.match((await owner.admit()).text,/<Hangup/);
 assert(!providerWrites(owner).some(e=>e.provider==='boundCall'));
});

for(const bad of [false,true])test('direct inbound keeps audio and skips spoken gate; start failure '+bad,async()=>{
 const f=fixture({direct:true,startThrows:bad});
 const response=await f.service.inbound(inboundRequest());const xml=await response.text();
 assert(!/notice|question|<Gather|<Say/.test(xml));assert(xml.includes('call-connect-silence.wav'));
 const target=xml.match(/<Redirect method="POST">([^<]+)/)[1].replaceAll('&amp;','&');
 f.setCall({status:'in-progress'});
 const setup=await f.service.setup(signed('setup'+new URL(target).search,{CallStatus:'in-progress'}));
 const next=await setup.text();assert.match(next,/<Redirect/);assert(!/<Say|<Gather|notice/.test(next));
 const connection=next.match(/<Redirect method="POST">([^<]+)/)[1].replaceAll('&amp;','&');
 const connected=await f.service.connect(signed('connect'+new URL(connection).search,{CallStatus:'in-progress'}));
 assert.match(await connected.text(),bad?/<Hangup/:/<Connect/);
 const row=f.row;assert.equal(row.consent_at,null);assert.equal(row.consent_evidence,undefined);assert(row.recording_authorized_at);
 assert.equal(f.events.filter(e=>e.provider==='start').length,1);
 assert.equal(f.events.filter(e=>e.provider==='register').length,bad?0:1);
 await f.service.setup(signed('setup'+new URL(target).search,{CallStatus:'in-progress'}));
 assert.equal(f.events.filter(e=>e.provider==='start').length,1);
});
