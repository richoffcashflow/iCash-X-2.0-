import {sendRequestedBuyerPackages} from './buyer-package-email';
import {propertyQuestionAllowed,type TextProperty} from './text-property-policy.ts';
import {db} from '@/lib/stripe-test';
import {analyzeText,safeTextReplies} from './text-ai-policy.ts';
import {dispatchTextMessage} from '@/lib/text-message-service';
export async function processTextAi(accountId:string,jobId:string){
 if(process.env.ICASH_LIVE_WORK_READY!=='true')return {status:'live_work_not_ready'};
 if(!process.env.OPENAI_API_KEY){
  await db(`icash_text_ai_jobs?id=eq.${jobId}&account_id=eq.${accountId}&state=eq.issued`,'PATCH',{state:'pending',next_attempt_at:new Date(Date.now()+3600000).toISOString()});
  return {status:'text_ai_configuration_required'};
 }
 let claimed=false;
 try{
  const input=await db<{model:string;context:unknown;messages:{direction:string;body:string;attachments?:unknown[];attachmentCount?:number}[]}|null>('rpc/icash_claim_text_ai','POST',{p_account:accountId,p_job:jobId});
  if(!input)return {status:'text_ai_held'};claimed=true;
  const [job]=await db<{thread_id:string}[]>(`icash_text_ai_jobs?id=eq.${jobId}&account_id=eq.${accountId}&select=thread_id`);
  const [thread]=job?await db<{deal_id:string;party:string}[]>(`icash_text_threads?id=eq.${job.thread_id}&account_id=eq.${accountId}&select=deal_id,party`):[];
  if(!thread||!['seller','buyer'].includes(thread.party))throw Error('TEXT_PARTY_REVIEW_REQUIRED');
  const party=thread.party as 'seller'|'buyer';
  // This flag is emitted only by the database's current consent/binding gate, never a message.
  const conversationEnabled=party==='seller'&&!!input.context&&typeof input.context==='object'&&!Array.isArray(input.context)&&(input.context as Record<string,unknown>).sellerConversation===true;
  const viewingCoordination=conversationEnabled&&(input.context as Record<string,unknown>).sellerViewingAvailability===true;
  const [identity]=await db<{principal:string;company_name?:string}[]>(`icash_customer_identities?account_id=eq.${accountId}&select=principal,company_name`);
  const property=party==='seller'?await db<TextProperty|null>('rpc/icash_text_property_context','POST',{p_account:accountId,p_thread:job.thread_id}):null;
  const {analysis,usage,providerId}=await analyzeText({...input,party,conversationEnabled,viewingCoordination,context:{principal:identity?.principal??null,buyerKind:identity?.company_name?.trim()?'company':'individual',qualification:input.context,property,preliminarySellerCeilingCents:property?.ceilingCents??null,offerAuthorized:false}},process.env.OPENAI_API_KEY);
  if(property?.contactOnly&&!analysis.humanRequested&&!analysis.callbackRequested&&!analysis.optedOut&&!analysis.declined)analysis.action='ask_payoff';
  if(!propertyQuestionAllowed(analysis.action,property,input.messages))analysis.action='review';
  await db('rpc/icash_save_text_ai','POST',{p_account:accountId,p_job:jobId,p_analysis:analysis,p_reply:analysis.reply,p_provider:providerId,p_usage:usage});
  if(party==='buyer'&&!analysis.humanRequested&&!analysis.callbackRequested&&!analysis.optedOut&&!analysis.declined)try{await sendRequestedBuyerPackages(accountId,thread.deal_id);}catch{/* Buyer email status remains in the mailbox; never blindly retry a send. */}
  if(analysis.humanRequested||analysis.callbackRequested)return {status:'text_ai_handoff'};
  if(party==='buyer'&&!analysis.optedOut&&!analysis.declined){
   // SQL derives exact prose from the latest whole incoming question and current
   // approved package; neither the model reply nor a caller-provided price is sent.
   const id=await db<string|null>('rpc/icash_queue_buyer_factual_reply','POST',{p_account:accountId,p_job:jobId});
   if(id)return dispatchTextMessage(accountId,id);
   return {status:'text_ai_drafted'};
  }
  if(conversationEnabled&&!analysis.optedOut&&!analysis.declined){
   // The database derives exact copy and rechecks the latest source message, intake,
   // manual/STOP controls, property routing and current send authority. AI prose is never sent.
   const id=await db<string|null>('rpc/icash_queue_seller_conversation_reply','POST',{p_account:accountId,p_job:jobId});
   if(id)return dispatchTextMessage(accountId,id);
   return {status:'text_ai_drafted'};
  }
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
