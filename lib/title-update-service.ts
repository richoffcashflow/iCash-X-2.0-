import {db} from '@/lib/stripe-test';
import {completedSigningPdf} from '@/lib/signing-service';
import {closingPayoutNote} from './closing-setup';
import {titleEmailAddress} from './title-inbound-policy';
type UpdateTask={id:string;deal_id:string;state:string;email_state:string;payload:{type?:string;envelopeId?:string;payout?:Record<string,unknown>}};
/** Later documents and preferences use the original title thread and a single-use claim. */
export async function dispatchTitleUpdate(accountId:string,taskId:string){
 const [task]=await db<UpdateTask[]>(`icash_title_tasks?id=eq.${taskId}&account_id=eq.${accountId}&kind=eq.document_update&select=id,deal_id,state,email_state,payload`);
 if(!task||task.state!=='scheduled'||task.email_state!=='issued')return {status:'title_followup_held'};
 const retry=()=>db(`icash_title_tasks?id=eq.${taskId}&account_id=eq.${accountId}&email_state=eq.issued`,'PATCH',{email_state:'waiting',email_retry_at:new Date(Date.now()+6*3600000).toISOString(),updated_at:new Date().toISOString()});
 if(process.env.ICASH_LIVE_WORK_READY!=='true'){await retry();return {status:'live_work_not_ready'};}
 if(!process.env.RESEND_API_KEY||!process.env.RESEND_RECEIVING_WEBHOOK_SECRET||!titleEmailAddress(process.env.ICASH_TITLE_FROM_EMAIL)||!titleEmailAddress(process.env.ICASH_TITLE_REPLY_EMAIL)){
  await retry();return {status:'title_followup_configuration_required'};
 }
 let attachments:{filename:string;content:string}[]=[];let details:string;
 try{
  if(task.payload.type==='assignment'&&task.payload.envelopeId){
   const pdf=await completedSigningPdf(accountId,task.payload.envelopeId);
   if(pdf.byteLength>20*1024*1024)throw Error('Attachment requires review');
   attachments=[{filename:'executed-assignment-agreement.pdf',content:Buffer.from(pdf).toString('base64')}];
   details='The buyer assignment is now signed. Please add the attached executed assignment to the file, confirm receipt, and let us know any remaining requirements. The executed agreements control the terms.';
  }else if(task.payload.type==='payout'&&task.payload.payout){
   details=closingPayoutNote({...task.payload.payout,detailsSharedWithTitle:false});
   if(!details)throw Error('Payment preference requires review');
  }else throw Error('Unknown update');
 }catch{
  await db(`icash_title_tasks?id=eq.${taskId}&account_id=eq.${accountId}&email_state=eq.issued`,'PATCH',{email_state:'needs_review',state:'needs_review',updated_at:new Date().toISOString()});
  return {status:'title_followup_needs_reconciliation'};
 }
 let job:{requestId:string;recipient:string;address:string}|null;
 try{job=await db('rpc/icash_claim_title_update','POST',{p_account:accountId,p_task:taskId,p_payload:task.payload});}
 catch{await retry();return {status:'title_followup_spending_held'};}
 if(!job){await retry();return {status:'title_followup_held'};}
 try{
  const res=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`title-followup-${taskId}`},body:JSON.stringify({from:process.env.ICASH_TITLE_FROM_EMAIL,reply_to:process.env.ICASH_TITLE_REPLY_EMAIL,to:[job.recipient],subject:`[ICX-T:${job.requestId}] ${task.payload.type==='assignment'?'Signed buyer assignment':'Updated payment preference'}`,text:`Hello,\n\nThis is the automated iCash X coordination assistant for ${job.address.replace(/[\r\n]/g,' ').slice(0,300)}.\n\n${details}\n\nPlease reply with confirmation or any questions. This update does not confirm title acceptance, deposit receipt, closing or disbursement. Payment details must be collected through your secure process and independently verified; do not rely on emailed wire changes.`,...(attachments.length?{attachments}:{})}),signal:AbortSignal.timeout(15000)});
  if(!res.ok)throw Error('Delivery requires review');const result=await res.json();if(typeof result.id!=='string'||!result.id)throw Error('Receipt missing');
  await db(`icash_title_tasks?id=eq.${taskId}&account_id=eq.${accountId}&email_state=eq.dispatching`,'PATCH',{email_state:'sent',email_provider_id:result.id,updated_at:new Date().toISOString()});
  await db(`icash_title_tasks?id=eq.${taskId}&account_id=eq.${accountId}&email_state=eq.sent&state=eq.scheduled`,'PATCH',{state:'done',updated_at:new Date().toISOString()});
  return {status:'title_followup_sent'};
 }catch{
  // Never resend a possibly accepted email after a timeout or lost database response.
  await db(`icash_title_tasks?id=eq.${taskId}&account_id=eq.${accountId}&email_state=eq.dispatching`,'PATCH',{email_state:'needs_review',state:'needs_review',updated_at:new Date().toISOString()});
  return {status:'title_followup_needs_reconciliation'};
 }
}
