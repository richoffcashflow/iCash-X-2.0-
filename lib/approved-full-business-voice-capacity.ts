import {readRecordingReview,recordingAgentMatches,canonical,object,sha} from './required-call-recording.ts';
import {outboundFullBusinessApproval as approval} from './outbound-parallel-approval.ts';
import {readVoiceCapacityProvider,voiceCapacitySnapshot,voiceCreditState} from './voice-capacity.ts';

type Db=<T=unknown>(path:string,method?:string,body?:unknown)=>Promise<T>;
type State={status:'disabled'|'ready'|'claimed'|'applied';claimed:boolean;releaseSha:string|null;beforeHash:string|null;afterHash:string|null};
const rpc='rpc/icash_full_business_voice_capacity_change';
const snapshot=(a:Record<string,unknown>)=>({conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null});
const hash=(a:unknown)=>sha(JSON.stringify(canonical(a)));
const same=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));

/** Separate, disabled 30 -> 38 change under the existing paid forty-call plan.
 * A durable claim stores the complete original and expected configuration hashes.
 * An uncertain PATCH can only be reconciled against that original expected hash.
 * No subscription, daily limit, burst mode, incoming agent or caller is changed. */
export async function applyApprovedFullBusinessVoiceCapacity(db:Db,env:Record<string,string|undefined>=process.env,fetcher:typeof fetch=fetch,now=Date.now()){
 const release=env.VERCEL_GIT_COMMIT_SHA;
 if(env.VERCEL!=='1'||env.VERCEL_ENV!=='production'||env.VERCEL_GIT_PROVIDER!=='github'
  ||env.VERCEL_GIT_COMMIT_REF!=='main'||env.VERCEL_GIT_REPO_OWNER!=='richoffcashflow'||env.VERCEL_GIT_REPO_SLUG!=='iCash-X-2.0-'
  ||!/^[a-f0-9]{40}$/.test(release??''))return {status:'not_requested',providerWrites:false};
 const state=await db<State>(rpc,'POST',{p_action:'status',p_release:release});
 if(state?.status==='disabled')return {status:'awaiting_activation',providerWrites:false};
 if(state?.status==='applied')return {status:'already_verified',providerWrites:false};
 if(!state||!['ready','claimed'].includes(state.status))throw Error('FULL_VOICE_CAPACITY_STATE_UNAVAILABLE');
 if(state.releaseSha!==release)return {status:'awaiting_approved_release',providerWrites:false};
 const review=readRecordingReview(env.RECORDED_OUTBOUND_REVIEW_JSON,now);
 if(!review||review.agentId!==approval.agentId||review.branchId!==approval.branchId||review.versionId!==approval.versionId)throw Error('FULL_VOICE_CAPACITY_REVIEW_REQUIRED');
 const read=(path:string)=>readVoiceCapacityProvider(path,'global',env,fetcher);
 const subscription=await read('/v1/user/subscription');
 const path=`/v1/convai/agents/${review.agentId}?branch_id=${review.branchId}`;
 const before=object(await read(path)),limits=object(object(before.platform_settings).call_limits);
 if(voiceCapacitySnapshot(subscription,before,40)?.workspaceLimit!==approval.workspaceLimit||!recordingAgentMatches(review,before))throw Error('FULL_VOICE_CAPACITY_PREREQUISITE_FAILED');
 const already=limits.agent_concurrency_limit===approval.limit&&limits.daily_limit===approval.dailyLimit;
 const finish=async(beforeHash:string,afterHash:string)=>{
  const done=await db<State>(rpc,'POST',{p_action:'complete',p_release:release,p_before:beforeHash,p_after:afterHash});
  if(done?.status!=='applied'||done.beforeHash!==beforeHash||done.afterHash!==afterHash)throw Error('FULL_VOICE_CAPACITY_RECEIPT_UNCONFIRMED');
 };
 if(state.status==='claimed'){
  if(!already||!state.beforeHash||!state.afterHash||hash(snapshot(before))!==state.afterHash)return {status:'review_required',providerWrites:false};
  await finish(state.beforeHash,state.afterHash);
  return {status:'verified',outgoingLimit:38,dailyLimit:1000,workspaceLimit:40,providerWrites:false};
 }
 // An independently changed provider agent is not evidence of this operation.
 if(already)return {status:'review_required',providerWrites:false};
 if(now<Date.parse('2026-11-17T00:00:00Z')||voiceCreditState(subscription)!=='available'
  ||limits.agent_concurrency_limit!==approval.previousLimit||limits.daily_limit!==approval.previousDailyLimit)throw Error('FULL_VOICE_CAPACITY_PREREQUISITE_FAILED');
 const mainPath=`/v1/convai/agents/${review.agentId}?branch_id=${before.main_branch_id}`;
 const main=object(await read(mainPath));
 if(main.agent_id!==review.agentId||main.branch_id!==before.main_branch_id||!same(object(main.platform_settings).call_limits,limits))throw Error('FULL_VOICE_CAPACITY_MAIN_MISMATCH');
 const nextLimits={...limits,agent_concurrency_limit:approval.limit};
 const expected={...snapshot(before),platform_settings:{...object(before.platform_settings),call_limits:nextLimits}};
 const beforeHash=hash(snapshot(before)),afterHash=hash(expected);
 const claim=await db<State>(rpc,'POST',{p_action:'claim',p_release:release,p_before:beforeHash,p_after:afterHash});
 if(claim?.claimed!==true)return {status:'claimed_elsewhere',providerWrites:false};
 if(claim.releaseSha!==release||claim.beforeHash!==beforeHash||claim.afterHash!==afterHash)throw Error('FULL_VOICE_CAPACITY_CLAIM_MISMATCH');
 const url='https://api.elevenlabs.io'+mainPath;
 let writeError:Error|undefined;
 try{
  const response=await fetcher(url,{method:'PATCH',headers:{'xi-api-key':env.ELEVENLABS_API_KEY!,'Content-Type':'application/json',Accept:'application/json'},
   body:JSON.stringify({platform_settings:{call_limits:nextLimits}}),redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok)writeError=Error('FULL_VOICE_CAPACITY_WRITE_HTTP_'+response.status);
  if(response.redirected||response.url&&response.url!==url)writeError=Error('FULL_VOICE_CAPACITY_WRITE_UNCONFIRMED');
  await response.body?.cancel();
 }catch{writeError=Error('FULL_VOICE_CAPACITY_WRITE_UNCONFIRMED');}
 const after=object(await read(path));
 if(!recordingAgentMatches(review,after)||hash(snapshot(after))!==afterHash)throw writeError??Error('FULL_VOICE_CAPACITY_READBACK_MISMATCH');
 await finish(beforeHash,afterHash);
 return {status:'verified',outgoingLimit:38,dailyLimit:1000,workspaceLimit:40,providerWrites:true};
}
