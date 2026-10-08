import {selectBusinessCaller,secondaryBusinessPhone} from '../lib/business-voice-numbers.ts';
import {sellerOfferPresentation} from '../lib/seller-offer-presentation.ts';
import {VoiceActivationBudgetError} from '../lib/voice-budget-failure.ts';
import {loadSellerClosingContext} from '../lib/seller-closing-context.ts';
import {sellerContractToolId} from '../lib/seller-contract-tool.ts';
import {automaticOfferReceptionPrompt,streamingAutomaticOfferReceptionPrompt,legacyAutomaticOfferReceptionPrompt} from '../lib/seller-agreement-reception.ts';
import {automaticOfferGuardrails,automaticOfferPolicy} from '../lib/automatic-offer-policy.ts';
process.env.ICASH_LIVE_WORK_READY='true'; // Ready-state provider fixtures only.
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {sameBusinessNumber,consistentTextSenders} from '../lib/number-continuity.ts';
import {boundedVoiceSmsContext,voiceSmsInstructions} from '../lib/voice-sms-context.ts';
import {buyerCallInstructions,buyerFirstMessage} from '../lib/buyer-call-policy.ts';
import {contactEligibility,callEligibility,nextContactWindow,verifiedOfferCeiling} from '../lib/live-dispatch-policy.ts';
import {evaluateLaunch} from '../lib/launch-readiness-policy.ts';
import {canonical,object,readRecordingReview,recordingAgentMatches,recordingPolicy,sha} from '../lib/required-call-recording.ts';
import {sellerFirstMessage,sellerCallPrompt,sellerCallContext} from '../lib/seller-call-context.ts';
const dstPermission={phone:'+12125550123',timezone:'America/Chicago',local_start_hour:9,local_end_hour:20,permission_until:'2026-12-01T00:00:00Z',dnc_checked_at:null,dnc_clear:false,revoked_at:null,sellerConsentVerified:true};
assert.equal(nextContactWindow(dstPermission,Date.parse('2026-11-01T02:30:00Z')),'2026-11-01T15:00:00.000Z','DST fall-back schedules local 9 AM');
assert.equal(nextContactWindow({...dstPermission,permission_until:'2026-11-01T14:00:00Z'},Date.parse('2026-11-01T02:30:00Z')),null,'never schedule beyond consent');
assert.equal(nextContactWindow({...dstPermission,timezone:'invalid'},Date.parse('2026-11-01T02:30:00Z')),null);
const now=Date.parse('2026-09-29T16:00:00Z');
const realNow=Date.now;Date.now=()=>now;
const snapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:100000,raw:{data:{dm_property_id:'prop_123',full_address:'Fixture only',estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:50000}}};
let permission={id:'permission',account_id:'account',screening_id:'screening',party:'seller',phone:'+12125550123',contact_key:createHash('sha256').update('+12125550123').digest('hex'),timezone:'America/Chicago',local_start_hour:9,local_end_hour:20,permission_until:new Date(now+86400000).toISOString(),dnc_checked_at:new Date(now-1000).toISOString(),dnc_clear:true,revoked_at:null};
assert.equal(callEligibility(permission,snapshot,now).ready,true);
assert.equal(callEligibility({...permission,revoked_at:new Date(now).toISOString()},snapshot,now).ready,false);
assert.equal(callEligibility({...permission,dnc_checked_at:new Date(now+1000).toISOString()},snapshot,now).ready,false);
assert.equal(callEligibility({...permission,timezone:'bogus'},snapshot,now).ready,false);
assert.equal(callEligibility({...permission,timezone:'Pacific/Honolulu'},snapshot,now).reason,'outside_contact_hours');
assert.equal(callEligibility(permission,{...snapshot,fetchedAt:new Date(now-86400001).toISOString()},now).reason,'fresh_screening_required');
assert.equal(verifiedOfferCeiling(9000000,{max_offer_cents:8000000,expires_at:new Date(now+1000).toISOString()},now),8000000);
assert.equal(verifiedOfferCeiling(9000000,undefined,now),null);
assert.equal(verifiedOfferCeiling(9000000,{max_offer_cents:8000000,expires_at:new Date(now-1).toISOString()},now),null);
const config={asr:{user_input_audio_format:'ulaw_8000'},tts:{voice_id:'voice',agent_output_audio_format:'ulaw_8000'},conversation:{max_duration_seconds:600},agent:{prompt:{tool_ids:['tool_callback','tool_handoff','tool_stop']}}};
const agent={agent_id:'agent_fixture',branch_id:'agtbrch_fixture',main_branch_id:'agtbrch_main',version_id:'agtvrsn_fixture',conversation_config:config,platform_settings:{privacy:{record_voice:false},auth:{enable_auth:true},call_limits:{bursting_enabled:false},queueing_config:{enabled:false},overrides:{conversation_config_override:{conversation:{max_duration_seconds:true},agent:{first_message:true,prompt:{prompt:true}},tts:{voice_id:true}}}},workflow:{nodes:[],edges:[]},procedures:[]};
const review={enabled:true,reviewedAt:new Date(now-1000).toISOString(),reviewedUntil:new Date(now+100000).toISOString(),agentId:agent.agent_id,branchId:agent.branch_id,versionId:agent.version_id,configHash:sha(JSON.stringify(canonical({conversation_config:agent.conversation_config,platform_settings:agent.platform_settings,workflow:agent.workflow,procedures:agent.procedures}))),fromPhone:'+14243948384',providerAccountSid:'AC'+'a'.repeat(32),stopToolId:'tool_stop',toolIds:['tool_callback','tool_handoff','tool_stop'],approvedHoldCents:recordingPolicy.minimumHoldCents,retentionDays:30,maxTotalSeconds:600,policyVersion:recordingPolicy.version};
const configTemplate={enabled:true,agent_id:review.agentId,phone_number_id:'number',agent_config_hash:review.configHash,reviewed_until:new Date(now+100000).toISOString(),seller_rate_id:'rate',buyer_rate_id:'buyer-rate',max_duration_seconds:600,required_tool_ids:review.toolIds,approved_voice_ids:[]};
let textThreads=[{sender:'+14243948384'}],secondEnabled=false,secondVerified=false;
const secondaryCallingReady=async()=>secondVerified;
let reservationError=null,budgetHoldAccepted=true,flexibleFunding={maxSeconds:120};
let sellerConsentCurrent=true;
let customVoice=null;
const selectedCustomCallVoice=async()=>customVoice;
let c=structuredClone(configTemplate),providerAgent=structuredClone(agent),providerPaths=[],agentReadFailed=false,identityVoice='voice';
let providerReads=0,flipAt=null,flip=()=>{},legacyRate=false,recordingStatus='recording_consent_pending';
let outboundBody,contextOverrides=true,operational=false,operationalCurrent=true;
let buyerApproved=true,callbackId=null,providerNumber='+14243948384',suppressed=false,paced=true;let records=[],postCount=0,allowClaim=true,paused=false,timeout=false,jobState='issued',practice=false,quoteSeconds=600;
const db=async(path,method,body)=>{
 records.push({path,method,body});
 if(flipAt===path||flipAt==='final-patch'&&method==='PATCH'&&body.sms_context!==undefined)flip();
 if(path==='rpc/icash_hold_voice_job'){if(jobState===(body.p_after_claim?'dispatching':'issued'))jobState='held';return true;}
 if(path.startsWith('icash_text_suppressions'))return suppressed?[{phone:permission.phone}]:[];
 if(path==='rpc/icash_property_voice_threads'){assert.equal(body.p_account,'account');assert.equal(body.p_screening,'screening');assert.equal(body.p_phone,permission.phone);return textThreads;}
 if(path.startsWith('icash_business_voice_numbers'))return [{outbound_enabled:secondEnabled}];
 if(path==='rpc/icash_voice_sms_context')return null;
 if(path==='rpc/icash_seller_voice_permission_current')return sellerConsentCurrent;
 if(path==='rpc/icash_operational_contact_current'){assert.equal(body.p_account,'account');assert.equal(body.p_contact,'operational');assert.equal(body.p_channel,'voice');return operationalCurrent;}
 if(path==='rpc/icash_reserve_flexible_voice')return flexibleFunding;
 if(path==='rpc/icash_reserve_paced_voice'){if(reservationError)throw reservationError;return paced;}
 if(path==='rpc/icash_hold_voice_activation_budget'){if(budgetHoldAccepted)jobState='held';return budgetHoldAccepted;}
 if(method==='PATCH'){if(body.state==='held'&&path.includes(`state=eq.${jobState}`))jobState='held';return [];}
 if(path.startsWith('icash_voice_jobs'))return [{id:'job',account_id:'account',permission_id:operational?null:'permission',operational_contact_id:operational?'operational':null,callback_id:callbackId,state:jobState}];
 if(path.startsWith('icash_voice_configs'))return [c];
 if(path.startsWith('icash_contact_permissions')||path.startsWith('icash_voice_contact_targets'))return [{...permission,id:operational?'operational':permission.id}];
 if(path.startsWith('icash_deal_files'))return [];
 if(path.startsWith('icash_screening_jobs'))return [{snapshot}];
 if(path.startsWith('icash_customer_identities'))return [{principal:'Fixture Buyer',voice_id:identityVoice}];
 if(path.startsWith('icash_accounts'))return [{assistant_name:'Alex',bot_paused:paused}];
 if(path.startsWith('icash_voice_test_config'))return practice?[{agent_id:c.agent_id}]:[];
 if(path==='rpc/icash_buyer_voice_context')return buyerApproved?{dealId:'deal',address:'Fixture',askingPriceCents:10000000,repairsCents:100000,packageId:'doc'}:null;
 if(path.startsWith('icash_operation_rates'))return [{operation:permission.party==='buyer'?'buyer_call':'seller_call',enabled:true,expires_at:c.reviewed_until,voice_max_duration_seconds:quoteSeconds,charge_cents:legacyRate?946:recordingPolicy.minimumHoldCents,version:legacyRate?'staged-seller-20260930-us-600s-v1':recordingPolicy.version+':fixture'}];
 if(path.startsWith('icash_offer_authorities'))return [];
 if(path==='rpc/icash_claim_automatic_offer_voice_job'){assert.equal(permission.party,'seller');assert.equal(body.p_job,'job');assert.deepEqual(body.p_snapshot,snapshot);assert.equal(body.p_offer_price_cents,10200000);if(allowClaim)jobState='dispatching';return allowClaim;}
 if(path==='rpc/icash_claim_reviewed_voice_job'){if(allowClaim)jobState='dispatching';return allowClaim;}
 if(path.startsWith('icash_live_conversations?')){assert(path.includes('account_id=eq.account&screening_id=eq.screening&contact_key=eq.'));assert(path.includes('party=eq.seller&state=eq.complete&operation_key=like.voice:*'));return [];}
 if(path==='icash_live_conversations')return [];
 throw Error('Unexpected request '+path);
};
const elevenRequest=async(path,body)=>{providerReads++;providerPaths.push(path);assert.equal(body,undefined,'No legacy direct dial, even if recording dispatch fails');if(path.includes('/phone-numbers/'))return {phone_number:providerNumber};assert.equal(path,`/v1/convai/agents/${review.agentId}?branch_id=${review.branchId}`,'Never read main instead of the reviewed recorded branch');if(agentReadFailed)throw Error('Synthetic metadata read failure');const result=structuredClone(providerAgent);if(!contextOverrides)result.platform_settings.overrides.conversation_config_override.agent={first_message:false,prompt:{prompt:false}};return result;};
const recordingServer=()=>({dispatch:async input=>{outboundBody=input;postCount++;if(timeout)return {status:'recording_dial_unknown_no_retry'};return {status:recordingStatus};}});
globalThis.__voiceTest={selectBusinessCaller,secondaryBusinessPhone,secondaryCallingReady,sellerOfferPresentation,VoiceActivationBudgetError,selectedCustomCallVoice,recordingServer,object,readRecordingReview,recordingAgentMatches,recordingPolicy,sameBusinessNumber,consistentTextSenders,boundedVoiceSmsContext,voiceSmsInstructions,createHash,randomBytes,db,elevenRequest,reserveOperation:async()=>records.push({reserve:true}),contactEligibility,nextContactWindow,buyerCallInstructions,buyerFirstMessage,callEligibility,verifiedOfferCeiling,sellerFirstMessage,sellerCallPrompt,sellerCallContext,automaticOfferReceptionPrompt,loadSellerClosingContext,sellerContractToolId,legacyAutomaticOfferReceptionPrompt,streamingAutomaticOfferReceptionPrompt,automaticOfferPolicy};
let source=ts.transpileModule(readFileSync(new URL('../lib/live-dispatch-service.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
source='const {selectBusinessCaller,secondaryBusinessPhone,secondaryCallingReady,sellerOfferPresentation,VoiceActivationBudgetError,selectedCustomCallVoice,recordingServer,object,readRecordingReview,recordingAgentMatches,recordingPolicy,sameBusinessNumber,consistentTextSenders,boundedVoiceSmsContext,voiceSmsInstructions,createHash,randomBytes,db,elevenRequest,reserveOperation,contactEligibility,nextContactWindow,buyerCallInstructions,buyerFirstMessage,callEligibility,verifiedOfferCeiling,sellerFirstMessage,sellerCallPrompt,sellerCallContext,automaticOfferReceptionPrompt,loadSellerClosingContext,sellerContractToolId,legacyAutomaticOfferReceptionPrompt,streamingAutomaticOfferReceptionPrompt,automaticOfferPolicy}=globalThis.__voiceTest;\n'+source;
const {dispatchLiveVoice}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
process.env.ELEVENLABS_API_KEY='fixture-no-network';process.env.CONTIGUITY_FROM='+14243948384';
const reset=()=>{textThreads=[{sender:'+14243948384'}];secondEnabled=false;secondVerified=false;delete process.env.ICASH_FLEXIBLE_VOICE_READY;flexibleFunding={maxSeconds:120};reservationError=null;budgetHoldAccepted=true;c=structuredClone(configTemplate);providerAgent=structuredClone(agent);providerPaths=[];agentReadFailed=false;identityVoice='voice';providerReads=0;flipAt=null;flip=()=>{};legacyRate=false;recordingStatus='recording_consent_pending';Object.assign(process.env,{ICASH_LIVE_WORK_READY:'true',ICASH_RECORDED_OUTBOUND_READY:'true',ICASH_RECORDING_RECEIPTS_READY:'true',RECORDED_OUTBOUND_REVIEW_JSON:JSON.stringify(review),TWILIO_ACCOUNT_SID:review.providerAccountSid,TWILIO_AUTH_TOKEN:'synthetic-provider-token'});operational=false;operationalCurrent=true;contextOverrides=true;outboundBody=undefined;buyerApproved=true;records=[];postCount=0;allowClaim=true;paused=false;timeout=false;jobState='issued';practice=false;quoteSeconds=600;callbackId=null;providerNumber='+14243948384';suppressed=false;paced=true;};
reset();reservationError=new VoiceActivationBudgetError();assert.equal((await dispatchLiveVoice('account','job')).status,'activation_budget_held');assert.equal(jobState,'held');assert.equal(postCount,0);assert(!records.some(r=>r.path?.startsWith('rpc/icash_claim_')));assert.equal((await dispatchLiveVoice('account','job')).status,'held');assert.equal(postCount,0);
reset();reservationError=new Error('Ambiguous network failure');await assert.rejects(()=>dispatchLiveVoice('account','job'),/Ambiguous network failure/);assert(!records.some(r=>r.path==='rpc/icash_hold_voice_activation_budget'));assert.equal(postCount,0);
reset();reservationError=new VoiceActivationBudgetError();budgetHoldAccepted=false;await assert.rejects(()=>dispatchLiveVoice('account','job'),VoiceActivationBudgetError);assert.equal(postCount,0);
reset();providerAgent.platform_settings.guardrails=automaticOfferGuardrails();providerAgent.conversation_config.agent.prompt.tool_ids.push('tool_automatic');
const automaticReview={...review,offerPolicy:'automatic_offer_v6',contractToolId:'tool_automatic',toolIds:[...providerAgent.conversation_config.agent.prompt.tool_ids],configHash:sha(JSON.stringify(canonical({conversation_config:providerAgent.conversation_config,platform_settings:providerAgent.platform_settings,workflow:providerAgent.workflow,procedures:providerAgent.procedures})))};
c.agent_config_hash=automaticReview.configHash;c.required_tool_ids=automaticReview.toolIds;process.env.RECORDED_OUTBOUND_REVIEW_JSON=JSON.stringify(automaticReview);
assert.equal((await dispatchLiveVoice('account','job')).status,'call_started');assert.match(outboundBody.prompt,/icash_offer_and_contract get_offer/);assert.match(outboundBody.prompt,/Fixture only/);assert(!outboundBody.prompt.includes('PRIVATE SERVER NEGOTIATION AUTHORITY'));assert(!outboundBody.prompt.includes('10200000'),'the runtime prompt does not leak a cached price around the offer tool');
reset();assert.equal((await dispatchLiveVoice('account','job')).status,'call_started');assert.equal(postCount,1);
assert.match(outboundBody.firstMessage,/Is this the owner of Fixture only/);
assert.equal(outboundBody.operationKey,'voice:job');
assert.match(outboundBody.prompt,/PRIVATE SERVER NEGOTIATION AUTHORITY/);
assert(!Object.hasOwn(outboundBody,'call_recording_enabled'));
assert(!records.some(r=>r.path==='icash_live_conversations'&&r.method==='POST'),'Only verified recording service may create the live binding');
assert.deepEqual(providerPaths,[`/v1/convai/phone-numbers/${c.phone_number_id}`,`/v1/convai/agents/${review.agentId}?branch_id=${review.branchId}`]);
reset();process.env.ICASH_FLEXIBLE_VOICE_READY='true';assert.equal((await dispatchLiveVoice('account','job')).status,'call_started');assert.equal(outboundBody.maxTotalSeconds,120,'funded duration reaches carrier dispatch');assert(!records.some(r=>r.path==='rpc/icash_reserve_paced_voice'));
reset();process.env.ICASH_FLEXIBLE_VOICE_READY='true';flexibleFunding=null;assert.equal((await dispatchLiveVoice('account','job')).status,'waiting_for_available_credits');assert.equal(postCount,0);
const noAdmission=()=>{assert.equal(postCount,0);assert(!records.some(r=>['rpc/icash_reserve_paced_voice','rpc/icash_claim_reviewed_voice_job','rpc/icash_claim_automatic_offer_voice_job'].includes(r.path)));assert.equal(jobState,'held');};
// Recorded account configs must match the review, including exact tool set and cap.
// Legacy conversation hashes and two-tool configs stay fail-closed in this lane.
for(const mutate of [
 c=>c.agent_id='agent_other',c=>c.agent_config_hash=sha(JSON.stringify(config)),c=>c.agent_config_hash='f'.repeat(64),
 c=>c.max_duration_seconds=599,c=>c.max_duration_seconds=601,c=>c.max_duration_seconds='600',
 c=>c.required_tool_ids=review.toolIds.slice(0,2),c=>c.required_tool_ids=[...review.toolIds,'tool_extra'],
 c=>c.required_tool_ids=['tool_callback','tool_handoff','tool_unreviewed'],c=>c.required_tool_ids=['tool_callback','tool_handoff','tool_handoff'],
 c=>c.required_tool_ids=null,c=>delete c.required_tool_ids,
]){reset();mutate(c);assert.equal((await dispatchLiveVoice('account','job')).status,'recorded_call_review_required');assert.equal(providerReads,0);noAdmission();}
reset();c.required_tool_ids.reverse();assert.equal((await dispatchLiveVoice('account','job')).status,'call_started','Config tool-set order is immaterial');
// Unlike legacy JSON serialization, canonical review projection ignores key order.
const reverseKeys=value=>Array.isArray(value)?value.map(reverseKeys):value!==null&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reverseKeys(item)])):value;
reset();providerAgent=reverseKeys(providerAgent);assert.equal((await dispatchLiveVoice('account','job')).status,'call_started');
// The actual returned branch/version and full projection are checked for both parties.
const agentMutations=[
 a=>a.agent_id='agent_other',a=>a.branch_id=a.main_branch_id,a=>a.main_branch_id=a.branch_id,a=>a.version_id='agtvrsn_other',
 a=>delete a.main_branch_id,a=>a.main_branch_id=null,a=>a.main_branch_id='',a=>a.main_branch_id='main',
 a=>a.main_branch_id=123,a=>a.main_branch_id=['agtbrch_main'],a=>a.main_branch_id='agtbrch_main?unexpected=1',
 a=>a.conversation_config.conversation.max_duration_seconds=599,a=>a.conversation_config.conversation.max_duration_seconds=601,
 a=>a.conversation_config.agent.prompt.tool_ids.pop(),a=>a.conversation_config.agent.prompt.tool_ids.push('tool_extra'),
 a=>a.conversation_config.agent.prompt.tool_ids[2]='tool_handoff',a=>a.conversation_config.agent.prompt.tool_ids[2]='tool_unreviewed',
 a=>a.conversation_config.asr.user_input_audio_format='pcm_16000',a=>a.conversation_config.tts.agent_output_audio_format='pcm_16000',
 a=>a.conversation_config.agent.prompt.prompt='Unreviewed prompt',a=>a.platform_settings.privacy.record_voice=true,
 a=>a.platform_settings.auth.enable_auth=false,a=>a.platform_settings.call_limits.bursting_enabled=true,a=>a.platform_settings.queueing_config.enabled=true,
 a=>a.platform_settings.overrides.conversation_config_override.agent.first_message=false,a=>a.platform_settings.overrides.conversation_config_override.agent.prompt.prompt=false,
 a=>a.platform_settings.overrides.conversation_config_override.conversation.max_duration_seconds=false,a=>a.platform_settings.overrides.conversation_config_override.tts.voice_id=false,
 a=>a.workflow.nodes.push({id:'unreviewed'}),a=>a.procedures.push({id:'unreviewed'}),
];
for(const mutate of agentMutations){reset();mutate(providerAgent);assert.equal((await dispatchLiveVoice('account','job')).status,'production_agent_review_required');noAdmission();}
permission={...permission,party:'seller'};
for(const malformed of [null,{},[],{conversation_config:null}]){reset();providerAgent=malformed;assert.equal((await dispatchLiveVoice('account','job')).status,'production_agent_review_required');noAdmission();}
reset();agentReadFailed=true;assert.equal((await dispatchLiveVoice('account','job')).status,'production_agent_review_required');noAdmission();
reset();identityVoice='unapproved-voice';assert.equal((await dispatchLiveVoice('account','job')).status,'voice_selection_setup_required');noAdmission();
reset();identityVoice='approved-voice';c.approved_voice_ids=[identityVoice];assert.equal((await dispatchLiveVoice('account','job')).status,'call_started');assert.equal(outboundBody.voiceId,identityVoice);
reset();customVoice='custom_fixture';assert.equal((await dispatchLiveVoice('account','job')).status,'call_started');assert.equal(outboundBody.voiceId,'custom_fixture');customVoice=null;
console.log('PASS recorded dispatch: exact non-main branch/version and canonical full projection, matching account config/hash/600-second cap/three-tool set, malformed metadata and drift held before reserve or dial; approved voice policy retained');
reset();contextOverrides=false;assert.equal((await dispatchLiveVoice('account','job')).status,'production_agent_review_required');assert.equal(postCount,0);assert(!records.some(r=>r.path==='rpc/icash_reserve_paced_voice'));
reset();paused=true;await dispatchLiveVoice('account','job');assert.equal(postCount,0);assert(!records.some(r=>r.reserve));
reset();practice=true;assert.equal((await dispatchLiveVoice('account','job')).status,'practice_agent_blocked');assert.equal(postCount,0);
reset();quoteSeconds=60;assert.equal((await dispatchLiveVoice('account','job')).status,'full_call_cost_quote_required');assert.equal(postCount,0);
reset();allowClaim=false;await dispatchLiveVoice('account','job');assert.equal(postCount,0);
reset();timeout=true;assert.equal((await dispatchLiveVoice('account','job')).status,'provider_outcome_unknown_no_retry');assert.equal(jobState,'dispatching');await dispatchLiveVoice('account','job');assert.equal(postCount,1,'uncertain dial must never retry');
const readiness=evaluateLaunch({cashReserve:true,discovery:true,voice:true,contactPermission:true,productionContracts:true,unresolvedDispatches:false},{data:true,voice:true,email:true,billing:true});assert.equal(readiness.acquisitionReady,true);assert.equal(readiness.ready,true);assert.deepEqual(readiness.blockers,[]);
assert(evaluateLaunch({cashReserve:true,discovery:true,voice:true,contactPermission:true,productionContracts:true,unresolvedDispatches:false},{data:true,voice:false,email:true,billing:true}).blockers.includes('voiceProvider'));
for(const flexible of [false,true])for(const callback of [null,'callback']){
 reset();permission={...permission,party:'buyer'};callbackId=callback;process.env.ICASH_FLEXIBLE_VOICE_READY=String(flexible);
 assert.equal((await dispatchLiveVoice('account','job')).status,'buyer_outbound_calls_disabled');
 assert.equal(providerReads,0);noAdmission();assert(!records.some(r=>r.path==='rpc/icash_reserve_flexible_voice'));
}
permission={...permission,party:'seller'};
reset();providerNumber='+12125550100';assert.equal((await dispatchLiveVoice('account','job')).status,'business_number_mismatch');assert.equal(postCount,0);
reset();suppressed=true;assert.equal((await dispatchLiveVoice('account','job')).status,'contact_opted_out');assert.equal(postCount,0);
reset();paced=false;buyerApproved=true;assert.equal((await dispatchLiveVoice('account','job')).status,'waiting_for_daytime_budget');assert.equal(postCount,0);
reset();permission={...permission,timezone:'Pacific/Honolulu'};const scheduled=await dispatchLiveVoice('account','job');assert.equal(scheduled.dueAt,'2026-09-29T19:00:00.000Z');assert(records.some(r=>r.method==='PATCH'&&r.body?.outcome==='Waiting for calling hours'));assert.equal(postCount,0);
reset();callbackId='callback';permission={...permission,timezone:'Pacific/Honolulu'};assert.equal((await dispatchLiveVoice('account','job')).status,'outside_contact_hours');assert.equal(jobState,'held');assert(!records.some(r=>r.method==='PATCH'&&r.body?.due_at),'Do not silently move an agreed callback');
reset();permission={...permission,party:'seller',timezone:'America/Chicago'};operational=true;assert.equal((await dispatchLiveVoice('account','job')).status,'call_started');assert.equal(postCount,1);assert(records.some(r=>r.path.startsWith('icash_voice_contact_targets')));assert(!records.some(r=>r.path==='icash_contact_permissions'&&r.method==='POST'));
reset();operational=true;operationalCurrent=false;assert.equal((await dispatchLiveVoice('account','job')).status,'contact_operating_checks_required');assert.equal(postCount,0);assert(!records.some(r=>r.path==='rpc/icash_reserve_paced_voice'));
reset();operational=true;allowClaim=false;await dispatchLiveVoice('account','job');assert.equal(postCount,0,'Operational contacts still need the final atomic claim');
// Legacy enabled configuration/rate cannot start seller, buyer, callback, or operational calls.
for(const party of ['seller','buyer'])for(const operationalTarget of [false,true])for(const callback of [null,'callback']){
 reset();permission={...permission,party};operational=operationalTarget;callbackId=callback;legacyRate=true;process.env.ICASH_RECORDED_OUTBOUND_READY='false';
 assert.equal((await dispatchLiveVoice('account','job')).status,party==='buyer'?'buyer_outbound_calls_disabled':'recorded_call_release_required');assert.equal(providerReads,0);assert.equal(postCount,0);
 assert(!records.some(r=>['rpc/icash_reserve_paced_voice','rpc/icash_claim_reviewed_voice_job','rpc/icash_claim_automatic_offer_voice_job'].includes(r.path)));assert.equal(jobState,'held');
}
permission={...permission,party:'seller'};
for(const change of [()=>delete process.env.ICASH_RECORDED_OUTBOUND_READY,()=>process.env.ICASH_RECORDING_RECEIPTS_READY='false',()=>process.env.RECORDED_OUTBOUND_REVIEW_JSON='invalid',()=>process.env.TWILIO_ACCOUNT_SID='AC'+'b'.repeat(32),()=>delete process.env.TWILIO_AUTH_TOKEN]){
 reset();change();assert.notEqual((await dispatchLiveVoice('account','job')).status,'call_started');assert.equal(providerReads,0);assert.equal(postCount,0);assert(!records.some(r=>r.path==='rpc/icash_reserve_paced_voice'));
}
reset();legacyRate=true;assert.equal((await dispatchLiveVoice('account','job')).status,'recorded_call_review_required');assert.equal(postCount,0);assert(!records.some(r=>r.path==='rpc/icash_reserve_paced_voice'));
// Recheck after asynchronous context/reservation/claim work. No cached release can dial.
permission={...permission,party:'seller'};
for(const at of ['rpc/icash_voice_sms_context','rpc/icash_reserve_paced_voice','final-patch'])for(const change of [()=>process.env.ICASH_RECORDED_OUTBOUND_READY='false',()=>process.env.ICASH_RECORDING_RECEIPTS_READY='false',()=>process.env.ICASH_LIVE_WORK_READY='false',()=>process.env.RECORDED_OUTBOUND_REVIEW_JSON=JSON.stringify({...review,versionId:'agtvrsn_changed'})]){
 reset();flipAt=at;flip=change;assert.notEqual((await dispatchLiveVoice('account','job')).status,'call_started');assert.equal(postCount,0);
 if(at==='rpc/icash_voice_sms_context')assert(!records.some(r=>r.path==='rpc/icash_reserve_paced_voice'));
 if(at!=='final-patch')assert(!records.some(r=>['rpc/icash_claim_reviewed_voice_job','rpc/icash_claim_automatic_offer_voice_job'].includes(r.path)));
 assert.equal(records.at(-1).body.p_after_claim,at==='final-patch','Only the owned dispatch claim may be held');
}
for(const status of ['recording_review_required','recording_admission_held','recording_release_required']){
 reset();recordingStatus=status;assert.equal((await dispatchLiveVoice('account','job')).status,status);assert.equal(postCount,1);assert.equal(providerReads,2);assert.equal(jobState,'held');
}
console.log('PASS mandatory customer recording: legacy946 enabled config holds all seller/buyer/callback/operational paths, no provider/reserve/claim when capture OFF, exact reviewed rate, late release changes, no fallback or premature recording claim');
reset();permission={...permission,seller_intake_id:'saved-intake',dnc_clear:false,dnc_checked_at:null};
assert.equal((await dispatchLiveVoice('account','job')).status,'call_started');assert.equal(postCount,1);
reset();sellerConsentCurrent=false;permission={...permission,sellerConsentVerified:true};
assert.equal((await dispatchLiveVoice('account','job')).status,'contact_operating_checks_required');noAdmission();
assert(records.some(r=>r.path==='rpc/icash_seller_voice_permission_current'),'Never trust a stored/client verification flag');
reset();sellerConsentCurrent=true;textThreads=[{sender:secondaryBusinessPhone,sender_pool_assigned:true}];assert.equal((await dispatchLiveVoice('account','job')).status,'call_started');assert.equal(outboundBody.fromPhone,'+14243948384');
reset();sellerConsentCurrent=true;textThreads=[{sender:secondaryBusinessPhone,sender_pool_assigned:true}];secondEnabled=true;secondVerified=true;assert.equal((await dispatchLiveVoice('account','job')).status,'call_started');assert.equal(outboundBody.fromPhone,secondaryBusinessPhone);assert(!providerPaths.some(p=>p.includes('/phone-numbers/')));
reset();sellerConsentCurrent=true;textThreads=[{sender:secondaryBusinessPhone,sender_pool_assigned:true}];secondEnabled=true;assert.equal((await dispatchLiveVoice('account','job')).status,'business_number_verification_required');assert.equal(postCount,0);
console.log('PASS secondary seller calls preserve text sender and first-number availability; revoked caller ID never dials');
delete process.env.CONTIGUITY_FROM;delete globalThis.__voiceTest;delete process.env.ELEVENLABS_API_KEY;Date.now=realNow;
console.log('Voice dispatch: permissions, hours, fresh underwriting, reviewed offer ceilings, full-duration costs, Stop, practice-agent isolation, uncertain-call no-retry and honest launch readiness passed. No provider traffic.');

// Empty permission records do not block the platform; dispatch still checks each contact.
const emptyContacts=evaluateLaunch({cashReserve:true,discovery:true,voice:true,contactPermission:false,productionContracts:true,unresolvedDispatches:false},{data:true,voice:true,email:true,billing:true});
assert.equal(emptyContacts.acquisitionReady,true);
assert(!emptyContacts.blockers.includes('contactPermission'));
assert.equal(emptyContacts.ready,true);
assert.equal(emptyContacts.ready,true);
