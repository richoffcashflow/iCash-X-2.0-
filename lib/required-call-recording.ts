import {finalAffirmativeSpeech,recordingConsentEvidenceVersion,recordingContactOptOut} from './recording-consent-evidence.ts';
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
/** Default-off outbound foundation. Spoken-consent977-cent quote approved; activation still requires release review. */
export const recordingPolicy=Object.freeze({version:'required-audio-30d-speech-v1',disclosureVersion:'required-audio-30d-speech-2026-10-03',retentionDays:30,maxTotalSeconds:600,consentWindowSeconds:45,recordingMicrosPerMinute:2500,storageMicrosPerMinuteMonth:500,speechGatherMicros:20000,recordingAllowanceMicros:31000,minimumHoldCents:977,previousApprovedHoldCents:965});
export const recordingPricing={version:recordingPolicy.version,retentionDays:30,recordingMicrosPerMinute:2500,storageMicrosPerMinuteMonth:500,recordingAllowanceMicros:31000,speechGatherMicros:20000,estimate:true};
export type RecordingState='consent_pending'|'declined'|'starting'|'recording'|'stopping'|'processing'|'available'|'absent'|'expired'|'deletion_pending'|'deleted'|'failed';
export type RecordingRow={id:string;account_id:string;operation_key:string;provider_account_sid:string;call_sid:string|null;recording_sid:string|null;conversation_id:string|null;state:RecordingState;nonce_hash:string;stop_token_hash:string;disclosure_version:string;consent_at:string|null;consent_evidence:Record<string,unknown>|null;start_claimed_at:string|null;provider_started_at:string|null;ended_at:string|null;duration_seconds:number|null;audio_expires_at:string|null;deleted_at:string|null;provider_recording_price_micros:number|null;price_is_estimate:boolean;pricing_policy:Record<string,unknown>;to_phone:string;from_phone:string;contact_key:string;agent_id:string;branch_id:string;version_id:string;max_total_seconds:number;rate_id:string;charge_cap_cents:number;created_at:string;[key:string]:unknown};
export type RecordingReview={enabled:boolean;reviewedAt:string;reviewedUntil:string;agentId:string;branchId:string;versionId:string;configHash:string;fromPhone:string;providerAccountSid:string;stopToolId:string;toolIds:string[];approvedHoldCents:number;retentionDays:number;maxTotalSeconds:number;policyVersion:string};
export const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export const sid=(s:unknown,prefix:string):s is string=>typeof s==='string'&&new RegExp('^'+prefix+'[a-fA-F0-9]{32}$').test(s);
export const uuid=(s:unknown):s is string=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
export const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
export const privateHeaders={'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export const recordingBaseUrl='https://www.geticashx.com/api/internal/voice/recording';
export function readRecordingReview(raw:string|undefined,now=Date.now()):RecordingReview|null{
 try{const r=JSON.parse(raw??'null') as RecordingReview;if(!r||r.enabled!==true||!/^agent_[A-Za-z0-9]+$/.test(r.agentId)||!/^agtbrch_[A-Za-z0-9]+$/.test(r.branchId)||!/^agtvrsn_[A-Za-z0-9]+$/.test(r.versionId)||!/^tool_[A-Za-z0-9]+$/.test(r.stopToolId)||!/^\+[1-9]\d{7,14}$/.test(r.fromPhone)||!sid(r.providerAccountSid,'AC')||!/^[a-f0-9]{64}$/.test(r.configHash)||!Array.isArray(r.toolIds)||r.toolIds.length!==3||new Set(r.toolIds).size!==3||!r.toolIds.includes(r.stopToolId)||!r.toolIds.every(x=>/^tool_[A-Za-z0-9]+$/.test(x))||r.approvedHoldCents!==recordingPolicy.minimumHoldCents||r.retentionDays!==30||r.maxTotalSeconds!==600||r.policyVersion!==recordingPolicy.version||!Number.isFinite(Date.parse(r.reviewedAt))||Date.parse(r.reviewedAt)>now||!Number.isFinite(Date.parse(r.reviewedUntil))||Date.parse(r.reviewedUntil)<=now)return null;return r;}catch{return null;}
}
export function recordingAgentMatches(review:RecordingReview,raw:unknown){
 const a=object(raw),config=object(a.conversation_config),platform=object(a.platform_settings),prompt=object(object(config.agent).prompt),overrides=object(object(platform.overrides).conversation_config_override);
 const snapshot={conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null};
 return a.agent_id===review.agentId&&a.branch_id===review.branchId&&typeof a.main_branch_id==='string'&&/^agtbrch_[A-Za-z0-9]+$/.test(a.main_branch_id)&&a.main_branch_id!==review.branchId&&a.version_id===review.versionId&&object(platform.privacy).record_voice===false&&object(platform.auth).enable_auth===true&&object(config.asr).user_input_audio_format==='ulaw_8000'&&object(config.tts).agent_output_audio_format==='ulaw_8000'&&object(config.conversation).max_duration_seconds===600&&object(platform.call_limits).bursting_enabled===false&&object(platform.queueing_config).enabled===false&&object(overrides.conversation).max_duration_seconds===true&&object(overrides.agent).first_message===true&&object(object(overrides.agent).prompt).prompt===true&&object(overrides.tts).voice_id===true&&Array.isArray(prompt.tool_ids)&&prompt.tool_ids.length===review.toolIds.length&&review.toolIds.every(id=>(prompt.tool_ids as unknown[]).includes(id))&&sha(JSON.stringify(canonical(snapshot)))===review.configHash;
}
export function recordingDisclosure(principal:string,assistantName:string){
 const valid=(s:string)=>typeof s==='string'&&s.trim().length>0&&s.length<=160&&!/[<>\x00-\x1f]/.test(s);
 if(!valid(principal)||!valid(assistantName))throw Error('RECORDING_IDENTITY_REQUIRED');
 return `Hi, I'm ${assistantName}, the AI assistant for ${principal}. We save a written transcript. The call audio would be private to this business, kept for 30 days for call review. Quick thing before we get into it, is it okay if I record this call?`;
}
const escapeXml=(s:string)=>s.replace(/[<>&'\"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]!));
export function consentTwiml(id:string,nonce:string,disclosure:string){
 if(!uuid(id)||!/^[a-f0-9]{64}$/.test(nonce))throw Error('RECORDING_BINDING_REQUIRED');
 const action=`${recordingBaseUrl}/consent?id=${id}&nonce=${nonce}`;
 const question='Quick thing before we get into it, is it okay if I record this call?';
 if(!disclosure.endsWith(question))throw Error('DISCLOSURE_REQUIRED');
 const notice=disclosure.slice(0,-question.length).trim();
 return `<Response><Say voice="man" language="en-US">${escapeXml(notice)}</Say><Gather input="speech" action="${escapeXml(action)}" method="POST" actionOnEmptyResult="true" timeout="5" speechModel="default" language="en-US" speechTimeout="2"><Say voice="man" language="en-US">${escapeXml(question)}</Say></Gather><Hangup/></Response>`;
}
export const endTwiml='<Response><Say voice="man" language="en-US">Okay, I won\'t record a conversation without your permission. Take care.</Say><Hangup/></Response>';
export const affirmativeUtterances=['yes','yeah','yep','sure','yes please',"yes that's okay",'yes you can record','yes i agree','i agree','i consent','yes you may record'] as const;
export const recordingGateOptOut=recordingContactOptOut;
export function affirmativeSpeech(form:URLSearchParams){const result=finalAffirmativeSpeech(form);return result?{...result,evidenceVersion:recordingConsentEvidenceVersion}:null;}
export function verifiedTwilioForm(raw:string,signature:string|null,token:string,url:string){
 if(raw.length>16384||token.length<20||!signature||!/^[A-Za-z0-9+/]{27}=$/.test(signature))return null;
 const f=new URLSearchParams(raw),keys=[...f.keys()];if(keys.length>100||new Set(keys).size!==keys.length)return null;
 const expected=createHmac('sha1',token).update(url+keys.sort().map(k=>k+f.get(k)).join('')).digest('base64');
 const a=Buffer.from(signature),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b)?f:null;
}
export function audioAvailable(row:RecordingRow,now=Date.now()){return row.state==='available'&&sid(row.recording_sid,'RE')&&!!row.consent_at&&Number.isFinite(Date.parse(row.audio_expires_at??''))&&Date.parse(row.audio_expires_at!)>now&&!row.deleted_at;}
export function requiredRecordingHold(base:{elevenlabsMicros:number;otherMicros:number}){
 if(!Number.isSafeInteger(base.elevenlabsMicros)||base.elevenlabsMicros<0||!Number.isSafeInteger(base.otherMicros)||base.otherMicros<0)throw Error('REVIEWED_COSTS_REQUIRED');
 const required=(BigInt(base.elevenlabsMicros)*BigInt(3)+(BigInt(base.otherMicros)+BigInt(31000)+BigInt(20000))*BigInt(5))*BigInt(12000);
 return Number((required+BigInt(99999999))/BigInt(100000000));
}
