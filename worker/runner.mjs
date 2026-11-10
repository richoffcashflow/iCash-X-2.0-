import {runQueuedScreening} from '../lib/screening-job.ts';
// Deliberately exclude provider bodies, URLs, tokens and customer data from logs.
export class WorkerOperationError extends Error{
 constructor(code,operation,httpStatus=null,databaseCode=null,requestCode=null){super(code);this.code=code;this.operation=operation;this.httpStatus=httpStatus;this.databaseCode=databaseCode;this.requestCode=requestCode;}
}
const requestFailureCodes=new Set(['REQUEST_TIMEOUT','REQUEST_FAILED']);
const requestFailureCode=error=>error?.name==='TimeoutError'||error?.name==='AbortError'?'REQUEST_TIMEOUT':'REQUEST_FAILED';
export function workerFailureDetails(error){
 return error instanceof WorkerOperationError
  ?{code:error.code,operation:error.operation,httpStatus:error.httpStatus,...(databaseFailureCodes.has(error.databaseCode)?{databaseCode:error.databaseCode}:{}),...(requestFailureCodes.has(error.requestCode)?{requestCode:error.requestCode}:{})}
  :{code:requestFailureCode(error)};
}
// Only fixed database error codes leave this boundary. Provider messages,
// query text, details, hints and request tokens never enter operational logs.
const databaseFailureCodes=new Set(['57014','55P03','40P01','53300','53400','08000','08001','08003','08004','08006','08007','08P01','42501','42883','42P01','42702','42703','PGRST202','PGRST204','PGRST205']);
async function databaseFailureCode(response){
 const reader=response.body?.getReader();
 if(!reader)return null;
 const decoder=new TextDecoder();let body='',bytes=0;
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   bytes+=value.byteLength;if(bytes>4096)return null;
   body+=decoder.decode(value,{stream:true});
  }
  body+=decoder.decode();
  const code=JSON.parse(body)?.code;
  return databaseFailureCodes.has(code)?code:null;
 }catch{return null;}finally{try{await reader.cancel();}catch{/* Diagnostic failure preserves the original HTTP failure. */}reader.releaseLock();}
}
export async function tick(rpc, screen=runQueuedScreening){
 const job=await rpc('icash_claim_screening',{});
 if(!job)return false;
 let result=null,error=null;
 try{result=screen(job.snapshot);}catch(e){error=e?.message==='INVALID_SNAPSHOT'?'INVALID_SNAPSHOT':'SCREENING_FAILED';}
 // If completion times out, the lease will expire. Only this pure screening job is retryable.
 await rpc('icash_finish_screening',{p_id:job.id,p_token:job.leaseToken,p_result:result,p_error:error});
 return true;
}
export function createRpc(url,key,transport=fetch){
 const base=new URL(url);
 if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co')||!key)throw new Error('Invalid worker configuration');
 return async(name,args)=>{
  if(!['icash_claim_screening','icash_finish_screening','icash_next_automation','icash_next_automation_lane','icash_record_service_heartbeat'].includes(name))throw new Error('Unsupported worker operation');
  let response;
  try{
   response=await transport(new URL('/rest/v1/rpc/'+name,base),{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(args),redirect:'error',signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new WorkerOperationError('SCREENING_DATABASE_UNAVAILABLE',name,response.status,await databaseFailureCode(response));
   const body=await response.text();return body?JSON.parse(body):null;
  }catch(error){
   if(error instanceof WorkerOperationError)throw error;
   // Network/body failures are failed claims too. Keep their stage for the
   // existing recurring-failure monitor without logging payloads or retrying.
   throw new WorkerOperationError('SCREENING_DATABASE_UNAVAILABLE',name,response?.status??null,null,requestFailureCode(error));
  }
 };
}

/** One-use ticket is minted in the shared DB; the API key stays on Vercel. No external call retries. */
export async function automationTick(rpc,transport=fetch,lane){
 if(lane!==undefined&&!['general','research','voice','messages','recovery'].includes(lane))throw Error('INVALID_AUTOMATION_LANE');
 const ticket=await rpc(lane===undefined?'icash_next_automation':'icash_next_automation_lane',lane===undefined?{}:{p_lane:lane});
 if(!ticket)return false;
 if(typeof ticket.token!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){2}$/.test(ticket.token))throw new Error('INVALID_AUTOMATION_TICKET');
 // Research can include a 120-second synchronous export followed by original
 // receipt persistence. The capability is still sent exactly once.
 const timeout=['research','general'].includes(lane)?235000:115000;
 let r;
 try{r=await transport('https://www.geticashx.com/api/internal/automation',{method:'POST',headers:{Authorization:'Bearer '+ticket.token},redirect:'error',signal:AbortSignal.timeout(timeout)});}
 catch(error){throw new WorkerOperationError('AUTOMATION_HELD','automation_dispatch',null,null,requestFailureCode(error));}
 // Dispatch needs only the status and durable-hold header. Release successful
 // responses too, so continuous work cannot accumulate unread connections.
 // A cleanup failure cannot overturn an already returned dispatch outcome.
 try{await r.body?.cancel();}catch{/* No retry; preserve the original status below. */}
 if(!r.ok){
  // A failed job remains held and visible in operator diagnostics. Once the
  // API confirms that exact one-use attempt was durably held, it must not put
  // unrelated jobs behind worker-slot infrastructure backoff. No ticket is
  // reused; the next poll still asks the database for a fresh capability.
  if(r.status===503&&r.headers.get('x-icash-automation-outcome')==='job-held')return true;
  throw new WorkerOperationError('AUTOMATION_HELD','automation_dispatch',r.status);
 }
 return true;
}
