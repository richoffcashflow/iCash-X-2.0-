import {readRecordingReview,recordingAgentMatches,canonical,object} from './required-call-recording.ts';
import {outboundProApproval as approval} from './outbound-parallel-approval.ts';
import {readVoiceCapacityProvider,voiceCapacitySnapshot,voiceCreditState} from './voice-capacity.ts';

type Db=<T=unknown>(path:string,method?:string,body?:unknown)=>Promise<T>;
type State={status:'ready'|'claimed'|'applied';claimed:boolean};
const rpc='rpc/icash_pro_voice_capacity_change';
const snapshot=(a:Record<string,unknown>)=>({conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null});
const same=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));

/** One authorized configuration change, after the compatible app is live.
 * The durable claim permits at most one PATCH. A lost reply is reconciled by
 * reading the exact reviewed agent; neither time nor a restart permits replay.
 * No calls, simulations, billing changes, prompts or incoming agents are edited. */
export async function applyApprovedProVoiceCapacity(db:Db,env:Record<string,string|undefined>=process.env,fetcher:typeof fetch=fetch,now=Date.now()){
 if(env.VERCEL!=='1'||env.VERCEL_ENV!=='production'||env.VERCEL_GIT_PROVIDER!=='github'
  ||env.VERCEL_GIT_COMMIT_REF!=='main'||env.VERCEL_GIT_REPO_OWNER!=='richoffcashflow'||env.VERCEL_GIT_REPO_SLUG!=='iCash-X-2.0-'
  ||!/^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA??''))return {status:'not_requested',providerWrites:false};
 const state=await db<State>(rpc,'POST',{p_action:'status'});
 if(state?.status==='applied')return {status:'already_verified',providerWrites:false};
 if(!state||!['ready','claimed'].includes(state.status))throw Error('PRO_VOICE_CAPACITY_STATE_UNAVAILABLE');
 const review=readRecordingReview(env.RECORDED_OUTBOUND_REVIEW_JSON,now);
 if(!review||review.agentId!==approval.agentId||review.branchId!==approval.branchId||review.versionId!==approval.versionId)throw Error('PRO_VOICE_CAPACITY_REVIEW_REQUIRED');
 const read=(path:string)=>readVoiceCapacityProvider(path,'global',env,fetcher);
 const subscription=await read('/v1/user/subscription');
 const path=`/v1/convai/agents/${review.agentId}?branch_id=${review.branchId}`;
 const before=object(await read(path)),limits=object(object(before.platform_settings).call_limits);
 const capacity=voiceCapacitySnapshot(subscription,before);
 if(capacity?.workspaceLimit!==approval.workspaceLimit||!recordingAgentMatches(review,before))throw Error('PRO_VOICE_CAPACITY_PREREQUISITE_FAILED');
 const already=limits.agent_concurrency_limit===approval.limit&&limits.daily_limit===approval.dailyLimit;
 if(already){
  // Includes a confirmed readback after a previous timeout or lost DB receipt.
  if(state.status==='ready')await db<State>(rpc,'POST',{p_action:'claim'});
  const done=await db<State>(rpc,'POST',{p_action:'complete'});
  if(done?.status!=='applied')throw Error('PRO_VOICE_CAPACITY_RECEIPT_UNCONFIRMED');
  return {status:'verified',outgoingLimit:approval.limit,dailyLimit:approval.dailyLimit,workspaceLimit:approval.workspaceLimit,providerWrites:false};
 }
 if(state.status==='claimed')return {status:'review_required',providerWrites:false};
 if(now<Date.parse('2026-10-26T00:00:00Z')||voiceCreditState(subscription)!=='available'
  ||limits.agent_concurrency_limit!==approval.previousLimit||limits.daily_limit!==approval.previousDailyLimit)throw Error('PRO_VOICE_CAPACITY_PREREQUISITE_FAILED');
 const mainPath=`/v1/convai/agents/${review.agentId}?branch_id=${before.main_branch_id}`;
 const main=object(await read(mainPath));
 if(main.agent_id!==review.agentId||main.branch_id!==before.main_branch_id
  ||!same(object(main.platform_settings).call_limits,limits))throw Error('PRO_VOICE_CAPACITY_MAIN_MISMATCH');
 const claim=await db<State>(rpc,'POST',{p_action:'claim'});
 if(claim?.claimed!==true)return {status:'claimed_elsewhere',providerWrites:false};
 const nextLimits={...limits,agent_concurrency_limit:approval.limit,daily_limit:approval.dailyLimit};
 const url='https://api.elevenlabs.io'+mainPath;
 let writeError:Error|undefined;
 try{
  const response=await fetcher(url,{method:'PATCH',headers:{'xi-api-key':env.ELEVENLABS_API_KEY!,'Content-Type':'application/json',Accept:'application/json'},
   body:JSON.stringify({platform_settings:{call_limits:nextLimits}}),redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok)writeError=Error('PRO_VOICE_CAPACITY_WRITE_HTTP_'+response.status);
  if(response.redirected||response.url&&response.url!==url)writeError=Error('PRO_VOICE_CAPACITY_WRITE_UNCONFIRMED');
  await response.body?.cancel();
 }catch{writeError=Error('PRO_VOICE_CAPACITY_WRITE_UNCONFIRMED');}
 const after=object(await read(path));
 const expected={...snapshot(before),platform_settings:{...object(before.platform_settings),call_limits:nextLimits}};
 if(!recordingAgentMatches(review,after)||!same(snapshot(after),expected))throw writeError??Error('PRO_VOICE_CAPACITY_READBACK_MISMATCH');
 const done=await db<State>(rpc,'POST',{p_action:'complete'});
 if(done?.status!=='applied')throw Error('PRO_VOICE_CAPACITY_RECEIPT_UNCONFIRMED');
 return {status:'verified',outgoingLimit:approval.limit,dailyLimit:approval.dailyLimit,workspaceLimit:approval.workspaceLimit,providerWrites:true};
}
