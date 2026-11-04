import {automaticOfferGuardrailMatches,automaticOfferPolicy} from './automatic-offer-policy.ts';
import {canonical,object,recordingAgentMatches,sha,type RecordingReview} from './required-call-recording.ts';

type Diagnostic={observedHash:string|null;failedChecks:string[];matchingRemovalPath:string|null;checkedCandidates:number;bounded:boolean};
const cooldownMs=60_000,maxBytes=65_536,maxNodes=1_500,maxCandidates=64,budgetMs=750;
const excluded=/^(?:__proto__|constructor|prototype)$|secret|token|password|credential|authorization|api_key|phone|header|dynamic_variable|placeholder|metadata|data_collection|webhook|^sk_/i;
// These are provider configuration containers, not caller-defined maps. Values,
// array members, prompts, tool schemas and credential containers never leave here.
const containers=new Set(['conversation_config','platform_settings','platform_settings.overrides','platform_settings.overrides.conversation_config_override','platform_settings.overrides.conversation_config_override.agent','platform_settings.overrides.conversation_config_override.agent.prompt','platform_settings.overrides.conversation_config_override.tts','platform_settings.overrides.conversation_config_override.turn','platform_settings.overrides.conversation_config_override.asr','platform_settings.overrides.conversation_config_override.conversation','conversation_config.asr','conversation_config.tts','conversation_config.turn','conversation_config.conversation','conversation_config.agent','conversation_config.agent.prompt','conversation_config.agent.prompt.built_in_tools','platform_settings.privacy','platform_settings.privacy.user_memory','platform_settings.widget','platform_settings.call_limits','platform_settings.queueing_config']);
const knownDefaults=new Set(['record_voice','enable_auth','bursting_enabled','enabled','max_duration_seconds','clone_strength','pvc_strength','noisy_environment_detection','identity_challenge','encrypt_conversations','mobile_fullscreen','accept_unverified_identities','summary_schedule','transcript_speech_sync_enabled']);
function shapeBounded(value:unknown,depth=0,count={n:0},seen=new Set<object>()):boolean{
 if(++count.n>maxNodes||depth>12)return false;
 if(value===null||typeof value!=='object')return true;
 if(seen.has(value))return false;seen.add(value);
 const result=Object.values(value).every(child=>shapeBounded(child,depth+1,count,seen));seen.delete(value);return result;
}
function invariants(review:RecordingReview,a:Record<string,unknown>){
 const c=object(a.conversation_config),p=object(a.platform_settings),prompt=object(object(c.agent).prompt),o=object(object(p.overrides).conversation_config_override);
 const checks={agent_identity:a.agent_id===review.agentId,branch_identity:a.branch_id===review.branchId,version_identity:a.version_id===review.versionId,non_main_branch:typeof a.main_branch_id==='string'&&/^agtbrch_[A-Za-z0-9]+$/.test(a.main_branch_id)&&a.main_branch_id!==review.branchId,
  recording_disabled:object(p.privacy).record_voice===false,authentication_enabled:object(p.auth).enable_auth===true,input_audio:object(c.asr).user_input_audio_format==='ulaw_8000',output_audio:object(c.tts).agent_output_audio_format==='ulaw_8000',duration_limit:object(c.conversation).max_duration_seconds===600,bursting_disabled:object(p.call_limits).bursting_enabled===false,queueing_disabled:object(p.queueing_config).enabled===false,
  duration_override:object(o.conversation).max_duration_seconds===true,greeting_override:object(o.agent).first_message===true,prompt_override:object(object(o.agent).prompt).prompt===true,voice_override:object(o.tts).voice_id===true,
  reviewed_tool_set:Array.isArray(prompt.tool_ids)&&prompt.tool_ids.length===review.toolIds.length&&review.toolIds.every(id=>(prompt.tool_ids as unknown[]).includes(id)),offer_guardrails:review.offerPolicy===undefined||automaticOfferPolicy(review.offerPolicy)&&automaticOfferGuardrailMatches(p.guardrails,review.offerPolicy)};
 return Object.entries(checks).filter(([,pass])=>!pass).map(([name])=>name);
}
/** Observation only. Even an exact reconstruction is NOT approval to dispatch.
 * At most one bounded slice per process/minute; identical finished fingerprints
 * are deduplicated. No network, writes, prompt/value output or review changes. */
export function createVoiceApprovalDiagnostics(now:()=>number=()=>performance.now()){
 let nextAt=-Infinity;const seen=new Map<string,{cursor:number;done:boolean}>();
 return (review:RecordingReview,raw:unknown):Diagnostic|null=>{
  const started=now();if(started<nextAt)return null;nextAt=started+cooldownMs;
  try{
   if(!shapeBounded(raw))return {observedHash:null,failedChecks:['diagnostic_shape_bound'],matchingRemovalPath:null,checkedCandidates:0,bounded:true};
   const a=object(raw),snapshot={conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null};
   const encoded=JSON.stringify(snapshot);
   if(Buffer.byteLength(encoded)>maxBytes)return {observedHash:null,failedChecks:['diagnostic_size_bound'],matchingRemovalPath:null,checkedCandidates:0,bounded:true};
   const observedHash=sha(JSON.stringify(canonical(snapshot))),key=review.configHash+':'+observedHash;
   const state=seen.get(key)??{cursor:0,done:false};if(state.done)return null;
   seen.set(key,state);if(seen.size>32)seen.delete(seen.keys().next().value!);
   const failedChecks=invariants(review,a),result:Diagnostic={observedHash,failedChecks:failedChecks.length?failedChecks:['approved_configuration_fingerprint'],matchingRemovalPath:null,checkedCandidates:0,bounded:false};
   // Never probe a response with changed identity, tools, policy or call controls.
   if(failedChecks.length){state.done=true;return result;}
   const candidates:string[][]=[];
   for(const container of containers){
    const path=container.split('.');let node:unknown=a;for(const segment of path)node=object(node)[segment];
    for(const [name,value] of Object.entries(object(node))){
     if(!/^[a-z][a-z0-9_]{0,47}$/.test(name)||excluded.test(name)||knownDefaults.has(name))continue;
     if(value===null||value===false||value===0)candidates.push([...path,name]);
    }
   }
   candidates.sort((left,right)=>left.join('.').localeCompare(right.join('.')));
   const boundedCandidates=candidates.slice(0,maxCandidates);result.bounded=candidates.length>maxCandidates;
   for(;state.cursor<boundedCandidates.length;state.cursor++){
    if(now()-started>=budgetMs){result.bounded=true;break;}
    const path=boundedCandidates[state.cursor],candidate=structuredClone(a);let node:Record<string,unknown>=candidate;
    for(const segment of path.slice(0,-1))node=object(node[segment]);delete node[path.at(-1)!];
    result.checkedCandidates++;
    // The unchanged production validator, original review and complete remaining
    // provider response must agree. This result is evidence only, never a gate.
    if(recordingAgentMatches(review,candidate)){result.matchingRemovalPath=path.join('.');state.done=true;break;}
   }
   if(state.cursor>=boundedCandidates.length)state.done=true;
   return result;
  }catch{return {observedHash:null,failedChecks:['diagnostic_unavailable'],matchingRemovalPath:null,checkedCandidates:0,bounded:true};}
 };
}
export const voiceApprovalDiagnostics=createVoiceApprovalDiagnostics();
