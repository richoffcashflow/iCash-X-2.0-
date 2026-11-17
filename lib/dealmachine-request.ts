import {randomUUID} from 'node:crypto';
import {readDealMachineCreditReceipt,recordDealMachineCreditRefusal} from './dealmachine-credit-wait.ts';
export type ResearchDb=<T=unknown>(path:string,method?:string,body?:unknown)=>Promise<T>;
export type ResearchRequestKind='search_estimate'|'property_search'|'owner_preview'|'owner_lookup'|'exclusion_create'|'exclusion_sync'|'geography'|'buyer_estimate'|'buyer_search'|'property_lookup'|'photo';
export class DealMachineQuotaError extends Error {readonly requestId:string;constructor(requestId:string){super('DEALMACHINE_QUOTA_WAIT');this.requestId=requestId;}}
const integer=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
/** One admission, one provider request. Metrics never retry a provider action. */
export async function dealMachineRequest(db:ResearchDb,kind:ResearchRequestKind,request:()=>Promise<Response>,scope:{accountId?:string;operationKey?:string}={}){
 const id=randomUUID();
 const admitted=await db<boolean>('rpc/icash_take_dealmachine_request','POST',{p_kind:kind,p_account:scope.accountId??null,p_operation:scope.operationKey??null,p_request:id});
 if(admitted===false)throw new DealMachineQuotaError(id);
 if(admitted!==true)throw new Error('PROVIDER_RATE_LIMIT');
 return finishAdmittedDealMachineRequest(db,id,request);
}
/** Used only after a durable SQL claim has admitted this exact request ID. */
export async function finishAdmittedDealMachineRequest(db:ResearchDb,id:string,request:()=>Promise<Response>){
 let response:Response;
 try{response=await request();}catch(error){await db('rpc/icash_finish_dealmachine_request','POST',{p_request:id,p_result:{outcome:'unknown'}}).catch(()=>null);throw error;}
 // Preserve the exact refusal alongside normal metrics. Read the clone while
 // consuming the original so a bounded clone cancellation cannot stall its tee.
 let creditReceipt:ReturnType<typeof readDealMachineCreditReceipt>|null=null;
 if(response.status===402)try{creditReceipt=readDealMachineCreditReceipt(response.clone()).catch(()=>({httpStatus:null,raw:null,rawText:'',outcome:'read_unavailable'}));}catch{}
 let raw:unknown;try{raw=await response.json();}catch{raw=null;}
 const o=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
 const c=o.credits&&typeof o.credits==='object'?o.credits as Record<string,unknown>:{};
 const t=o.totals&&typeof o.totals==='object'?o.totals as Record<string,unknown>:{};
 const header=(name:string)=>{const v=response.headers.get(name);return v!==null&&/^\d{1,10}$/.test(v)?Number(v):null;};
 const metrics={p_request:id,p_result:{outcome:response.ok&&raw!==null?'response':'http_error',httpStatus:response.status,returned:Array.isArray(o.data)?o.data.length:integer(t.found),creditsUsed:integer(c.used),minuteRemaining:header('X-RateLimit-Remaining'),dayRemaining:header('X-RateLimit-Day-Remaining'),retryAfter:header('Retry-After'),minuteLimit:header('X-RateLimit-Limit'),minuteReset:header('X-RateLimit-Reset'),dayLimit:header('X-RateLimit-Day-Limit')}};
 for(let attempt=0;attempt<(response.status===402?2:1);attempt++)try{await db('rpc/icash_finish_dealmachine_request','POST',metrics);break;}catch{}
 const refusal=creditReceipt?await creditReceipt:null;
 const error=o.error&&typeof o.error==='object'?o.error as Record<string,unknown>:{};
 if(error.code==='export_limit_exceeded'&&response.status===402&&(!refusal||!await recordDealMachineCreditRefusal(db,id,refusal)))throw Error('PROVIDER_CREDIT_EVIDENCE_UNAVAILABLE');
 return {ok:response.ok,status:response.status,raw,requestId:id};
}
