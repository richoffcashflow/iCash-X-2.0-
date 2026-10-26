import {randomUUID} from 'node:crypto';
export type ResearchDb=<T=unknown>(path:string,method?:string,body?:unknown)=>Promise<T>;
export type ResearchRequestKind='search_estimate'|'property_search'|'owner_preview'|'owner_lookup'|'exclusion_create'|'exclusion_sync'|'geography'|'buyer_estimate'|'buyer_search'|'property_lookup'|'photo';
export class DealMachineQuotaError extends Error {constructor(){super('DEALMACHINE_QUOTA_WAIT');}}
const integer=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
/** One admission, one provider request. Metrics never retry a provider action. */
export async function dealMachineRequest(db:ResearchDb,kind:ResearchRequestKind,request:()=>Promise<Response>,scope:{accountId?:string;operationKey?:string}={}){
 const id=randomUUID();
 const admitted=await db<boolean>('rpc/icash_take_dealmachine_request','POST',{p_kind:kind,p_account:scope.accountId??null,p_operation:scope.operationKey??null,p_request:id});
 if(admitted===false)throw new DealMachineQuotaError();
 if(admitted!==true)throw new Error('PROVIDER_RATE_LIMIT');
 return finishAdmittedDealMachineRequest(db,id,request);
}
/** Used only after a durable SQL claim has admitted this exact request ID. */
export async function finishAdmittedDealMachineRequest(db:ResearchDb,id:string,request:()=>Promise<Response>){
 let response:Response;
 try{response=await request();}catch(error){await db('rpc/icash_finish_dealmachine_request','POST',{p_request:id,p_result:{outcome:'unknown'}}).catch(()=>null);throw error;}
 let raw:unknown;try{raw=await response.json();}catch{raw=null;}
 const o=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
 const c=o.credits&&typeof o.credits==='object'?o.credits as Record<string,unknown>:{};
 const t=o.totals&&typeof o.totals==='object'?o.totals as Record<string,unknown>:{};
 const header=(name:string)=>{const v=response.headers.get(name);return v!==null&&/^\d{1,10}$/.test(v)?Number(v):null;};
 await db('rpc/icash_finish_dealmachine_request','POST',{p_request:id,p_result:{outcome:response.ok&&raw!==null?'response':'http_error',httpStatus:response.status,returned:Array.isArray(o.data)?o.data.length:integer(t.found),creditsUsed:integer(c.used),minuteRemaining:header('X-RateLimit-Remaining'),dayRemaining:header('X-RateLimit-Day-Remaining'),retryAfter:header('Retry-After')}}).catch(()=>null);
 return {ok:response.ok,status:response.status,raw};
}
