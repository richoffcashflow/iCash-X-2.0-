import type {ResearchDb} from './dealmachine-request.ts';

export class DiscoveryEstimateHeld extends Error {constructor(){super('DISCOVERY_ESTIMATE_HELD');}}
type Claim={status:'held'|'cached'|'request';token?:string;response?:unknown};
/** A shared lease covers only the free estimate. Paid admission stays separate. */
export async function requestDiscoveryEstimate(db:ResearchDb,accountId:string,scope:object,plan:unknown,policy:unknown,query:object,request:()=>Promise<unknown>){
 const claim=await db<Claim>('rpc/icash_claim_discovery_estimate','POST',{
  p_account:accountId,p_scope:scope,p_plan:plan??null,p_policy:policy??null,p_query:query,
 });
 if(claim?.status==='cached'&&claim.response!==undefined)return claim.response;
 if(claim?.status!=='request'||typeof claim.token!=='string'||!/^[0-9a-f-]{36}$/.test(claim.token))throw new DiscoveryEstimateHeld();
 let raw:unknown;
 try{raw=await request();}catch(error){
  await db('rpc/icash_finish_discovery_estimate','POST',{p_account:accountId,p_token:claim.token,p_response:null}).catch(()=>null);
  throw error;
 }
 if(!await db<boolean>('rpc/icash_finish_discovery_estimate','POST',{p_account:accountId,p_token:claim.token,p_response:raw}))throw Error('DISCOVERY_ESTIMATE_INVALID');
 return raw;
}
