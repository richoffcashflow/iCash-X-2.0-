import {boundedBytes} from './required-call-recording-provider.ts';
import {object} from './required-call-recording.ts';
import {receptionTarget,receptionWorkspacePostcallAbsent,type ReceptionConfig} from './general-reception.ts';
import {inspectRecordedReceptionAgent,recordedReceptionToolMatches,type RecordedReceptionConfig,type ReceptionInlineToolEvidence} from './recorded-reception.ts';

// Observation targets only, never runtime approvals. No caller-selected IDs,
// provider mutations, database writes, secret output, or generic proxy surface.
export const incomingReadinessTargets=Object.freeze({
 agentId:receptionTarget.agentId,
 stopToolId:'tool_8601m416c9jzfkp8qydb54q5vhkh',
 profiles:Object.freeze([
  Object.freeze({profile:'owner_quick_test',seconds:60,branchId:'agtbrch_1801m4161ppwfb0t33mcqmfztx8w',expectedVersionId:'agtvrsn_6401m416mha4fg8bbmzkdaw34avs'}),
  Object.freeze({profile:'normal',seconds:600,branchId:'agtbrch_9101m416pfheeb284rmpy0c91xak',expectedVersionId:'agtvrsn_4701m416rcp0fzprqzkvkvg1v2ww'}),
 ]),
});
export type IncomingBranchReadiness={profile:string;maxDurationSeconds:number;branchId:string;expectedVersionId:string;observedVersionId:string|null;observedConfigHash:string|null;draftExists:boolean|null;livePercentage:number|null;providerChecksPass:boolean;inlineTools:ReceptionInlineToolEvidence|null;checks:Record<string,boolean>};
export type IncomingReadiness={status:'checked'|'partial'|'unavailable';checkedAt:string;mode:'read_only';stopToolMatches:boolean;workspacePostcallAbsent:boolean;branches:IncomingBranchReadiness[]};
const origin='https://api.us.elevenlabs.io';
const agentPath='/v1/convai/agents/'+incomingReadinessTargets.agentId;
const paths=[agentPath+'?branch_id='+incomingReadinessTargets.profiles[0].branchId,agentPath+'?branch_id='+incomingReadinessTargets.profiles[1].branchId,agentPath+'/branches?include_archived=true&limit=100','/v1/convai/settings','/v1/convai/tools/'+incomingReadinessTargets.stopToolId] as const;
const record=(v:unknown)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const version=(v:unknown):v is string=>typeof v==='string'&&/^agtvrsn_[A-Za-z0-9]{1,160}$/.test(v);
const branch=(v:unknown):v is string=>typeof v==='string'&&/^agtbrch_[A-Za-z0-9]{1,160}$/.test(v);

export async function readRecordedReceptionReadiness(env:{ELEVENLABS_API_KEY?:string},deps:{fetcher?:typeof fetch;signal?:AbortSignal;now?:()=>number}={}):Promise<IncomingReadiness>{
 const fetcher=deps.fetcher??fetch;
 const checkedAt=new Date((deps.now??Date.now)()).toISOString();
 async function read(path:typeof paths[number]){
  if(!env.ELEVENLABS_API_KEY)throw Error('PROVIDER_READ_UNAVAILABLE');
  const url=origin+path,response=await fetcher(url,{method:'GET',headers:{'xi-api-key':env.ELEVENLABS_API_KEY,Accept:'application/json'},cache:'no-store',redirect:'error',credentials:'omit',signal:deps.signal?AbortSignal.any([deps.signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000)});
  if(!response.ok||response.redirected||response.url&&response.url!==url||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??'')){try{await response.body?.cancel();}catch{}throw Error('PROVIDER_READ_UNAVAILABLE');}
  const value=JSON.parse((await boundedBytes(response,262144)).toString('utf8'));if(!record(value))throw Error('PROVIDER_READ_UNAVAILABLE');return value as Record<string,unknown>;
 }
 const receipts=await Promise.allSettled(paths.map(read));
 const value=(index:number)=>receipts[index].status==='fulfilled'?receipts[index].value:null;
 const listed=object(value(2)),rows=listed.results,meta=object(listed.meta);
 const listComplete=Array.isArray(rows)&&rows.length<100&&(meta.total===undefined||meta.total===rows.length)&&(listed.next_cursor===undefined||listed.next_cursor===null);
 const knownRows=listComplete?rows.map(object):[];
 const workspacePostcallAbsent=value(3)!==null&&receptionWorkspacePostcallAbsent(value(3));
 const stopToolMatches=value(4)!==null&&recordedReceptionToolMatches(incomingReadinessTargets.stopToolId,value(4));
 const branches=incomingReadinessTargets.profiles.map((target,index):IncomingBranchReadiness=>{
  const raw=value(index),a=object(raw),matches=knownRows.filter(r=>r.id===target.branchId),b=matches.length===1?matches[0]:{};
  const exactIdentity=a.agent_id===incomingReadinessTargets.agentId&&a.branch_id===target.branchId&&version(a.version_id)&&branch(a.main_branch_id)&&record(a.conversation_config)&&record(a.platform_settings);
  const main=knownRows.filter(r=>r.id===a.main_branch_id);
  const sharedChecks={providerReadback:raw!==null,branchListComplete:listComplete,uniquePreparedBranch:matches.length===1,canonicalIdentity:exactIdentity,expectedVersion:a.version_id===target.expectedVersionId,mainTrafficUnchanged:main.length===1&&main[0].agent_id===incomingReadinessTargets.agentId&&main[0].current_live_percentage===100&&main[0].is_archived===false,stopToolMatches,workspacePostcallAbsent};
  let inlineTools:ReceptionInlineToolEvidence|null=null;
  let observedConfigHash:string|null=null,checks:Record<string,boolean>={...sharedChecks};
  if(exactIdentity)try{
   // This temporary comparison descriptor contains no approved hash or DB row.
   // Compute from the actual canonical response, then rerun the SAME deployed
   // inspector against that observed hash. Only explicit safe checks are output.
   const c:Partial<RecordedReceptionConfig>&ReceptionConfig={enabled:false,account_id:receptionTarget.accountId,owner_user_id:receptionTarget.ownerUserId,called_number:receptionTarget.calledNumber,agent_id:incomingReadinessTargets.agentId,branch_id:target.branchId,reviewed_version_id:target.expectedVersionId,max_duration_seconds:target.seconds,context_policy:'message_only',stop_tool_id:incomingReadinessTargets.stopToolId,config_hash:''};
   const observation=inspectRecordedReceptionAgent(c as RecordedReceptionConfig,a,b,workspacePostcallAbsent,value(4));
   const verified=inspectRecordedReceptionAgent({...c,config_hash:observation.hash} as RecordedReceptionConfig,a,b,workspacePostcallAbsent,value(4));
   observedConfigHash=observation.hash;inlineTools=verified.inlineTools;checks={...verified.checks,...sharedChecks,canonicalSnapshotInspected:verified.safe};
  }catch{checks.canonicalSnapshotInspected=false;}
  return {profile:target.profile,maxDurationSeconds:target.seconds,branchId:target.branchId,expectedVersionId:target.expectedVersionId,observedVersionId:exactIdentity?String(a.version_id):null,observedConfigHash,draftExists:typeof b.draft_exists==='boolean'?b.draft_exists:null,livePercentage:typeof b.current_live_percentage==='number'&&Number.isFinite(b.current_live_percentage)?b.current_live_percentage:null,inlineTools,providerChecksPass:observedConfigHash!==null&&Object.values(checks).every(Boolean),checks};
 });
 const count=receipts.filter(r=>r.status==='fulfilled').length;
 return {status:count===paths.length?'checked':count===0?'unavailable':'partial',checkedAt,mode:'read_only',stopToolMatches,workspacePostcallAbsent,branches};
}
