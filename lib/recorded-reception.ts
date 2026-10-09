import {buyerTurnPolicy,buyerTurnModelMatches} from './buyer-turn-policy.ts';
import {buyerResponsePolicy,buyerResponseModelMatches} from './buyer-response-policy.ts';
import {buyerVoicePolicy,buyerVoiceGuardrail} from './buyer-voice-policy.ts';
import {recordingAuthorized,directRecordedInstructions} from './direct-call-entry.ts';
import {automaticOfferGuardrailMatches,automaticOfferPolicy} from './automatic-offer-policy.ts';
import {sellerAgreementReceptionEnabled} from './seller-agreement-reception.ts';
import {sellerAgreementToolMatches} from './seller-agreement-tool.ts';
import {receptionContextPrompt,receptionContextVariables} from './reception-property-context.ts';
import {createHmac} from 'node:crypto';
import {inspectReceptionAgent,receptionTarget,receptionPrompt,type ReceptionConfig} from './general-reception.ts';
import {propertyReceptionEnabled,propertyReceptionPrompt} from './reception-property-context.ts';
import {canonical,object,sha,sid,uuid,recordingDisclosure,consentTwiml} from './required-call-recording.ts';

/** Candidate only. No configuration/rate is installed or enabled by this module. */
export const recordedReceptionPolicy='recorded-reception-30d-speech-v1';
export const recordedReceptionPricing=Object.freeze({version:recordedReceptionPolicy,retentionDays:30,recordingMicrosPerMinute:2500,storageMicrosPerMinuteMonth:500,speechGatherMicros:20000,streamMicrosPerMinute:4400,estimate:true});
export const recordedReceptionUrl='https://www.geticashx.com/api/reception/recorded';
export const recordedReceptionStopInstruction='\nRecording permission was verified before this conversation. If permission is withdrawn, someone asks to stop recording, another participant joins, or permission becomes unclear, immediately call icash_stop_reception_recording and end the call. Never continue unrecorded, restart recording, or claim a stop before confirmation. The stop tool only ends this exact call; it grants no other authority.';
export type RecordedReceptionConfig=ReceptionConfig&{id:string;provider_account_sid:string;stop_tool_id:string;rate_id:string;customer_charge_cap_cents:number;call_profile:'normal'|'owner_quick_test';owner_caller_hash?:string;approved_at:string;reviewed_until:string;policy_version:string;pricing_policy:Record<string,unknown>};
export type RecordedReceptionRow={id:string;account_id:string;operation_key:string;config_id:string;configuration:RecordedReceptionConfig;provider_account_sid:string;call_sid:string;from_phone:string;to_phone:string;caller_hash:string;nonce_hash:string;stop_token_hash:string;state:string;agent_id:string;branch_id:string;version_id:string;max_total_seconds:number;rate_id:string;charge_cap_cents:number;created_at:string;call_started_at:string|null;call_deadline_at:string;consent_deadline_at:string;consent_at:string|null;start_claimed_at:string|null;register_claimed_at:string|null;recording_sid:string|null;provider_started_at:string|null;ended_at:string|null;duration_seconds:number|null;audio_expires_at:string|null;deleted_at:string|null;conversation_id:string|null;end_requested_at:string|null;call_ended_at:string|null;provider_recording_price_micros:number|null;pricing_policy:Record<string,unknown>;[key:string]:unknown};
export type RecordedReceptionRpc=<T=unknown>(name:string,body?:Record<string,unknown>)=>Promise<T>;
export type RecordedReceptionEnv=Record<string,string|undefined>;
export const receptionStopToken=(row:Pick<RecordedReceptionRow,'operation_key'>,env:RecordedReceptionEnv)=>createHmac('sha256',env.TWILIO_AUTH_TOKEN!).update('icash-recorded-reception-stop-v1:'+row.operation_key).digest('hex');
export const receptionCallerHash=(from:string,env:RecordedReceptionEnv)=>createHmac('sha256',env.TWILIO_AUTH_TOKEN!).update('reception-caller-v1\0'+from).digest('hex');
export function validRecordedReceptionConfig(c:RecordedReceptionConfig|null,now=Date.now()):c is RecordedReceptionConfig{
 if(!c||c.disclosure_version!=='required-audio-30d-speech-2026-10-03'||JSON.stringify(canonical(c.pricing_policy))!==JSON.stringify(canonical(recordedReceptionPricing)))return false;
 if(!c||!uuid(c.id)||c.enabled!==true||c.account_id!==receptionTarget.accountId||c.owner_user_id!==receptionTarget.ownerUserId||c.called_number!==receptionTarget.calledNumber||c.agent_id!==receptionTarget.agentId||c.policy_version!==recordedReceptionPolicy||!sid(c.provider_account_sid,'AC')||!uuid(c.rate_id)||!/^tool_[A-Za-z0-9]+$/.test(c.stop_tool_id)||!/^agtbrch_[A-Za-z0-9]+$/.test(c.branch_id)||!/^agtvrsn_[A-Za-z0-9]+$/.test(c.reviewed_version_id)||!/^[a-f0-9]{64}$/.test(c.config_hash)||!Number.isSafeInteger(c.customer_charge_cap_cents)||c.customer_charge_cap_cents<1||c.funding_mode!=='customer_credits'||c.receipt_mode!=='provider_readback'||!(c.context_policy==='message_only'||propertyReceptionEnabled(c))||!Number.isFinite(Date.parse(c.approved_at))||Date.parse(c.approved_at)>now||!Number.isFinite(Date.parse(c.reviewed_until))||Date.parse(c.reviewed_until)<now+(c.max_duration_seconds+60)*1000)return false;
 return c.call_profile==='normal'&&c.max_duration_seconds===600||c.call_profile==='owner_quick_test'&&c.max_duration_seconds===60&&c.owner_quick_test_enabled===true&&typeof c.owner_quick_test_approval_reference==='string'&&c.owner_quick_test_approval_reference.trim().length>=10&&/^[a-f0-9]{64}$/.test(c.owner_caller_hash??'');
}
/** The database atomically binds the affordable hold to this exact call. */
export function validReceptionCreditBound(c:RecordedReceptionConfig,r:RecordedReceptionRow){
 const seconds=r.max_total_seconds,price=r.charge_cap_cents;
 return Number.isSafeInteger(price)&&price>0&&price<=c.customer_charge_cap_cents
  &&(c.call_profile==='owner_quick_test'?seconds===60&&price===c.customer_charge_cap_cents:
   Number.isInteger(seconds)&&seconds>=120&&seconds<=c.max_duration_seconds&&seconds%60===0);
}
export type ReceptionInlineToolEvidence={shape:'absent'|'array'|'invalid';count:number|null;reviewedStopDefinition:boolean;matchingStopCount:number;nativeEndCallCount:number;unrecognizedCount:number;bounded:boolean;entries:{kind:'native_end_call'|'reviewed_stop'|'unrecognized';type:'system'|'webhook'|'client'|'other';stopNameMatches:boolean;wrappedDefinitionPresent:boolean;definitionMatches:boolean}[]};
/** Only a direct canonical tool config, equal in every field to the separately
 * fetched and checked stop definition, may be removed from the base no-tools
 * comparison. Never remove by name, ID, URL, or an unchecked tool definition. */
export function recordedReceptionInlineToolEvidence(input:unknown,stopToolId:string,toolInput?:unknown):ReceptionInlineToolEvidence{
 const tools=object(object(object(object(input).conversation_config).agent).prompt).tools;
 const reviewedStopDefinition=recordedReceptionToolMatches(stopToolId,toolInput);
 const expected=reviewedStopDefinition?JSON.stringify(canonical(object(toolInput).tool_config)):null;
 const kind=(value:unknown):ReceptionInlineToolEvidence['entries'][number]=>{
  const t=object(value),definitionMatches=expected!==null&&JSON.stringify(canonical(value))===expected;
  const nativeEnd=t.type==='system'&&t.name==='end_call'&&object(t.params).system_tool_type==='end_call';
  return {kind:definitionMatches?'reviewed_stop':nativeEnd?'native_end_call':'unrecognized',type:t.type==='system'||t.type==='webhook'||t.type==='client'?t.type:'other',stopNameMatches:t.name==='icash_stop_reception_recording',wrappedDefinitionPresent:Object.hasOwn(t,'tool_config'),definitionMatches};
 };
 const absent=tools===undefined||tools===null,bounded=absent||Array.isArray(tools)&&tools.length<=8;
 // Fixed enum/boolean fields only: no provider-defined names, IDs, headers,
 // values, descriptions, payloads, URLs, or secret locators are returned.
 const entries=Array.isArray(tools)?tools.slice(0,8).map(kind):[];
 return {shape:absent?'absent':Array.isArray(tools)?'array':'invalid',count:absent?0:Array.isArray(tools)?Math.min(tools.length,1000):null,reviewedStopDefinition,matchingStopCount:entries.filter(t=>t.kind==='reviewed_stop').length,nativeEndCallCount:entries.filter(t=>t.kind==='native_end_call').length,unrecognizedCount:entries.filter(t=>t.kind==='unrecognized').length,bounded,entries};
}
/** Reuse every existing receptionist safety check after removing only the one
 * independently verified stop capability. Fingerprint the ORIGINAL object. */
export function inspectRecordedReceptionAgent(c:RecordedReceptionConfig,input:unknown,branch:unknown,workspaceAbsent:boolean,toolInput?:unknown,agreementToolInput?:unknown){
 const raw=object(input),a=structuredClone(raw),conversation=object(a.conversation_config),agent=object(conversation.agent),prompt=object(agent.prompt);
 const closing=sellerAgreementReceptionEnabled(c),agreementId=String(c.agreement_tool_id??'');
 const expectedIds=closing?[c.stop_tool_id,agreementId]:[c.stop_tool_id];
 const exactStop=new Set(expectedIds).size===expectedIds.length&&Array.isArray(prompt.tool_ids)&&prompt.tool_ids.length===expectedIds.length&&expectedIds.every(id=>(prompt.tool_ids as unknown[]).includes(id));
 let exactAgreement=!closing;
 if(closing&&sellerAgreementToolMatches(agreementToolInput,agreementId,c.context_policy)){
  const definition=JSON.stringify(canonical(object(agreementToolInput).tool_config));
  const matches=Array.isArray(prompt.tools)?prompt.tools.filter(t=>JSON.stringify(canonical(t))===definition):[];
  exactAgreement=matches.length<=1;
  if(exactAgreement&&Array.isArray(prompt.tools))prompt.tools=prompt.tools.filter(t=>JSON.stringify(canonical(t))!==definition);
 }
 const inlineTools=recordedReceptionInlineToolEvidence(a,c.stop_tool_id,toolInput);
 const inlineStopMatchesReviewedDefinition=inlineTools.bounded&&inlineTools.shape!=='invalid'&&inlineTools.matchingStopCount<=1&&inlineTools.unrecognizedCount===0;
 if(inlineStopMatchesReviewedDefinition&&Array.isArray(prompt.tools))prompt.tools=prompt.tools.filter((_,index)=>inlineTools.entries[index].kind!=='reviewed_stop');
 const expectedPrompt=propertyReceptionEnabled(c)?receptionContextPrompt(c):receptionPrompt;
 const responseModel=c.context_policy===buyerTurnPolicy?buyerTurnModelMatches(prompt):c.context_policy!==buyerResponsePolicy||buyerResponseModelMatches(prompt);
 const exactPrompt=prompt.prompt===expectedPrompt+(c.entry_policy==='direct_recorded_v1'?directRecordedInstructions:recordedReceptionStopInstruction);
 prompt.tool_ids=[];prompt.prompt=expectedPrompt;
 const base=inspectReceptionAgent({...c,config_hash:''},a,branch,workspaceAbsent);
 const snapshot={main_branch_id:raw.main_branch_id,agent_id:raw.agent_id,branch_id:raw.branch_id,version_id:raw.version_id,conversation_config:raw.conversation_config,platform_settings:raw.platform_settings,workflow:raw.workflow??null,procedures:raw.procedures??null};
 const hash=sha(JSON.stringify(canonical(snapshot)));
 const guardrails=object(raw.platform_settings).guardrails;
 const buyerGuards=object(object(object(guardrails).custom).config).configs;
 const priceEnforcement=(c.context_policy===buyerVoicePolicy||['automatic_offer_v11','automatic_offer_v12','automatic_offer_v13','automatic_offer_v14'].includes(String(c.context_policy)))?object(guardrails).version==='1'&&object(object(guardrails).focus).is_enabled===true&&Array.isArray(buyerGuards)&&buyerGuards.filter(g=>object(g).name===buyerVoiceGuardrail.name).length===1&&buyerGuards.some(g=>Object.entries(buyerVoiceGuardrail).every(([key,value])=>JSON.stringify(canonical(object(g)[key]))===JSON.stringify(canonical(value)))):!automaticOfferPolicy(c.context_policy)||automaticOfferGuardrailMatches(guardrails,c.context_policy);
 return {safe:responseModel&&exactStop&&exactAgreement&&exactPrompt&&priceEnforcement&&inlineStopMatchesReviewedDefinition&&Object.values(base.checks).every(Boolean)&&hash===c.config_hash,hash,checks:{...base.checks,responseModel,exactStop,exactAgreement,exactPrompt,priceEnforcement,inlineStopMatchesReviewedDefinition},inlineTools};
}
export function recordedReceptionToolMatches(id:string,input:unknown){
 const t=object(input),c=object(t.tool_config),a=object(c.api_schema),b=object(a.request_body_schema),p=object(b.properties),r=object(p.recordingId),h=object(object(a.request_headers).Authorization);
 return t.id===id&&c.type==='webhook'&&c.name==='icash_stop_reception_recording'&&a.url===recordedReceptionUrl+'/stop'&&a.method==='POST'&&Object.keys(object(a.request_headers)).length===1&&Object.keys(h).length===1&&h.variable_name==='secret__icash_reception_stop_token'&&b.type==='object'&&Array.isArray(b.required)&&b.required.length===1&&b.required[0]==='recordingId'&&Object.keys(p).length===1&&r.type==='string'&&r.dynamic_variable==='icash_reception_recording_id'&&(a.auth_connection===null||a.auth_connection===undefined)&&(!t.response_mocks||Array.isArray(t.response_mocks)&&t.response_mocks.length===0);
}
// Versioned static audio generated once with Eleven v4, in the agent's voice.
// No per-call generation latency or extra generation request.
const receptionPromptBase='https://www.geticashx.com/audio/reception-v4-20261007';
const receptionPromptAudio=(name:'notice'|'question'|'goodbye')=>`<Play>${receptionPromptBase}/${name}.mp3</Play>`;
export const receptionEndTwiml=`<Response>${receptionPromptAudio('goodbye')}<Hangup/></Response>`;
export function receptionConsentTwiml(id:string,nonce:string,includeNotice=true){
 // Reuse the same signed action, speech settings, and fail-closed hangup.
 const original=consentTwiml(id,nonce,recordingDisclosure('iCash X','the receptionist'),includeNotice).replace('https://www.geticashx.com/api/internal/voice/recording/consent',recordedReceptionUrl+'/consent');
 let notice=includeNotice;
 return original.replace(/<Say\b[^>]*>[\s\S]*?<\/Say>/g,()=>{if(notice){notice=false;return receptionPromptAudio('notice');}return receptionPromptAudio('question');});
}
/** Play answers the incoming call. No recording or AI before signed setup. */
export function receptionAnswerTwiml(id:string,nonce:string){
 const consent=receptionConsentTwiml(id,nonce);
 const notice=consent.slice(0,consent.indexOf('<Gather'));
 return notice+`<Redirect method="POST">${recordedReceptionUrl}/setup?id=${id}&amp;nonce=${nonce}</Redirect><Hangup/></Response>`;
}
/** Termination authority is exact call identity, independent of disputed clocks. */
export function incomingCallIdentityMatches(r:RecordedReceptionRow,c:Record<string,unknown>){return sid(c.sid,'CA')&&c.sid===r.call_sid&&c.account_sid===r.provider_account_sid&&c.from===r.from_phone&&c.to===r.to_phone&&c.direction==='inbound';}
export function incomingCallMatches(r:RecordedReceptionRow,c:Record<string,unknown>,now=Date.now(),active=false,fresh=false){
 const age=now-Date.parse(String(c.date_created));
 return incomingCallIdentityMatches(r,c)&&(!r.call_started_at||Date.parse(String(c.start_time))===Date.parse(r.call_started_at))&&(!active||c.status==='in-progress')&&(!fresh||Number.isFinite(age)&&age>=0&&age<=120000);
}
export function receptionRecordingMatches(r:RecordedReceptionRow,p:Record<string,unknown>){return sid(p.sid,'RE')&&p.account_sid===r.provider_account_sid&&p.call_sid===r.call_sid&&(!r.recording_sid||r.recording_sid===p.sid);}
export function receptionConversationMatches(r:RecordedReceptionRow,value:unknown){
 const c=object(value),init=object(c.conversation_initiation_client_data),vars=object(init.dynamic_variables),phone=object(object(c.metadata).phone_call),user='icash-recorded-reception:'+r.id;
 return /^conv_[A-Za-z0-9]+$/.test(String(c.conversation_id))&&(!r.conversation_id||r.conversation_id===c.conversation_id)&&c.agent_id===r.agent_id&&c.branch_id===r.branch_id&&c.version_id===r.version_id&&c.user_id===user&&init.user_id===user&&init.branch_id===r.branch_id&&vars.icash_reception_recording_id===r.id&&phone.call_sid===r.call_sid&&phone.direction==='inbound'&&phone.external_number===r.from_phone&&phone.agent_number===r.to_phone;
}
export function receptionAudioAvailable(r:RecordedReceptionRow,now=Date.now()){return r.state==='available'&&sid(r.recording_sid,'RE')&&recordingAuthorized(r)&&!!r.start_claimed_at&&!!r.conversation_id&&!!r.call_ended_at&&!r.deleted_at&&Number.isFinite(Date.parse(r.audio_expires_at??''))&&Date.parse(r.audio_expires_at!)>now;}
/** Active GETs may omit initiation data. Exact provider session, agent/version,
 * carrier call and both phone bindings remain mandatory. Present initiation
 * fields must match. Terminal settlement still uses the full receipt above. */
export function receptionLiveConversationMatches(r:RecordedReceptionRow,value:unknown){
 const c=object(value),init=object(c.conversation_initiation_client_data),vars=object(init.dynamic_variables),phone=object(object(c.metadata).phone_call),user='icash-recorded-reception:'+r.id;
 return /^conv_[A-Za-z0-9]+$/.test(String(c.conversation_id))&&(!r.conversation_id||r.conversation_id===c.conversation_id)&&c.agent_id===r.agent_id&&c.branch_id===r.branch_id&&c.version_id===r.version_id&&c.user_id===user&&phone.call_sid===r.call_sid&&phone.direction==='inbound'&&phone.external_number===r.from_phone&&phone.agent_number===r.to_phone
  &&(init.user_id==null||init.user_id===user)&&(init.branch_id==null||init.branch_id===r.branch_id)&&(vars.icash_reception_recording_id==null||vars.icash_reception_recording_id===r.id);
}
export function receptionRecordingCosts(r:RecordedReceptionRow){
 if(r.pricing_policy.version!==recordedReceptionPolicy||!Number.isInteger(r.duration_seconds)||r.duration_seconds!<0||r.duration_seconds!>r.max_total_seconds)throw Error('RECORDING_DURATION_REQUIRED');
 const minutes=Math.ceil(r.duration_seconds!/60),recording=r.provider_recording_price_micros??minutes*2500,storage=Math.ceil(minutes*500*30/28);
 const speech=r.entry_policy==='direct_recorded_v1'?0:20000;
 return {recording,storage,speech,total:recording+storage+speech,recordingObserved:r.provider_recording_price_micros!==null};
}
