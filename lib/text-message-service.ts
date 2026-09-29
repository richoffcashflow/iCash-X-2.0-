import {db} from '@/lib/stripe-test';
import {sendContiguityText,textPayload} from '@/lib/contiguity';
export async function dispatchTextMessage(accountId:string,messageId:string){
 const from=process.env.CONTIGUITY_FROM,key=process.env.CONTIGUITY_API_KEY;
 if(!from||!key||!process.env.CONTIGUITY_WEBHOOK_SECRET)return {status:'messaging_configuration_required'};
 // Verify stored attachment shape before committing to a charged dispatch.
 const [m]=await db<{body:string;attachments:string[];thread_id:string}[]>(`icash_text_messages?id=eq.${messageId}&account_id=eq.${accountId}&state=eq.ready&select=body,attachments,thread_id`);
 if(!m)return {status:'message_held'};
 const [thread]=await db<{recipient:string}[]>(`icash_text_threads?id=eq.${m.thread_id}&account_id=eq.${accountId}&select=recipient`);if(!thread)return {status:'message_held'};
 textPayload({from,to:thread.recipient,message:m.body,attachments:m.attachments});
 const job=await db<unknown>('rpc/icash_claim_text','POST',{p_account:accountId,p_message:messageId,p_sender:from});if(!job)return {status:'message_held'};
 try{
 const result=await sendContiguityText(job,key);
 await db('rpc/icash_accept_text','POST',{p_account:accountId,p_message:messageId,p_provider:result.messageId});
 return {status:'message_accepted'};
 }catch{
 await db(`icash_text_messages?id=eq.${messageId}&account_id=eq.${accountId}&state=eq.dispatching`,'PATCH',{state:'needs_review',updated_at:new Date().toISOString()});
 return {status:'message_delivery_needs_review'};
 }
}
