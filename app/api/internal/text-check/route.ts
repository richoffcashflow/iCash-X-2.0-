import {analyzeText,safeTextReplies} from '@/lib/text-ai-policy';
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
  const [diagnostic]=await db<{ai_input:string|null}[]>(`icash_text_diagnostics?id=eq.${job.id}&select=ai_input`);
  let message=job.message;
  if(diagnostic?.ai_input){
   if(!process.env.OPENAI_API_KEY)throw Error('TEXT_AI_KEY_MISSING');
   const result=await analyzeText({model:'gpt-4.1-mini',context:{practice:true,stage:'qualification',timezone:'America/Chicago'},messages:[{direction:'incoming',body:diagnostic.ai_input}]},process.env.OPENAI_API_KEY);
   await db(`icash_text_diagnostics?id=eq.${job.id}`,'PATCH',{ai_result:result});
   const safe=safeTextReplies[result.analysis.action];
   if(result.analysis.humanRequested||result.analysis.callbackRequested||!safe)throw Error('TEXT_AI_REVIEW_REQUIRED');
   message='iCash X AI test. '+safe;
  }
  const receipt=await sendContiguityText({from:job.from,to:job.to,message},key);
  await db(`icash_text_diagnostics?id=eq.${job.id}&state=eq.dispatching`,'PATCH',{state:'accepted',provider_id:receipt.messageId,updated_at:new Date().toISOString()});
  return Response.json({status:'accepted',costStatus:'unknown'},{headers});
 }catch(error){
  const code=error instanceof Error&&/^TEXT_AI_[A-Z0-9_]+$/.test(error.message)?error.message:'PROVIDER_OR_STORAGE_OUTCOME_UNKNOWN';
  if(job)try{await db(`icash_text_diagnostics?id=eq.${job.id}&state=eq.dispatching`,'PATCH',{state:'needs_review',error_code:code,updated_at:new Date().toISOString()});}catch{}
  return Response.json({status:'needs_review_do_not_retry'},{status:503,headers});
 }
}
