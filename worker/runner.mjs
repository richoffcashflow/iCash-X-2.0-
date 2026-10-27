import {runScreeningJob} from '../lib/screening-job.ts';
// Deliberately exclude provider bodies, URLs, tokens and customer data from logs.
export class WorkerOperationError extends Error{
 constructor(code,operation,httpStatus=null){super(code);this.code=code;this.operation=operation;this.httpStatus=httpStatus;}
}
export function workerFailureDetails(error){
 return error instanceof WorkerOperationError
  ?{code:error.code,operation:error.operation,httpStatus:error.httpStatus}
  :{code:error?.name==='TimeoutError'||error?.name==='AbortError'?'REQUEST_TIMEOUT':'REQUEST_FAILED'};
}
export async function tick(rpc, screen=runScreeningJob){
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
  const response=await transport(new URL('/rest/v1/rpc/'+name,base),{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(args),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok){await response.body?.cancel();throw new WorkerOperationError('SCREENING_DATABASE_UNAVAILABLE',name,response.status);}
  const body=await response.text();return body?JSON.parse(body):null;
 };
}

/** One-use ticket is minted in the shared DB; the API key stays on Vercel. No external call retries. */
export async function automationTick(rpc,transport=fetch,lane){
 if(lane!==undefined&&!['general','research','voice','messages','recovery'].includes(lane))throw Error('INVALID_AUTOMATION_LANE');
 const ticket=await rpc(lane===undefined?'icash_next_automation':'icash_next_automation_lane',lane===undefined?{}:{p_lane:lane});
 if(!ticket)return false;
 if(typeof ticket.token!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){2}$/.test(ticket.token))throw new Error('INVALID_AUTOMATION_TICKET');
 const r=await transport('https://www.geticashx.com/api/internal/automation',{method:'POST',headers:{Authorization:'Bearer '+ticket.token},redirect:'error',signal:AbortSignal.timeout(115000)});
 if(!r.ok){await r.body?.cancel();throw new WorkerOperationError('AUTOMATION_HELD','automation_dispatch',r.status);}
 return true;
}
