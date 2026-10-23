type Db=<T=unknown>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Reader=<T=unknown>(path:string)=>Promise<T>;
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
// Verified against https://elevenlabs.io/pricing/agents on 2026-10-23.
// Launch conservatively at four total calls, even on larger subscriptions.
const planLimits:Record<string,number>={free:4,starter:6,creator:10,pro:20,scale:30,business:40};
export function voiceCapacitySnapshot(subscription:unknown,agent:unknown){
 const s=object(subscription),a=object(agent),limits=object(object(a.platform_settings).call_limits);
 const workspace=typeof s.tier==='string'?planLimits[s.tier]:undefined;
 const limit=limits.agent_concurrency_limit;
 if(!workspace||!Number.isInteger(limit)||Number(limit)<-1||limit===0||limits.bursting_enabled!==false)return null;
 return {workspaceLimit:Math.min(4,workspace),agentLimit:limit===-1?Math.min(4,workspace):Math.min(4,workspace,Number(limit)),tier:s.tier};
}
/** Read-only provider checks. No calls, simulations, plan changes or burst mode. */
export async function refreshVoiceCapacity(db:Db,read:Reader,review?:{agentId:string;branchId:string}|null){
 const targets=await db<{agentId:string;branchId:string|null}[]>('rpc/icash_voice_capacity_targets','POST',{});
 if(!targets.length)return {status:'no_agents'};
 const subscription=await read('/v1/user/subscription');
 const capacities:{agentId:string;limit:number}[]=[];let workspaceLimit=1;let tier='';
 for(const target of targets.slice(0,12)){
  const branch=target.branchId??(review?.agentId===target.agentId?review.branchId:null);
  const agent=await read(`/v1/convai/agents/${encodeURIComponent(target.agentId)}${branch?'?branch_id='+encodeURIComponent(branch):''}`);
  if(object(agent).agent_id!==target.agentId)throw Error('VOICE_CAPACITY_AGENT_MISMATCH');
  const snapshot=voiceCapacitySnapshot(subscription,agent);if(!snapshot)throw Error('VOICE_CAPACITY_UNVERIFIED');
  workspaceLimit=snapshot.workspaceLimit;tier=String(snapshot.tier);
  const existing=capacities.find(c=>c.agentId===target.agentId);
  if(existing)existing.limit=Math.min(existing.limit,snapshot.agentLimit);else capacities.push({agentId:target.agentId,limit:snapshot.agentLimit});
 }
 if(targets.length>12)throw Error('VOICE_CAPACITY_TARGET_LIMIT');
 await db('rpc/icash_save_voice_capacity','POST',{p_limit:workspaceLimit,p_agents:capacities,p_source:`provider subscription ${tier}; published plan limits 2026-10-23; launch ceiling 4`});
 return {status:'verified',workspaceLimit,agents:capacities.length};
}
