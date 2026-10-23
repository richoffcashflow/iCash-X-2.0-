import {boundedBytes} from './required-call-recording-provider.ts';
type Db=<T=unknown>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Reader=(path:string,region?:'global'|'us')=>Promise<unknown>;
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
/** Fixed metadata GETs on the same provider region used by each call lane. */
export async function readVoiceCapacityProvider(path:string,region:'global'|'us'='global',env:Record<string,string|undefined>=process.env,fetcher:typeof fetch=fetch){
 if(!env.ELEVENLABS_API_KEY||!(/^\/v1\/user\/subscription$/.test(path)||/^\/v1\/convai\/agents\/agent_[A-Za-z0-9]+(?:\?branch_id=agtbrch_[A-Za-z0-9]+)?$/.test(path)))throw Error('VOICE_CAPACITY_READ_REQUIRED');
 const url=(region==='us'?'https://api.us.elevenlabs.io':'https://api.elevenlabs.io')+path;
 const response=await fetcher(url,{method:'GET',headers:{'xi-api-key':env.ELEVENLABS_API_KEY,Accept:'application/json'},cache:'no-store',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('VOICE_CAPACITY_READ_HTTP_'+response.status);
 if(response.redirected||response.url&&response.url!==url)throw Error('VOICE_CAPACITY_READ_UNAVAILABLE');
 return JSON.parse((await boundedBytes(response,262144)).toString('utf8')) as unknown;
}
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
  const agent=await read(`/v1/convai/agents/${encodeURIComponent(target.agentId)}${branch?'?branch_id='+encodeURIComponent(branch):''}`,target.branchId===null?'global':'us');
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
