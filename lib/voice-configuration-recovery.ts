import {canonical,object,readRecordingReview,recordingAgentMatches,sha} from './required-call-recording.ts';

type Db=<T=unknown>(path:string,method?:string,body?:unknown)=>Promise<T>;
/** Reuse the ordinary capacity read. Recovery only queues never-admitted jobs;
 * the dispatcher still rechecks the provider, recipient, wallet and property. */
export async function recoverVoiceConfiguration(db:Db,agent:unknown,env:Record<string,string|undefined>=process.env,now=Date.now()){
 if(env.VERCEL!=='1'||env.VERCEL_ENV!=='production'||env.VERCEL_GIT_PROVIDER!=='github'
  ||env.VERCEL_GIT_COMMIT_REF!=='main'||env.VERCEL_GIT_REPO_OWNER!=='richoffcashflow'||env.VERCEL_GIT_REPO_SLUG!=='iCash-X-2.0-'
  ||!/^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA??'')
  ||env.ICASH_LIVE_WORK_READY!=='true'||env.ICASH_RECORDED_OUTBOUND_READY!=='true'||env.ICASH_RECORDING_RECEIPTS_READY!=='true')return {status:'not_requested',requeued:0};
 const review=readRecordingReview(env.RECORDED_OUTBOUND_REVIEW_JSON,now);
 if(!review||review.providerAccountSid!==env.TWILIO_ACCOUNT_SID||!env.TWILIO_AUTH_TOKEN
  ||!recordingAgentMatches(review,agent))return {status:'review_required',requeued:0};
 const a=object(agent),observedHash=sha(JSON.stringify(canonical({conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null})));
 const requeued=await db<number>('rpc/icash_recover_voice_configuration','POST',{
  p_agent:review.agentId,p_config_hash:review.configHash,p_observed_hash:observedHash,
  p_release:env.VERCEL_GIT_COMMIT_SHA,p_checked_at:new Date(now).toISOString(),
 });
 if(!Number.isInteger(requeued)||requeued<0||requeued>20)throw Error('VOICE_CONFIGURATION_RECOVERY_UNCONFIRMED');
 return {status:'checked',requeued};
}
