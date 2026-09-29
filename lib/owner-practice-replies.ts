import {db} from './stripe-test';
import {analyzeText} from './text-ai-policy';
import {sendContiguityText} from './contiguity';

/** Only a service-authorized, expiring owner practice session can claim an incoming event. */
export async function ownerPracticeReply(eventId:string){
 if(!process.env.OPENAI_API_KEY||!process.env.CONTIGUITY_API_KEY)return;
 let job:{id:string;thread:string;message:string;human:boolean;attachments:boolean;messages:{direction:string;body:string}[]}|null=null;
 let outgoing:{id:string;account:string;from:string;to:string;message:string}|null=null;
 try{
  job=await db('rpc/icash_claim_owner_reply','POST',{p_event:eventId});
  if(!job)return;
  const result=job.human||job.attachments
   ?{analysis:{action:'handoff',summary:'Owner requested review. No callback booked.',humanRequested:true,callbackRequested:job.human,facts:[]},usage:null,providerId:null}
   :await analyzeText({model:'gpt-4.1-mini',context:{practice:true,timezone:'America/Chicago'},messages:job.messages},process.env.OPENAI_API_KEY);
  const action=result.analysis.humanRequested||result.analysis.callbackRequested?'handoff':result.analysis.action;
  outgoing=await db('rpc/icash_prepare_owner_reply','POST',{p_attempt:job.id,p_action:action,p_result:result});
  if(!outgoing)return;
  const receipt=await sendContiguityText({from:outgoing.from,to:outgoing.to,message:outgoing.message},process.env.CONTIGUITY_API_KEY);
  await db('rpc/icash_accept_text','POST',{p_account:outgoing.account,p_message:outgoing.id,p_provider:receipt.messageId});
  await db(`icash_owner_reply_attempts?id=eq.${job.id}`,'PATCH',{state:'accepted'});
 }catch{
  // Unknown outcomes are retained for reconciliation, never automatically retried.
  if(job)try{await db(`icash_owner_reply_attempts?id=eq.${job.id}`,'PATCH',{state:'held'});}catch{}
  if(job)try{
   await db(`icash_text_ai_jobs?message_id=eq.${job.message}&state=eq.analyzing`,'PATCH',{state:'needs_review'});
   await db(`icash_owner_reply_sessions?thread_id=eq.${job.thread}`,'PATCH',{enabled:false});
  }catch{}
  if(outgoing)try{await db(`icash_text_messages?id=eq.${outgoing.id}&state=eq.dispatching`,'PATCH',{state:'needs_review'});}catch{}
 }
}
