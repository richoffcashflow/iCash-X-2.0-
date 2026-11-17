import type {ResearchDb} from './dealmachine-request.ts';

type Receipt={httpStatus:number|null;raw:unknown;rawText:string;headers?:{minuteRemaining:number|null;dayRemaining:number|null;date:string|null;age:string|null};outcome?:string};
type CreditStatus='provider_credit_exhausted'|'provider_credit_available'|'credit_check_held'|'credit_check_unavailable'|'credit_check_not_requested';
const statuses=new Set<CreditStatus>(['provider_credit_exhausted','provider_credit_available','credit_check_held','credit_check_unavailable','credit_check_not_requested']);
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const numberHeader=(response:Response,name:string)=>{const value=response.headers.get(name);return value!==null&&/^\d{1,10}$/.test(value)?Number(value):null;};

/** Keep original bytes and freshness evidence; neither a missing header nor
 * cumulative usage is converted into positive balance or a request charge. */
export async function readDealMachineCreditReceipt(response:Response):Promise<Receipt>{
 if(!response.body)throw Error('CREDIT_RESPONSE_UNAVAILABLE');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536)throw Error('CREDIT_RESPONSE_TOO_LARGE');chunks.push(value);}}
 finally{void reader.cancel().catch(()=>null);reader.releaseLock();}
 const rawText=Buffer.concat(chunks).toString('utf8');let raw:unknown=null;try{raw=JSON.parse(rawText);}catch{}
 const date=response.headers.get('Date'),age=response.headers.get('Age');
 if((date!==null&&date.length>128)||(age!==null&&age.length>32))throw Error('CREDIT_HEADERS_TOO_LARGE');
 return {httpStatus:response.status,raw,rawText,headers:{minuteRemaining:numberHeader(response,'X-RateLimit-Remaining'),dayRemaining:numberHeader(response,'X-RateLimit-Day-Remaining'),date,age}};
}

/** An identical journal write may be retried; no caller repeats the request. */
export async function recordDealMachineCreditRefusal(db:ResearchDb,requestId:string,receipt:Receipt){
 for(let attempt=0;attempt<2;attempt++)try{
  const result=await db<unknown>('rpc/icash_record_dealmachine_credit_refusal','POST',{p_request:requestId,p_receipt:receipt});
  return result==='provider_credit_exhausted';
 }catch{if(attempt===1)return false;}
 return false;
}

/** SQL owns the interval, current source and request quota. This service can
 * issue only one free usage GET for its durable claim; it never buys or replays. */
export async function refreshDealMachineCreditWait(db:ResearchDb,transport:typeof fetch=fetch,env=process.env):Promise<{status:CreditStatus;nextCheckAt?:string}>{
 const release=env.VERCEL_GIT_COMMIT_SHA??env.RAILWAY_GIT_COMMIT_SHA;
 if(env.VERCEL_ENV!=='production'||!/^dm_sk_live_[A-Za-z0-9_-]+$/.test(env.DEALMACHINE_API_KEY??'')||!release||!/^[a-f0-9]{40}$/.test(release))return {status:'credit_check_not_requested'};
 let claim:{checkId:string;requestId:string}|null;
 try{claim=await db<typeof claim>('rpc/icash_claim_dealmachine_credit_check','POST',{p_release:release});}
 catch{return {status:'credit_check_unavailable'};}
 if(!claim){
  try{
   const state=await db<{status:CreditStatus;nextCheckAt?:string}>('rpc/icash_dealmachine_credit_status','POST',{});
   return state&&statuses.has(state.status)?{status:state.status,...(typeof state.nextCheckAt==='string'?{nextCheckAt:state.nextCheckAt}:{})}:{status:'credit_check_unavailable'};
  }catch{return {status:'credit_check_unavailable'};}
 }
 if(!uuid(claim.checkId)||!uuid(claim.requestId))return {status:'credit_check_unavailable'};
 let receipt:Receipt={httpStatus:null,raw:null,rawText:'',outcome:'read_unavailable'};
 let metrics:Record<string,unknown>={outcome:'unknown'};
 try{
  const response=await transport('https://api.v2.dealmachine.com/v1/usage',{
   method:'GET',headers:{Authorization:`Bearer ${env.DEALMACHINE_API_KEY}`,'Cache-Control':'no-cache, max-age=0'},
   redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),
  });
  receipt=await readDealMachineCreditReceipt(response);
  // /usage credits.used is a billing-period total, not this GET's charge.
  metrics={outcome:response.ok&&receipt.raw!==null?'response':'http_error',httpStatus:response.status,
   minuteRemaining:numberHeader(response,'X-RateLimit-Remaining'),dayRemaining:numberHeader(response,'X-RateLimit-Day-Remaining'),
   minuteLimit:numberHeader(response,'X-RateLimit-Limit'),minuteReset:numberHeader(response,'X-RateLimit-Reset'),dayLimit:numberHeader(response,'X-RateLimit-Day-Limit'),retryAfter:numberHeader(response,'Retry-After')};
 }catch{/* Retain an unknown read; never substitute an invented balance. */}
 // A lost acknowledgment is safe to retry only with the same request/evidence.
 for(let attempt=0;attempt<2;attempt++)try{await db('rpc/icash_finish_dealmachine_request','POST',{p_request:claim.requestId,p_result:metrics});break;}
 catch{/* Persist the original usage response even if metrics are unavailable. */}
 for(let attempt=0;attempt<2;attempt++)try{
  const status=await db<CreditStatus>('rpc/icash_record_dealmachine_credit_check','POST',{p_check:claim.checkId,p_receipt:receipt});
  return {status:statuses.has(status)?status:'credit_check_unavailable'};
 }catch{if(attempt===1)return {status:'credit_check_unavailable'};}
 return {status:'credit_check_unavailable'};
}
