import {recordingAuthorized} from './direct-call-entry.ts';
import {automaticOfferGuardrailMatches,automaticOfferPolicy} from './automatic-offer-policy.ts';
import {type NetworkBuyerKind} from './homeoffer-buyer-identity.ts';
import {finalAffirmativeSpeech,recordingConsentEvidenceVersion,recordingContactOptOut} from './recording-consent-evidence.ts';
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {outboundParallelApproval,outboundProApproval} from './outbound-parallel-approval.ts';
/** Default-off outbound foundation. Spoken-consent977-cent quote approved; activation still requires release review. */
export const recordingPolicy=Object.freeze({version:'required-audio-30d-speech-v1',disclosureVersion:'required-audio-30d-speech-2026-10-03',retentionDays:30,maxTotalSeconds:600,consentWindowSeconds:45,recordingMicrosPerMinute:2500,storageMicrosPerMinuteMonth:500,speechGatherMicros:20000,recordingAllowanceMicros:31000,minimumHoldCents:977,previousApprovedHoldCents:965});
export const recordingPricing={version:recordingPolicy.version,retentionDays:30,recordingMicrosPerMinute:2500,storageMicrosPerMinuteMonth:500,recordingAllowanceMicros:31000,speechGatherMicros:20000,estimate:true};
export type RecordingState='consent_pending'|'declined'|'starting'|'recording'|'stopping'|'processing'|'available'|'absent'|'expired'|'deletion_pending'|'deleted'|'failed';
export type RecordingRow={id:string;account_id:string;operation_key:string;provider_account_sid:string;call_sid:string|null;recording_sid:string|null;conversation_id:string|null;state:RecordingState;nonce_hash:string;stop_token_hash:string;disclosure_version:string;consent_at:string|null;consent_evidence:Record<string,unknown>|null;start_claimed_at:string|null;provider_started_at:string|null;ended_at:string|null;duration_seconds:number|null;audio_expires_at:string|null;deleted_at:string|null;provider_recording_price_micros:number|null;price_is_estimate:boolean;pricing_policy:Record<string,unknown>;to_phone:string;from_phone:string;contact_key:string;agent_id:string;branch_id:string;version_id:string;max_total_seconds:number;rate_id:string;charge_cap_cents:number;created_at:string;[key:string]:unknown};
export type RecordingReview={enabled:boolean;reviewedAt:string;reviewedUntil:string;agentId:string;branchId:string;versionId:string;configHash:string;fromPhone:string;providerAccountSid:string;stopToolId:string;contractToolId?:string;offerPolicy?:'automatic_offer_v5'|'automatic_offer_v6'|'automatic_offer_v7'|'automatic_offer_v8'|'automatic_offer_v9';toolIds:string[];approvedHoldCents:number;retentionDays:number;maxTotalSeconds:number;policyVersion:string};
export const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export const sid=(s:unknown,prefix:string):s is string=>typeof s==='string'&&new RegExp('^'+prefix+'[a-fA-F0-9]{32}$').test(s);
export const uuid=(s:unknown):s is string=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
export const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
export const privateHeaders={'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export const recordingBaseUrl='https://www.geticashx.com/api/internal/voice/recording';
export function readRecordingReview(raw:string|undefined,now=Date.now()):RecordingReview|null{
 try{const r=JSON.parse(raw??'null') as RecordingReview;if(!r||r.offerPolicy!==undefined&&(!automaticOfferPolicy(r.offerPolicy)||!r.contractToolId)||r.enabled!==true||!/^agent_[A-Za-z0-9]+$/.test(r.agentId)||!/^agtbrch_[A-Za-z0-9]+$/.test(r.branchId)||!/^agtvrsn_[A-Za-z0-9]+$/.test(r.versionId)||!/^tool_[A-Za-z0-9]+$/.test(r.stopToolId)||!/^\+[1-9]\d{7,14}$/.test(r.fromPhone)||!sid(r.providerAccountSid,'AC')||!/^[a-f0-9]{64}$/.test(r.configHash)||!Array.isArray(r.toolIds)||r.toolIds.length!==(r.contractToolId?4:3)||new Set(r.toolIds).size!==r.toolIds.length||r.contractToolId!==undefined&&(!/^tool_[A-Za-z0-9]+$/.test(r.contractToolId)||r.contractToolId===r.stopToolId||!r.toolIds.includes(r.contractToolId))||!r.toolIds.includes(r.stopToolId)||!r.toolIds.every(x=>/^tool_[A-Za-z0-9]+$/.test(x))||r.approvedHoldCents!==recordingPolicy.minimumHoldCents||r.retentionDays!==30||r.maxTotalSeconds!==600||r.policyVersion!==recordingPolicy.version||!Number.isFinite(Date.parse(r.reviewedAt))||Date.parse(r.reviewedAt)>now||!Number.isFinite(Date.parse(r.reviewedUntil))||Date.parse(r.reviewedUntil)<=now)return null;return r;}catch{return null;}
}
/** Observed on the same approved provider version on 2026-10-19: the joint
 * numeric-zero/boolean-false PVC fields were renamed to clone_strength.
 * Reconstruct only that exact older representation, never an approval. */
export function recordingRenamedDisabledTtsSnapshot(snapshot:Record<string,unknown>):Record<string,unknown>|null{
 const config=object(snapshot.conversation_config),tts=object(config.tts);
 const platform=object(snapshot.platform_settings),overrides=object(platform.overrides);
 const overrideConfig=object(overrides.conversation_config_override),overrideTts=object(overrideConfig.tts);
 if(!Object.hasOwn(tts,'clone_strength')||tts.clone_strength!==0
  ||!Object.hasOwn(overrideTts,'clone_strength')||overrideTts.clone_strength!==false
  ||Object.hasOwn(tts,'pvc_strength')||Object.hasOwn(overrideTts,'pvc_strength'))return null;
 const priorTts:Record<string,unknown>={...tts,pvc_strength:0},priorOverrideTts:Record<string,unknown>={...overrideTts,pvc_strength:false};
 delete priorTts.clone_strength;delete priorOverrideTts.clone_strength;
 return {...snapshot,conversation_config:{...config,tts:priorTts},
  platform_settings:{...platform,overrides:{...overrides,conversation_config_override:{...overrideConfig,tts:priorOverrideTts}}}};
}
/** Observed on the unchanged approved version on 2026-10-20. Accept only
 * the complete, disabled noise feature with its exact provider default text
 * and disabled text override, and only if removing it restores the saved hash.
 * Enabled, partial, custom, malformed or otherwise changed settings stay exact. */
function recordingDisabledNoiseSnapshot(snapshot:Record<string,unknown>):Record<string,unknown>|null{
 const config=object(snapshot.conversation_config),turn=object(config.turn);
 const platform=object(snapshot.platform_settings),overrides=object(platform.overrides);
 const overrideConfig=object(overrides.conversation_config_override),overrideTurn=object(overrideConfig.turn);
 if(turn.noisy_environment_detection!==false
  ||turn.noisy_environment_message!=="Uhh ... sorry, I'm picking up some noise in the background. Could you move somewhere quieter?"
  ||overrideTurn.noisy_environment_message!==false)return null;
 const priorTurn={...turn},priorOverrideTurn={...overrideTurn};
 delete priorTurn.noisy_environment_detection;delete priorTurn.noisy_environment_message;delete priorOverrideTurn.noisy_environment_message;
 return {...snapshot,conversation_config:{...config,turn:priorTurn},platform_settings:{...platform,overrides:{...overrides,conversation_config_override:{...overrideConfig,turn:priorOverrideTurn}}}};
}
function recordingEmptyAgentHashMatches(configHash:string,snapshot:Record<string,unknown>):boolean{
 const matches=(value:unknown)=>sha(JSON.stringify(canonical(value)))===configHash;
 if(matches(snapshot))return true;
 const config=object(snapshot.conversation_config),agent=object(config.agent),variants=[agent];
 // ElevenLabs may omit either exact empty default on an unchanged version.
 // Compare at most four complete fingerprints per representation; preserve the approved hash and
 // every other field. Nonempty, malformed and extended values stay exact.
 const subagentConfig=object(agent.subagent_config),keys=Object.keys(subagentConfig);
 if(!Object.hasOwn(agent,'subagent_config')||keys.length===2&&Object.hasOwn(subagentConfig,'agents')&&Object.hasOwn(subagentConfig,'self_subagent')&&Array.isArray(subagentConfig.agents)&&subagentConfig.agents.length===0&&subagentConfig.self_subagent===null){
  const alternate={...agent};
  if(Object.hasOwn(agent,'subagent_config'))delete alternate.subagent_config;
  else alternate.subagent_config={agents:[],self_subagent:null};
  variants.push(alternate);
 }
 if(!Object.hasOwn(agent,'subagents')||Array.isArray(agent.subagents)&&agent.subagents.length===0){
  for(const variant of [...variants]){
   const alternate={...variant};
   if(Object.hasOwn(agent,'subagents'))delete alternate.subagents;
   else alternate.subagents=[];
   variants.push(alternate);
  }
 }
 if(variants.slice(1).some(alternate=>matches({...snapshot,conversation_config:{...config,agent:alternate}})))return true;
 return false;
}
export function recordingConfigHashMatches(configHash:string,snapshot:Record<string,unknown>):boolean{
 // Fixed representations, each with up to four empty-agent
 // variants. Never ignore arbitrary fields or rewrite a saved approval.
 const snapshots=[snapshot],withoutNoise=recordingDisabledNoiseSnapshot(snapshot);
 if(withoutNoise)snapshots.push(withoutNoise);
 for(const value of [...snapshots]){
  const renamed=recordingRenamedDisabledTtsSnapshot(value);
  if(renamed)snapshots.push(renamed);
 }
 // Observed on the same approved provider version on 2026-10-21. The newly
 // serialized optional identity tool is absent in the saved fingerprint.
 // Only its literal null can be omitted, and the entire remaining snapshot
 // must still reproduce that SAME approval. Configured tools stay exact.
 for(const value of [...snapshots]){
  const config=object(value.conversation_config),agent=object(config.agent),prompt=object(agent.prompt),builtins=object(prompt.built_in_tools);
  if(!Object.hasOwn(builtins,'identity_challenge')||builtins.identity_challenge!==null)continue;
  const previousBuiltins={...builtins};delete previousBuiltins.identity_challenge;
  snapshots.push({...value,conversation_config:{...config,agent:{...agent,prompt:{...prompt,built_in_tools:previousBuiltins}}}});
 }
 // Observed together on the unchanged approved version on 2026-10-24. Only
 // this exact new representation can reconstruct the saved full fingerprint:
 // fullscreen widget, no unverified memory identities, and no summary schedule.
 // Keep every other setting, and never change or synthesize an approval.
 for(const value of [...snapshots]){
  const platform=object(value.platform_settings),widget=object(platform.widget),privacy=object(platform.privacy),memory=object(privacy.user_memory);
  if(!Object.hasOwn(widget,'mobile_fullscreen')||widget.mobile_fullscreen!==true
   ||!Object.hasOwn(memory,'accept_unverified_identities')||memory.accept_unverified_identities!==false
   ||!Object.hasOwn(platform,'summary_schedule')||platform.summary_schedule!==null)continue;
  const previousWidget={...widget},previousMemory={...memory},previousPlatform={...platform};
  delete previousWidget.mobile_fullscreen;delete previousMemory.accept_unverified_identities;delete previousPlatform.summary_schedule;
  snapshots.push({...value,platform_settings:{...previousPlatform,widget:previousWidget,privacy:{...privacy,user_memory:previousMemory}}});
 }
 // Observed on the same approved version on October 28: an empty ASR
 // library list and a widget-only transcript setting. Remove only the joint
 // exact defaults, and still require the entire original approved fingerprint.
 for(const value of [...snapshots]){
  const config=object(value.conversation_config),asr=object(config.asr);
  const platform=object(value.platform_settings),widget=object(platform.widget);
  if(!Array.isArray(asr.keyterm_libraries)||asr.keyterm_libraries.length!==0
   ||widget.transcript_speech_sync_enabled!==true)continue;
  const priorAsr={...asr},priorWidget={...widget};
  delete priorAsr.keyterm_libraries;delete priorWidget.transcript_speech_sync_enabled;
  snapshots.push({...value,conversation_config:{...config,asr:priorAsr},platform_settings:{...platform,widget:priorWidget}});
 }
 // October 29 added an explicit disabled encryption field to the unchanged
 // version. This only reconstructs an absent field in a saved hash; it never
 // changes encryption, accepts true/malformed values, or creates an approval.
 for(const value of [...snapshots]){
  const platform=object(value.platform_settings),privacy=object(platform.privacy);
  if(privacy.encrypt_conversations!==false)continue;
  const priorPrivacy={...privacy};delete priorPrivacy.encrypt_conversations;
  snapshots.push({...value,platform_settings:{...platform,privacy:priorPrivacy}});
 }
 return snapshots.some(value=>recordingEmptyAgentHashMatches(configHash,value));
}
export function recordingAgentMatches(review:RecordingReview,raw:unknown){
 const a=object(raw),config=object(a.conversation_config),platform=object(a.platform_settings),prompt=object(object(config.agent).prompt),overrides=object(object(platform.overrides).conversation_config_override);
 const snapshot={conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null};
 if(review.offerPolicy!==undefined&&(!automaticOfferPolicy(review.offerPolicy)||!automaticOfferGuardrailMatches(platform.guardrails,review.offerPolicy)))return false;
 const approval=outboundParallelApproval,limits=object(platform.call_limits);
 // Only this separately approved 2 -> 8 capacity change may reproduce the
 // existing outgoing fingerprint. Every other field must still match it.
 // Incoming comparisons and historical approvals remain exact and untouched.
 const approvedCapacity=review.agentId===approval.agentId&&review.branchId===approval.branchId&&review.versionId===approval.versionId
  &&limits.agent_concurrency_limit===approval.limit&&limits.bursting_enabled===false
  &&recordingConfigHashMatches(review.configHash,{...snapshot,platform_settings:{...platform,call_limits:{...limits,agent_concurrency_limit:approval.previousLimit}}});
 // The separately approved Pro change is limited to these exact two fields
 // on the same reviewed agent, branch and version. Reconstruct either saved
 // pre-Pro capacity representation; all conversation and pricing remain exact.
 const pro=outboundProApproval;
 const approvedProCapacity=review.agentId===pro.agentId&&review.branchId===pro.branchId&&review.versionId===pro.versionId
  &&limits.agent_concurrency_limit===pro.limit&&limits.daily_limit===pro.dailyLimit&&limits.bursting_enabled===false
  &&[pro.previousLimit,approval.previousLimit].some(previous=>recordingConfigHashMatches(review.configHash,
   {...snapshot,platform_settings:{...platform,call_limits:{...limits,agent_concurrency_limit:previous,daily_limit:pro.previousDailyLimit}}}));
 return a.agent_id===review.agentId&&a.branch_id===review.branchId&&typeof a.main_branch_id==='string'&&/^agtbrch_[A-Za-z0-9]+$/.test(a.main_branch_id)&&a.main_branch_id!==review.branchId&&a.version_id===review.versionId&&object(platform.privacy).record_voice===false&&object(platform.auth).enable_auth===true&&object(config.asr).user_input_audio_format==='ulaw_8000'&&object(config.tts).agent_output_audio_format==='ulaw_8000'&&object(config.conversation).max_duration_seconds===600&&limits.bursting_enabled===false&&object(platform.queueing_config).enabled===false&&object(overrides.conversation).max_duration_seconds===true&&object(overrides.agent).first_message===true&&object(object(overrides.agent).prompt).prompt===true&&object(overrides.tts).voice_id===true&&Array.isArray(prompt.tool_ids)&&prompt.tool_ids.length===review.toolIds.length&&review.toolIds.every(id=>(prompt.tool_ids as unknown[]).includes(id))&&(recordingConfigHashMatches(review.configHash,snapshot)||approvedCapacity||approvedProCapacity);
}
export function recordingDisclosure(principal:string,assistantName:string,buyerKind?:NetworkBuyerKind){
 const valid=(s:string)=>typeof s==='string'&&s.trim().length>0&&s.length<=160&&!/[<>\x00-\x1f]/.test(s);
 if(!valid(principal)||!valid(assistantName))throw Error('RECORDING_IDENTITY_REQUIRED');
 return `Hi, I'm ${assistantName}, the AI assistant for ${principal}. We save a transcript and keep audio private for 30 days. Is it okay to record?`;
}
const escapeXml=(s:string)=>s.replace(/[<>&'\"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]!));
export function consentTwiml(id:string,nonce:string,disclosure:string,includeNotice=true){
 if(!uuid(id)||!/^[a-f0-9]{64}$/.test(nonce))throw Error('RECORDING_BINDING_REQUIRED');
 const action=`${recordingBaseUrl}/consent?id=${id}&nonce=${nonce}`;
 const question='Is it okay to record?';
 if(!disclosure.endsWith(question))throw Error('DISCLOSURE_REQUIRED');
 const notice=disclosure.slice(0,-question.length).trim();
 return `<Response>${includeNotice?`<Say voice="woman" language="en-US">${escapeXml(notice)}</Say>`:''}<Gather input="speech" action="${escapeXml(action)}" method="POST" actionOnEmptyResult="true" timeout="5" speechModel="default" language="en-US" speechTimeout="2"><Say voice="woman" language="en-US">${escapeXml(question)}</Say></Gather><Hangup/></Response>`;
}
export const endTwiml='<Response><Say voice="woman" language="en-US">Okay, I won\'t record a conversation without your permission. Take care.</Say><Hangup/></Response>';
export const affirmativeUtterances=['yes','yeah','yep','sure','yes please',"yes that's okay",'yes you can record','yes i agree','i agree','i consent','yes you may record'] as const;
export const recordingGateOptOut=recordingContactOptOut;
export function affirmativeSpeech(form:URLSearchParams){const result=finalAffirmativeSpeech(form);return result?{...result,evidenceVersion:recordingConsentEvidenceVersion}:null;}
export function verifiedTwilioForm(raw:string,signature:string|null,token:string,url:string){
 if(raw.length>16384||token.length<20||!signature||!/^[A-Za-z0-9+/]{27}=$/.test(signature))return null;
 const f=new URLSearchParams(raw),keys=[...f.keys()];if(keys.length>100||new Set(keys).size!==keys.length)return null;
 const expected=createHmac('sha1',token).update(url+keys.sort().map(k=>k+f.get(k)).join('')).digest('base64');
 const a=Buffer.from(signature),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b)?f:null;
}
export function audioAvailable(row:RecordingRow,now=Date.now()){return row.state==='available'&&sid(row.recording_sid,'RE')&&recordingAuthorized(row)&&Number.isFinite(Date.parse(row.audio_expires_at??''))&&Date.parse(row.audio_expires_at!)>now&&!row.deleted_at;}
export function requiredRecordingHold(base:{elevenlabsMicros:number;otherMicros:number}){
 if(!Number.isSafeInteger(base.elevenlabsMicros)||base.elevenlabsMicros<0||!Number.isSafeInteger(base.otherMicros)||base.otherMicros<0)throw Error('REVIEWED_COSTS_REQUIRED');
 const required=(BigInt(base.elevenlabsMicros)*BigInt(3)+(BigInt(base.otherMicros)+BigInt(31000)+BigInt(20000))*BigInt(5))*BigInt(12000);
 return Number((required+BigInt(99999999))/BigInt(100000000));
}
