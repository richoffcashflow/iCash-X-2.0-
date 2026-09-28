import {runScreeningJob} from '../lib/screening-job.ts';
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
  if(!['icash_claim_screening','icash_finish_screening'].includes(name))throw new Error('Unsupported worker operation');
  const response=await transport(new URL('/rest/v1/rpc/'+name,base),{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(args),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('SCREENING_DATABASE_UNAVAILABLE');
  const body=await response.text();return body?JSON.parse(body):null;
 };
}
