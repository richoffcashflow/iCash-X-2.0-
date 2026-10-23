// Explicit, commit-bound, one-time configuration operation. No calls or paid
// simulations. Normal builds and all imports perform no provider mutations.
import {pathToFileURL} from 'node:url';
import {productionReleaseTarget} from './verify-production-release.mjs';
import {readRecordingReview,recordingAgentMatches,canonical,object} from '../lib/required-call-recording.ts';
import {outboundParallelApproval as approval} from '../lib/outbound-parallel-approval.ts';
import {readVoiceCapacityProvider,voiceCapacitySnapshot} from '../lib/voice-capacity.ts';

export async function applyApprovedParallelCapacity(env=process.env,fetcher=fetch,now=Date.now()){
 const requested=env.ICASH_PARALLEL_CAPACITY_COMMIT;
 if(!requested||requested!==env.VERCEL_GIT_COMMIT_SHA)return {status:'not_requested'};
 const target=productionReleaseTarget(env);
 if(target?.host!=='vercel'||target.sha!==requested||now<Date.parse('2026-10-23T00:00:00Z')||now>=Date.parse('2026-10-25T00:00:00Z'))throw Error('PARALLEL_CAPACITY_APPROVAL_REQUIRED');
 const review=readRecordingReview(env.RECORDED_OUTBOUND_REVIEW_JSON,now);
 if(!review||review.agentId!==approval.agentId||review.branchId!==approval.branchId||review.versionId!==approval.versionId)throw Error('PARALLEL_CAPACITY_REVIEW_REQUIRED');
 const read=path=>readVoiceCapacityProvider(path,'global',env,fetcher);
 const subscription=await read('/v1/user/subscription');
 const reviewedPath=`/v1/convai/agents/${review.agentId}?branch_id=${review.branchId}`;
 const before=object(await read(reviewedPath)),limits=object(object(before.platform_settings).call_limits);
 const capacity=voiceCapacitySnapshot(subscription,before);
 if(capacity?.workspaceLimit!==approval.workspaceLimit||!recordingAgentMatches(review,before)
  ||![approval.previousLimit,approval.limit].includes(limits.agent_concurrency_limit))throw Error('PARALLEL_CAPACITY_PREREQUISITE_FAILED');
 if(limits.agent_concurrency_limit===approval.limit)return {status:'already_verified',outgoingLimit:approval.limit,workspaceLimit:capacity.workspaceLimit,providerWrites:false};
 // Provider call_limits are per-agent; only its main branch accepts updates.
 // Read both branches before a minimal PATCH and verify the reviewed version
 // afterward. No prompt, branch deployment, tool, daily limit or burst change.
 const mainPath=`/v1/convai/agents/${review.agentId}?branch_id=${before.main_branch_id}`;
 const main=object(await read(mainPath));
 if(main.agent_id!==review.agentId||main.branch_id!==before.main_branch_id
  ||JSON.stringify(canonical(object(main.platform_settings).call_limits))!==JSON.stringify(canonical(limits)))throw Error('PARALLEL_CAPACITY_MAIN_MISMATCH');
 const url='https://api.elevenlabs.io'+mainPath;
 let writeError;
 try{
  const response=await fetcher(url,{method:'PATCH',headers:{'xi-api-key':env.ELEVENLABS_API_KEY,'Content-Type':'application/json',Accept:'application/json'},
   body:JSON.stringify({platform_settings:{call_limits:{...limits,agent_concurrency_limit:approval.limit}}}),
   redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok)writeError=Error('PARALLEL_CAPACITY_WRITE_HTTP_'+response.status);
  if(response.redirected||response.url&&response.url!==url)writeError=Error('PARALLEL_CAPACITY_WRITE_UNCONFIRMED');
  await response.body?.cancel();
 }catch{writeError=Error('PARALLEL_CAPACITY_WRITE_UNCONFIRMED');}
 // A timeout may follow an accepted update. Reconcile by GET, never retry a
 // mutation blindly. Configuration drift is a hold, not a new approval.
 const after=object(await read(reviewedPath));
 const afterLimits=object(object(after.platform_settings).call_limits);
 const snapshot=a=>({conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null});
 const expected={...snapshot(before),platform_settings:{...object(before.platform_settings),call_limits:{...limits,agent_concurrency_limit:approval.limit}}};
 if(!recordingAgentMatches(review,after)||afterLimits.agent_concurrency_limit!==approval.limit
  ||JSON.stringify(canonical(snapshot(after)))!==JSON.stringify(canonical(expected)))throw writeError??Error('PARALLEL_CAPACITY_READBACK_MISMATCH');
 return {status:'verified',outgoingLimit:approval.limit,workspaceLimit:capacity.workspaceLimit,providerWrites:true};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log('Approved parallel capacity:',JSON.stringify(await applyApprovedParallelCapacity()));}
 catch(error){console.error('Approved parallel capacity:',/^PARALLEL_CAPACITY_|^VOICE_CAPACITY_/.test(error?.message??'')?error.message:'verification_failed');process.exitCode=1;}
}
