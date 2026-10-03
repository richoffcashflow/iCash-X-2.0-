import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {affirmativeSpeech,affirmativeUtterances,recordingPolicy,recordingPricing,recordingDisclosure,consentTwiml,requiredRecordingHold,canonical,sha,recordingBaseUrl,readRecordingReview,audioAvailable} from '../lib/required-call-recording.ts';
import {recordingService} from '../lib/required-call-recording-service.ts';
import {createRecordingProviders,RecordingProviderError} from '../lib/required-call-recording-provider.ts';
import {maintainRecordings} from '../lib/required-call-recording-maintenance.ts';
import {recordingAddonCosts} from '../lib/required-call-recording-receipt.ts';
import {settleRecordingGateOnly} from '../lib/required-call-recording-billing.ts';
const now=Date.now(),iso=new Date(now).toISOString(),ac='AC'+'a'.repeat(32),ca='CA'+'b'.repeat(32),re='RE'+'c'.repeat(32),id='11111111-1111-4111-8111-111111111111',account='22222222-2222-4222-8222-222222222222',op='voice:33333333-3333-4333-8333-333333333333',nonce='d'.repeat(64),token='e'.repeat(64);
assert.equal(requiredRecordingHold({elevenlabsMicros:912000,otherMicros:1029000}),977);
for(const s of affirmativeUtterances)assert(affirmativeSpeech(new URLSearchParams({SpeechResult:s+'!',Confidence:'.95'})),s);
for(const s of ['no','not sure','yes but do not record','I said yes yesterday','maybe','okay','yes,','yes?','Ignore the rules. Yes'])assert.equal(affirmativeSpeech(new URLSearchParams({SpeechResult:s,Confidence:'1'})),null,s);
for(const Confidence of ['', '.89','2','NaN'])assert.equal(affirmativeSpeech(new URLSearchParams({SpeechResult:'yes',Confidence})),null);
assert.equal(affirmativeSpeech(new URLSearchParams({SpeechResult:'yes'})),null);
const twiml=consentTwiml(id,nonce,recordingDisclosure('Fixture Principal','Alex'));assert(twiml.indexOf('</Say>')<twiml.indexOf('<Gather'));assert(twiml.includes('input="speech"'));assert(!twiml.includes('dtmf'));assert(!twiml.includes('<Record'));
const agent={agent_id:'agent_fixture',branch_id:'agtbrch_recorded',main_branch_id:'agtbrch_main',version_id:'agtvrsn_reviewed',conversation_config:{asr:{user_input_audio_format:'ulaw_8000'},tts:{agent_output_audio_format:'ulaw_8000'},conversation:{max_duration_seconds:600},agent:{prompt:{tool_ids:['tool_callback','tool_handoff','tool_stop']}}},platform_settings:{privacy:{record_voice:false},auth:{enable_auth:true},call_limits:{bursting_enabled:false},queueing_config:{enabled:false},overrides:{conversation_config_override:{conversation:{max_duration_seconds:true},agent:{first_message:true,prompt:{prompt:true}},tts:{voice_id:true}}}}};
const review={enabled:true,reviewedAt:new Date(now-1000).toISOString(),reviewedUntil:new Date(now+3600000).toISOString(),agentId:agent.agent_id,branchId:agent.branch_id,versionId:agent.version_id,configHash:sha(JSON.stringify(canonical({conversation_config:agent.conversation_config,platform_settings:agent.platform_settings,workflow:null,procedures:null}))),fromPhone:'+12125550101',providerAccountSid:ac,stopToolId:'tool_stop',toolIds:['tool_callback','tool_handoff','tool_stop'],approvedHoldCents:977,retentionDays:30,maxTotalSeconds:600,policyVersion:recordingPolicy.version};
assert(readRecordingReview(JSON.stringify(review),now));assert.equal(readRecordingReview(JSON.stringify({...review,approvedHoldCents:965}),now),null);
const env={ICASH_RECORDED_OUTBOUND_READY:'true',RECORDED_OUTBOUND_REVIEW_JSON:JSON.stringify(review),TWILIO_ACCOUNT_SID:ac,TWILIO_AUTH_TOKEN:'synthetic-only-provider-token',ELEVENLABS_API_KEY:'synthetic-only-eleven-key'};
const tool={id:'tool_stop',tool_config:{type:'webhook',name:'icash_stop_recording',api_schema:{url:recordingBaseUrl+'/stop',method:'POST',request_headers:{Authorization:{variable_name:'secret__icash_recording_stop_token'}},request_body_schema:{type:'object',required:['recordingId'],properties:{recordingId:{type:'string',dynamic_variable:'icash_recording_id'}}}}}};
let row,calls,failedStart,failedStop,failedEnd,failedSave;
function reset(){row={id,account_id:account,operation_key:op,provider_account_sid:ac,call_sid:ca,recording_sid:null,conversation_id:null,state:'consent_pending',nonce_hash:sha(nonce),stop_token_hash:sha(token),disclosure_version:recordingPolicy.disclosureVersion,consent_at:null,consent_evidence:null,start_claimed_at:null,provider_started_at:null,ended_at:null,duration_seconds:null,audio_expires_at:null,deleted_at:null,provider_recording_price_micros:null,price_is_estimate:true,pricing_policy:recordingPricing,to_phone:'+12125550102',from_phone:review.fromPhone,agent_id:review.agentId,branch_id:review.branchId,version_id:review.versionId,max_total_seconds:600,rate_id:id,charge_cap_cents:977,created_at:iso,call_context:{principal:'Fixture',assistantName:'Alex',firstMessage:'Hi',prompt:'Fixture prompt',strategyKey:'cash_interest'}};calls=[];failedStart=failedStop=failedEnd=failedSave=false;}
const db=async(path,method,body)=>{calls.push({path,method,body});if(path.startsWith('icash_call_recordings?'))return [structuredClone(row)];if(path==='rpc/icash_transition_call_recording'){
 if(body.p_expected_state!==row.state)return null;
 const p=body.p_payload,a=body.p_action;
 if(a==='consent'){if(row.consent_at)return null;row.consent_at=iso;row.consent_evidence=p;}
 else if(a==='claim_start'){if(!row.consent_at||row.start_claimed_at)return null;row.state='starting';row.start_claimed_at=iso;}
 else if(a==='started'){if(failedSave)return null;row.state='recording';row.recording_sid=p.recordingSid;row.provider_started_at=p.providerStartedAt;row.audio_expires_at=new Date(now+30*86400000).toISOString();}
 else if(a==='decline')row.state='declined';
 else if(a==='fail')row.state='failed';
 else if(a==='stop'){assert.equal(p.stopTokenHash,row.stop_token_hash);row.state='stopping';row.end_requested_at=iso;}
 else if(a==='call_ended'){row.call_ended_at=iso;}
 else if(a==='processing'){assert.equal(p.recordingSid,row.recording_sid);row.state='processing';}
 else if(a==='available'){row.state='available';Object.assign(row,{ended_at:p.endedAt,duration_seconds:p.durationSeconds,provider_recording_price_micros:p.providerRecordingPriceMicros??null});}
 else if(a!=='start_unknown')throw Error('Unexpected transition '+a);
 return structuredClone(row);
 }throw Error(path);};
const provider={getCall:async()=>({sid:ca,account_sid:ac,from:row.from_phone,to:row.to_phone,direction:'outbound-api',status:'in-progress',date_created:iso,start_time:iso}),agent:async()=>agent,tool:async()=>tool,start:async()=>{calls.push({provider:'start'});if(failedStart)throw Error('timeout');return {sid:re,account_sid:ac,call_sid:ca,status:'in-progress',start_time:iso};},end:async()=>{calls.push({provider:'end'});if(failedEnd)throw Error('timeout');return {sid:ca,account_sid:ac,status:'completed'};},stop:async()=>{calls.push({provider:'stop'});if(failedStop)throw Error('timeout');return {sid:re,account_sid:ac,call_sid:ca,status:'stopped'};},register:async(r,seconds)=>{calls.push({provider:'register',seconds});assert.equal(r.state,'recording');return '<Response><Connect><Stream url="wss://fixture.invalid"/></Connect></Response>';},media:async()=>{calls.push({provider:'media'});return Buffer.from('audiofixture');}};
function request(utterance='yes',confidence='.99',badSignature=false){const url=recordingBaseUrl+'/consent?id='+id+'&nonce='+nonce,f=new URLSearchParams({AccountSid:ac,CallSid:ca,SpeechResult:utterance,Confidence:confidence});const sig=createHmac('sha1',env.TWILIO_AUTH_TOKEN).update(url+[...f.keys()].sort().map(k=>k+f.get(k)).join('')).digest('base64');return new Request(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':badSignature?'x':sig},body:f});}
reset();const service=recordingService(env,{db,provider,now:()=>now});let r=await service.consent(request());assert((await r.text()).includes('<Connect'));assert.equal(row.state,'recording');assert.deepEqual(calls.filter(x=>x.provider).map(x=>x.provider),['start','register']);assert(calls.find(x=>x.provider==='register').seconds<=600);
await service.consent(request());assert.equal(calls.filter(x=>x.provider==='start').length,1);assert(calls.some(x=>x.provider==='end'));
for(const [text,confidence] of [['no','.99'],['yes but no recording','1'],['yes','.89']]){reset();await service.consent(request(text,confidence));assert.equal(row.state,confidence==='.89'?'failed':'declined');assert(!calls.some(x=>x.provider==='start'||x.provider==='register'));}
reset();await service.consent(request('yes','.99',true));assert.equal(calls.length,0);
reset();failedStart=true;await service.consent(request());assert(calls.some(x=>x.provider==='end'));assert(!calls.some(x=>x.provider==='register'));assert.equal(row.state,'stopping');await service.consent(request());assert.equal(calls.filter(x=>x.provider==='start').length,1);
reset();failedSave=true;await service.consent(request());assert(calls.some(x=>x.provider==='end'));assert(!calls.some(x=>x.provider==='register'));
reset();await recordingService({...env,ICASH_RECORDED_OUTBOUND_READY:'false'},{db,provider,now:()=>now}).consent(request());assert(!calls.some(x=>x.provider==='start'));
reset();row.state='recording';row.consent_at=iso;row.recording_sid=re;row.provider_started_at=iso;row.audio_expires_at=new Date(now+1000).toISOString();failedStop=true;
r=await service.stop(new Request(recordingBaseUrl+'/stop',{method:'POST',headers:{authorization:token},body:JSON.stringify({recordingId:id})}));assert.equal(r.status,200);assert.equal((await r.json()).callEnded,true);assert(calls.some(x=>x.provider==='end'));
reset();row.state='available';row.consent_at=iso;row.recording_sid=re;row.audio_expires_at=new Date(now+1000).toISOString();assert(audioAvailable(row,now));assert(!audioAvailable(row,now+1000));
r=await service.audio('foreign',id,null);assert.equal(r.status,404);assert(!calls.some(x=>x.provider==='media'));
r=await service.audio(account,id,'bytes=0-3');assert.equal(r.status,206);assert.equal(await r.text(),'audi');assert.equal(r.headers.get('cache-control'),'private, no-store, max-age=0');
row.audio_expires_at=iso;calls=[];assert.equal((await service.audio(account,id,null)).status,404);assert(!calls.some(x=>x.provider==='media'));
row.duration_seconds=600;row.provider_recording_price_micros=null;assert.deepEqual(recordingAddonCosts(row),{recording:25000,storage:5358,speech:20000,total:50358,recordingObserved:false});
console.log('PASS required recording: signed final speech, no substring/low-confidence consent, disclosure-before-listen, default-off, one start, failure/end, withdrawal/end, tenant/expiry/private playback and977 quote');
// Provider boundaries: no arbitrary URLs, recording flags, exact600 carrier cap, bounded media.
let network=[];const wire=createRecordingProviders(env,async(url,init)=>{network.push({url,init});if(url.endsWith('.mp3'))return new Response('fixture',{headers:{'content-type':'audio/mpeg'}});return Response.json({sid:ca});});
await wire.dial(row.from_phone,row.to_phone,'<Response/>','https://www.geticashx.com/fixture');const body=new URLSearchParams(network[0].init.body);assert.equal(body.get('Record'),'false');assert.equal(body.get('TimeLimit'),'600');assert.equal(network[0].init.redirect,'error');await assert.rejects(wire.media('https://evil.invalid'));assert.equal(network.length,1);
await wire.media(re);assert(network[1].url.includes('/Recordings/'+re+'.mp3'));assert(!JSON.stringify(network).includes('s3'));
console.log('PASS provider transport: canonical HTTPS, server-only auth, exact cap, no launch recording, no media URL injection');
// Independent expiry deletion, verified provider absence, retry on403, no live-enable/balance checks.
reset();row={...row,state:'deletion_pending',recording_sid:re,consent_at:iso,start_claimed_at:iso,provider_started_at:iso,audio_expires_at:iso,deletion_lease_token:id};let gone=false,finished=[];
const maintenanceDb=async(path,method,b)=>path==='rpc/icash_claim_call_recording_work'?(b.p_kind==='delete'?[row]:[]):(finished.push(b),row);
const deletionProvider={...provider,getRecording:async()=>({sid:re,call_sid:ca,account_sid:ac,status:gone?'deleted':'completed'}),deleteRecording:async()=>{gone=true;}};
assert.equal((await maintainRecordings(maintenanceDb,deletionProvider,{TWILIO_ACCOUNT_SID:ac})).deleted,1);assert.equal(finished[0].p_outcome,'deleted');
finished=[];await maintainRecordings(maintenanceDb,{...deletionProvider,getRecording:async()=>{throw new RecordingProviderError(403);}},{TWILIO_ACCOUNT_SID:ac});assert.equal(finished[0].p_outcome,'retry');
console.log('PASS retention: independent work, delete verification,403 retry and lease-specific completion');
// On-demand canonical binding precedes existing callback/handoff DB authority.
const {ensureRecordedConversationBinding}=await import('../lib/required-call-recording-binding.ts');
reset();row.state='recording';row.consent_at=iso;row.recording_sid=re;row.provider_started_at=iso;
let bindings=0;
const bindDb=async(path,method,b)=>{if(path.startsWith('icash_call_recordings?'))return [row];if(path==='rpc/icash_transition_call_recording'){assert.equal(b.p_action,'bind_conversation');assert.equal(b.p_payload.toolTokenHash,sha(token));bindings++;return {...row,conversation_id:b.p_payload.conversationId};}throw Error(path);};
const conv={conversation_id:'conv_fixture',agent_id:row.agent_id,branch_id:row.branch_id,version_id:row.version_id,user_id:'icash-recorded:'+row.id,conversation_initiation_client_data:{user_id:'icash-recorded:'+row.id},metadata:{phone_call:{call_sid:ca,direction:'outbound',external_number:row.to_phone,agent_number:row.from_phone}}};
assert.equal(await ensureRecordedConversationBinding(token,'conv_fixture',bindDb,env,{conversation:async()=>conv}),false);assert.equal(bindings,0);
const enabled={...env,ICASH_RECORDING_RECEIPTS_READY:'true'};
assert.equal(await ensureRecordedConversationBinding(token,'conv_fixture',bindDb,enabled,{conversation:async()=>conv}),true);assert.equal(bindings,1);
for(const mutate of [c=>c.agent_id='agent_other',c=>c.branch_id='agtbrch_other',c=>c.user_id='foreign',c=>c.metadata.phone_call.call_sid='CA'+'f'.repeat(32),c=>c.metadata.phone_call.external_number='+12125550999']){const bad=structuredClone(conv);mutate(bad);await assert.rejects(ensureRecordedConversationBinding(token,'conv_fixture',bindDb,enabled,{conversation:async()=>bad}));}assert.equal(bindings,1);
console.log('PASS recording-aware tools: default-off legacy path, exact capability/provider/account/branch/version/number identity before DB binding');
// A provider recording failure also ends a required-recording call.
reset();row.state='recording';row.consent_at=iso;row.start_claimed_at=iso;row.recording_sid=re;row.provider_started_at=iso;
const statusUrl=recordingBaseUrl+'/status?id='+id,callback=new URLSearchParams({AccountSid:ac,CallSid:ca,RecordingSid:re,RecordingStatus:'absent'});
const signature=createHmac('sha1',env.TWILIO_AUTH_TOKEN).update(statusUrl+[...callback.keys()].sort().map(k=>k+callback.get(k)).join('')).digest('base64');
const statusDb=async(path,method,b)=>b?.p_action==='absent'?(row={...row,state:'absent'}):db(path,method,b);
const failedAudio=recordingService(env,{db:statusDb,provider:{...provider,getRecording:async()=>({sid:re,account_sid:ac,call_sid:ca,status:'absent'})},now:()=>now});
assert.equal((await failedAudio.status(new Request(statusUrl,{method:'POST',headers:{'x-twilio-signature':signature},body:callback}))).status,204);assert(calls.some(x=>x.provider==='end'));
console.log('PASS missing required audio triggers bound call termination rather than an unrecorded continuation');
const {settleRecordedVoice}=await import('../lib/required-call-recording-billing.ts');
reset();row.state='available';row.conversation_id='conv_recorded';row.recording_sid=re;row.duration_seconds=60;row.consent_at=iso;row.start_claimed_at=iso;row.provider_started_at=iso;row.ended_at=new Date(now+60000).toISOString();
let ledgerCalls=0;const billingDb=async()=>{ledgerCalls++;return [{conversation_id:'conv_other',operation_key:'voice:other'}];};
const recordingUsagePolicy={enabled:true,version:'required-audio-30d-speech-v1:fixture',rateId:row.rate_id,components:{other:{kind:'recording_addon_estimate',policyVersion:'required-audio-30d-speech-v1',evidenceRef:'fixture reviewed recording allowance'}}};
assert.equal((await settleRecordedVoice(billingDb,account,id,row,[recordingUsagePolicy],env)).reason,'recording_call_binding_required');assert.equal(ledgerCalls,1);
assert.equal((await settleRecordedVoice(billingDb,account,id,row,[{...recordingUsagePolicy,components:{other:{kind:'fixed_estimate',amountMicros:0}}}],env)).reason,'recording_cost_policy_required');assert.equal(ledgerCalls,1);
console.log('PASS recorded billing rejects cross-call audio costs and zero/mixed add-on policies before settlement');
// Successful recording-stop is NOT a successful required-call termination.
reset();row.state='recording';row.consent_at=iso;row.start_claimed_at=iso;row.recording_sid=re;row.provider_started_at=iso;row.conversation_id='conv_fixture';row.audio_expires_at=new Date(now+30*86400000).toISOString();failedEnd=true;
const partial=await service.stop(new Request(recordingBaseUrl+'/stop',{method:'POST',headers:{authorization:token},body:JSON.stringify({recordingId:id})}));assert.equal(partial.status,503);assert.deepEqual((({stopped,callEnded})=>({stopped,callEnded}))(await partial.json()),{stopped:true,callEnded:false});assert(row.end_requested_at);assert(!row.call_ended_at);
failedEnd=false;row.reconcile_lease_token=id;let recoveryFinishes=0;
const recoveryDb=async(path,method,b)=>path==='rpc/icash_claim_call_recording_work'?(b.p_kind==='reconcile'?[structuredClone(row)]:[]):path==='rpc/icash_finish_call_recording_work'?(recoveryFinishes++,row):db(path,method,b);
const recoveryProvider={...provider,getRecording:async()=>({sid:re,account_sid:ac,call_sid:ca,status:'completed',start_time:iso,duration:'1',price:'-0.002500',price_unit:'USD'})};
await maintainRecordings(recoveryDb,recoveryProvider,env);assert(row.call_ended_at);assert.equal(recoveryFinishes,1);assert(calls.filter(x=>x.provider==='end').length>=2);
console.log('PASS withdrawal partial success returns503 and leaves durable end-call retry that later confirms termination');
// Provider in-progress callback can persist the identical binding before start POST returns.
reset();const racingProvider={...provider,start:async()=>{calls.push({provider:'start'});row.state='recording';row.recording_sid=re;row.provider_started_at=iso;row.audio_expires_at=new Date(now+30*86400000).toISOString();return {sid:re,account_sid:ac,call_sid:ca,status:'in-progress',start_time:iso};}};
const raced=await recordingService(env,{db,provider:racingProvider,now:()=>now}).consent(request());assert((await raced.text()).includes('<Connect>'));assert.equal(calls.filter(x=>x.provider==='register').length,1);
console.log('PASS identical authenticated start-callback race is adopted without duplicate recording/registration');
