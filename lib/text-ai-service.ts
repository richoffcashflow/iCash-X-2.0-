import {db} from '@/lib/stripe-test';
import {analyzeText,safeTextReplies} from './text-ai-policy.ts';
import {dispatchTextMessage} from '@/lib/text-message-service';
export async function processTextAi(accountId:string,jobId:string){
 if(!process.env.OPENAI_API_KEY){
  await db(`icash_text_ai_jobs?id=eq.${jobId}&account_id=eq.${accountId}&state=eq.issued`,'PATCH',{state:'pending',next_attempt_at:new Date(Date.now()+3600000).toISOString()});
  return {status:'text_ai_configuration_required'};
 }
 let claimed=false;
 try{
  const input=await db<{model:string;context:unknown;messages:{direction:string;body:string}[]}|null>('rpc/icash_claim_text_ai','POST',{p_account:accountId,p_job:jobId});
  if(!input)return {status:'text_ai_held'};claimed=true;
  const {analysis,usage,providerId}=await analyzeText(input,process.env.OPENAI_API_KEY);
  await db('rpc/icash_save_text_ai','POST',{p_account:accountId,p_job:jobId,p_analysis:analysis,p_reply:analysis.reply,p_provider:providerId,p_usage:usage});
  if(analysis.humanRequested||analysis.callbackRequested)return {status:'text_ai_handoff'};
  const safe=safeTextReplies[analysis.action];
  if(safe){
   const id=await db<string|null>('rpc/icash_queue_ai_reply','POST',{p_account:accountId,p_job:jobId,p_reply:safe});
   if(id)return dispatchTextMessage(accountId,id);
  }
  return {status:'text_ai_drafted'};
 }catch{
  // The model may have consumed tokens. Never automatically repeat a claimed request.
  if(claimed)await db(`icash_text_ai_jobs?id=eq.${jobId}&account_id=eq.${accountId}&state=eq.analyzing`,'PATCH',{state:'needs_review',updated_at:new Date().toISOString()});
  return {status:'text_ai_needs_review'};
 }
}
