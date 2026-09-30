import {titleConfirmationInstructions} from './title-confirmation-instructions';
import {db} from '@/lib/stripe-test';
import {titleEmailAddress} from '@/lib/title-inbound-policy';
/** One claimed send; ambiguous delivery is never automatically retried. */
export async function dispatchTitleFollowup(accountId:string,taskId:string){
 const retry=async()=>db(`icash_title_tasks?id=eq.${taskId}&account_id=eq.${accountId}&email_state=eq.issued`,'PATCH',{email_state:'waiting',email_retry_at:new Date(Date.now()+6*3600000).toISOString(),updated_at:new Date().toISOString()});
 if(!process.env.RESEND_API_KEY||!process.env.RESEND_RECEIVING_WEBHOOK_SECRET||!titleEmailAddress(process.env.ICASH_TITLE_FROM_EMAIL)||!titleEmailAddress(process.env.ICASH_TITLE_REPLY_EMAIL)){
 await retry();return {status:'title_followup_configuration_required'};
 }
 let job:{requestId:string;recipient:string;address:string}|null;
 try{job=await db('rpc/icash_claim_title_followup','POST',{p_account:accountId,p_task:taskId});}catch{
 // If the claim response was lost, the row may already be dispatching. The conditional retry cannot reset it.
 await retry();return {status:'title_followup_spending_held'};
 }
 if(!job){await retry();return {status:'title_followup_held'};}
 try{
 const res=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`title-followup-${taskId}`},body:JSON.stringify({from:process.env.ICASH_TITLE_FROM_EMAIL,reply_to:process.env.ICASH_TITLE_REPLY_EMAIL,to:[job.recipient],subject:`[ICX-T:${job.requestId}] Following up on title opening`,text:`Hello,\n\nThis is the automated iCash X coordination assistant following up on our title-opening request for ${job.address.replace(/[\r\n]/g,' ').slice(0,300)}. Could you confirm whether your office can accept the file, the assigned closer, and any missing documents or deadlines?\n\nIf you cannot handle the file or would prefer no further contact, please reply to let us know. We will hold further automatic follow-ups on this request. This message does not confirm title opening, deposit receipt or closing. Please do not send new wire instructions by email.\n\nThank you.\n\n${titleConfirmationInstructions}`}),signal:AbortSignal.timeout(15000)});
 if(!res.ok)throw Error();const result=await res.json();if(typeof result.id!=='string'||!result.id)throw Error();
 await db(`icash_title_tasks?id=eq.${taskId}&account_id=eq.${accountId}&email_state=eq.dispatching`,'PATCH',{email_state:'sent',email_provider_id:result.id,updated_at:new Date().toISOString()});
 // Leave cancelled/dismissed state intact if a reply or user action raced the provider request.
 await db(`icash_title_tasks?id=eq.${taskId}&account_id=eq.${accountId}&state=eq.scheduled&email_state=eq.sent`,'PATCH',{state:'done',updated_at:new Date().toISOString()});
 return {status:'title_followup_sent'};
 }catch{
 await db(`icash_title_tasks?id=eq.${taskId}&account_id=eq.${accountId}&email_state=eq.dispatching`,'PATCH',{email_state:'needs_review',updated_at:new Date().toISOString()});
 return {status:'title_followup_needs_reconciliation'};
 }
}
