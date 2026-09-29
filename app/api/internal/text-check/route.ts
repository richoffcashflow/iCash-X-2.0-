import {createHash} from 'node:crypto';
import {db} from '@/lib/stripe-test';
import {sendContiguityText} from '@/lib/contiguity';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request){
 const headers={'Cache-Control':'private, no-store'};
 const token=request.headers.get('authorization')?.replace(/^Bearer /,'');
 if(!token||!/^[a-f0-9]{64}$/.test(token))return new Response(null,{status:401,headers});
 const key=process.env.CONTIGUITY_API_KEY,from=process.env.CONTIGUITY_FROM;
 if(!key||!from||!process.env.CONTIGUITY_WEBHOOK_SECRET)return new Response(null,{status:503,headers});
 let job:{id:string;from:string;to:string;message:string}|null=null;
 try{
  job=await db('rpc/icash_claim_text_diagnostic','POST',{p_hash:createHash('sha256').update(token).digest('hex'),p_sender:from});
  if(!job)return new Response(null,{status:409,headers});
  const receipt=await sendContiguityText({from:job.from,to:job.to,message:job.message},key);
  await db(`icash_text_diagnostics?id=eq.${job.id}&state=eq.dispatching`,'PATCH',{state:'accepted',provider_id:receipt.messageId,updated_at:new Date().toISOString()});
  return Response.json({status:'accepted',costStatus:'unknown'},{headers});
 }catch{
  if(job)try{await db(`icash_text_diagnostics?id=eq.${job.id}&state=eq.dispatching`,'PATCH',{state:'needs_review',updated_at:new Date().toISOString()});}catch{}
  return Response.json({status:'needs_review_do_not_retry'},{status:503,headers});
 }
}
