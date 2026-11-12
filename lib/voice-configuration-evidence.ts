import {canonical,object,sha,type RecordingReview} from './required-call-recording.ts';
import {receptionReviewReport} from '../scripts/reception-review-report.mjs';

type Db=<T=unknown>(path:string,method?:string,body?:unknown)=>Promise<T>;
/** Preserve drift from the existing authenticated metadata read. No additional
 * provider request, approval change, call, recovery claim or historical rewrite. */
export async function recordVoiceConfigurationDrift(db:Db,review:RecordingReview,raw:unknown,env:Record<string,string|undefined>,now:number){
 const a=object(raw);
 if(a.agent_id!==review.agentId||a.branch_id!==review.branchId||a.version_id!==review.versionId)return false;
 const snapshot={conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null};
 const observedHash=sha(JSON.stringify(canonical(snapshot)));
 const provider='outbound_runtime_config_review_'+observedHash;
 const previous=await db<Array<{provider:string}>>('icash_integration_checks?provider=eq.'+provider+'&select=provider&limit=1');
 if(previous.length)return true;
 const configuration=receptionReviewReport(a,[env.ELEVENLABS_API_KEY,env.TWILIO_AUTH_TOKEN,env.SUPABASE_SECRET_KEY].filter((s):s is string=>typeof s==='string'));
 await db('icash_integration_checks','POST',{provider,checked_at:new Date(now).toISOString(),result:{status:'needs_review',agentId:review.agentId,branchId:review.branchId,versionId:review.versionId,sourceConfigHash:review.configHash,observedHash,releaseSha:env.VERCEL_GIT_COMMIT_SHA,configuration,providerWrites:false,calls:false,approvalChanged:false}});
 return true;
}
