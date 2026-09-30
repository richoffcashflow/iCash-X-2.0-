import {db} from '@/lib/stripe-test';
import {elevenRequest} from '@/lib/elevenlabs';
import {inspectOwnerVoice,ownerVoiceBody,type OwnerVoiceConfig} from './owner-voice-acceptance';
type Owner={accountId:string;userId:string};
type Run={id:string;state:string;conversation_id:string|null;configuration:OwnerVoiceConfig};
async function configFor(owner:Owner){const [config]=await db<OwnerVoiceConfig[]>(`icash_owner_voice_acceptance_config?id=eq.1&account_id=eq.${owner.accountId}&owner_user_id=eq.${owner.userId}&select=*`);return config;}
async function inspect(config:OwnerVoiceConfig){
 const [agent,branch,phone]=await Promise.all([
  elevenRequest(`/v1/convai/agents/${encodeURIComponent(config.agent_id)}?branch_id=${encodeURIComponent(config.branch_id)}`),
  elevenRequest(`/v1/convai/agents/${encodeURIComponent(config.agent_id)}/branches/${encodeURIComponent(config.branch_id)}`),
  elevenRequest(`/v1/convai/phone-numbers/${encodeURIComponent(config.phone_number_id)}`),
 ]);return inspectOwnerVoice(config,agent,branch,phone,process.env.CONTIGUITY_FROM);
}
export async function ownerVoiceStatus(owner:Owner){
 const config=await configFor(owner);if(!config)return {status:'not_configured',canCall:false};
 const [run]=await db<Run[]>(`icash_owner_voice_acceptance_runs?config_id=eq.1&account_id=eq.${owner.accountId}&owner_user_id=eq.${owner.userId}&select=id,state,conversation_id,configuration`);
 const destination=`ending ${config.phone.slice(-4)}`;
 if(run){
  if(run.state!=='accepted'||!run.conversation_id)return {status:'needs_review_no_retry',canCall:false,destination};
  const c=await elevenRequest<{agent_id?:string;conversation_id?:string;branch_id?:string;version_id?:string;has_audio?:boolean;status?:string;metadata?:{call_duration_secs?:number}}>(`/v1/convai/conversations/${encodeURIComponent(run.conversation_id)}`);
  if(c.agent_id!==run.configuration.agent_id||c.conversation_id!==run.conversation_id||c.branch_id!==run.configuration.branch_id||c.version_id!==run.configuration.reviewed_version_id||c.has_audio===true||(typeof c.metadata?.call_duration_secs==='number'&&c.metadata.call_duration_secs>60))return {status:'needs_review_no_retry',canCall:false,destination};
  return {status:['done','failed'].includes(c.status??'')?`provider_${c.status}`:'provider_processing',canCall:false,destination,durationSeconds:typeof c.metadata?.call_duration_secs==='number'?c.metadata.call_duration_secs:null};
 }
 if(Date.parse(config.expires_at)<=Date.now())return {status:'expired',canCall:false,destination};
 const review=await inspect(config);
 return {status:!review.guarded?'provider_guards_required':!review.reviewed?'provider_review_required':!config.enabled?'awaiting_release':'ready',canCall:config.enabled&&review.reviewed,checks:review.checks,destination,maxDurationSeconds:60,ringingTimeoutSeconds:20,expiresAt:config.expires_at,observedConfigHash:review.guarded?review.hash:null,observedVersionId:review.guarded?review.version:null};
}
export async function startOwnerVoiceAcceptance(owner:Owner){
 const config=await configFor(owner);
 if(!config?.enabled||Date.parse(config.expires_at)<=Date.now())return {status:'not_released',canCall:false};
 const preflight=await inspect(config);if(!preflight.reviewed)return {status:'provider_review_required',canCall:false};
 const run=await db<{id:string;configuration:OwnerVoiceConfig}|null>('rpc/icash_claim_owner_voice_acceptance','POST',{p_account:owner.accountId,p_user:owner.userId,p_hash:preflight.hash,p_version:preflight.version,p_expected:config});
 if(!run)return {status:'already_claimed_or_changed',canCall:false};
 try{
  const result=await elevenRequest<{success?:boolean;conversation_id?:string;callSid?:string}>('/v1/convai/twilio/outbound-call',ownerVoiceBody(run.configuration));
  if(!result.success||!/^conv_[A-Za-z0-9]+$/.test(result.conversation_id??'')||!/^CA[a-fA-F0-9]{32}$/.test(result.callSid??''))throw Error('UNCERTAIN');
  await db('rpc/icash_finish_owner_voice_acceptance','POST',{p_account:owner.accountId,p_user:owner.userId,p_run:run.id,p_conversation:result.conversation_id,p_sid:result.callSid});
  return {status:'provider_accepted',canCall:false};
 }catch{
  try{await db('rpc/icash_finish_owner_voice_acceptance','POST',{p_account:owner.accountId,p_user:owner.userId,p_run:run.id,p_conversation:null,p_sid:null});}catch{/* Claimed row remains consumed, including database failure. */}
  return {status:'needs_review_no_retry',canCall:false};
 }
}
