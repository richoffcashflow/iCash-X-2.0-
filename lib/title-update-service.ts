import {prepareTitleCopyDelivery} from './title-copy-delivery';
import {db} from '@/lib/stripe-test';
import {completedSigningPdf,type SigningPdfSource} from '@/lib/signing-service';
import {closingPayoutNote} from './closing-setup';
import {titleEmailAddress} from './title-inbound-policy';
import {titleConfirmationInstructionsFor} from './title-confirmation-instructions';
import {isDeepStrictEqual} from 'node:util';
type UpdateTask={id:string;deal_id:string;state:string;email_state:string;payload:{type?:string;envelopeId?:string;payout?:Record<string,unknown>}};
type DeliverySource={version:string;task:{id:string;account_id:string;deal_id:string};document?:{pdfSource:SigningPdfSource}|null};
type PreparationSource=Omit<DeliverySource,'task'>&{task:DeliverySource['task']&{payload:UpdateTask['payload']}};
type PreparedDelivery={preparation:PreparationSource|null;delivery:DeliverySource|null};
/** Later documents and preferences use the original title thread and a single-use claim. */
export async function dispatchTitleUpdate(accountId:string,taskId:string){
 const [task]=await db<UpdateTask[]>(`icash_title_tasks?id=eq.${taskId}&account_id=eq.${accountId}&kind=eq.document_update&select=id,deal_id,state,email_state,payload`);
 if(!task||task.state!=='scheduled'||task.email_state!=='issued')return {status:'title_followup_held'};
 const retry=()=>db(`icash_title_tasks?id=eq.${taskId}&account_id=eq.${accountId}&email_state=eq.issued`,'PATCH',{email_state:'waiting',email_retry_at:new Date(Date.now()+6*3600000).toISOString(),updated_at:new Date().toISOString()});
 if(process.env.ICASH_LIVE_WORK_READY!=='true'){await retry();return {status:'live_work_not_ready'};}
 if(!process.env.RESEND_API_KEY||!process.env.RESEND_RECEIVING_WEBHOOK_SECRET||!titleEmailAddress(process.env.ICASH_TITLE_FROM_EMAIL)||!titleEmailAddress(process.env.ICASH_TITLE_REPLY_EMAIL)){
  await retry();return {status:'title_followup_configuration_required'};
 }
 let attachments:{filename:string;content:string}[]=[];let details:string;let deliverySource:DeliverySource|null=null;
 if(task.payload?.type!=='executed_copy'){
  let prepared:PreparedDelivery|null;
  try{prepared=await db('rpc/icash_prepare_title_task_delivery','POST',{p_account:accountId,p_task:taskId});}
  catch{await retry();return {status:'title_followup_spending_held'};}
  const source=prepared?.preparation;
  if(source?.version!=='title-task-preparation-v1'||source.task?.id!==taskId||source.task?.account_id!==accountId||source.task?.deal_id!==task.deal_id||!isDeepStrictEqual(source.task.payload,task.payload)){await retry();return {status:'title_followup_held'};}
  let reason:string|null=null;
  if(!['assignment','payout'].includes(task.payload?.type??''))reason='unsupported_update';
  else if(task.payload.type==='assignment'){
   if(typeof task.payload.envelopeId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(task.payload.envelopeId))reason='invalid_assignment_reference';
   else if(source.document?.pdfSource){
    const id=Number(source.document.pdfSource.providerId);
    if(!Number.isSafeInteger(id)||id<=0)reason='invalid_provider_id';
   }
  }else if(!closingPayoutNote({...task.payload.payout,detailsSharedWithTitle:false}))reason='invalid_payout';
  if(reason){
   // Only the exact unchanged, never-admitted preparation can enter review.
   // A stale worker must not label changed work or an uncertain send as failed.
   try{if(await db('rpc/icash_review_title_task_preparation','POST',{p_account:accountId,p_task:taskId,p_source:source,p_reason:reason})===true)return {status:'title_followup_needs_reconciliation'};}
   catch{await retry();return {status:'title_followup_spending_held'};}
   return {status:'title_followup_held'};
  }
  deliverySource=prepared?.delivery??null;
  if(deliverySource?.version!=='title-task-delivery-v1'||deliverySource.task?.id!==taskId||deliverySource.task?.account_id!==accountId||deliverySource.task?.deal_id!==task.deal_id){await retry();return {status:'title_followup_held'};}
  if(task.payload.type==='assignment'&&!process.env.DOCUSEAL_API_KEY){await retry();return {status:'title_followup_configuration_required'};}
 }
 try{
  if(task.payload.type==='executed_copy'){
   const prepared=await prepareTitleCopyDelivery(accountId,taskId,task.payload,{db,pdf:completedSigningPdf});
   if(prepared.status==='held'||prepared.status==='retry'){await retry();return {status:prepared.status==='retry'?'title_followup_spending_held':'title_followup_held'};}
   if(prepared.status==='covered')return {status:'title_copy_original_receipt_confirmed'};
   attachments=prepared.attachments;details=prepared.details;
  }else if(task.payload.type==='assignment'&&task.payload.envelopeId){
   const expected=deliverySource?.document?.pdfSource;
   if(!expected||expected.id!==task.payload.envelopeId||expected.accountId!==accountId||expected.dealId!==task.deal_id)throw Error('Original assignment source required');
   const pdf=await completedSigningPdf(accountId,task.payload.envelopeId,false,expected);
   if(pdf.byteLength===0||pdf.byteLength>20*1024*1024)throw Error('Attachment requires review');
   attachments=[{filename:'executed-assignment-agreement.pdf',content:Buffer.from(pdf).toString('base64')}];
   details='The buyer assignment is now signed. Please add the attached executed assignment to the file, confirm receipt, and let us know any remaining requirements. The executed agreements control the terms.\n\n'+titleConfirmationInstructionsFor(task.payload.envelopeId);
  }else if(task.payload.type==='payout'&&task.payload.payout){
   details=closingPayoutNote({...task.payload.payout,detailsSharedWithTitle:false});
   if(!details)throw Error('Payment preference requires review');
  }else throw Error('Unknown update');
 }catch{
  if(task.payload.type!=='executed_copy'){await retry();return {status:'title_followup_spending_held'};}
  await db(`icash_title_tasks?id=eq.${taskId}&account_id=eq.${accountId}&email_state=eq.issued`,'PATCH',{email_state:'needs_review',updated_at:new Date().toISOString()});
  await db(`icash_title_tasks?id=eq.${taskId}&account_id=eq.${accountId}&email_state=eq.needs_review&state=eq.scheduled`,'PATCH',{state:'needs_review',updated_at:new Date().toISOString()});
  return {status:'title_followup_needs_reconciliation'};
 }
 let job:{requestId:string;recipient:string;address:string}|null;
 try{job=await db('rpc/icash_claim_title_update','POST',{p_account:accountId,p_task:taskId,p_payload:task.payload,...(deliverySource?{p_snapshot:deliverySource}:{})});}
 catch{await retry();return {status:'title_followup_spending_held'};}
 if(!job){await retry();return {status:'title_followup_held'};}
 try{
  const res=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`title-followup-${taskId}`},body:JSON.stringify({from:process.env.ICASH_TITLE_FROM_EMAIL,reply_to:process.env.ICASH_TITLE_REPLY_EMAIL,to:[job.recipient],subject:`[ICX-T:${job.requestId}] ${task.payload.type==='assignment'?'Signed buyer assignment':task.payload.type==='executed_copy'?'Requested executed agreements':'Updated payment preference'}`,text:`Hello,\n\nThis is the automated iCash X coordination assistant for ${job.address.replace(/[\r\n]/g,' ').slice(0,300)}.\n\n${details}\n\nPlease reply with confirmation or any questions. This update does not confirm title acceptance, deposit receipt, closing or disbursement. Payment details must be collected through your secure process and independently verified; do not rely on emailed wire changes.`,...(attachments.length?{attachments}:{})}),signal:AbortSignal.timeout(15000)});
  if(!res.ok){await res.body?.cancel().catch(()=>undefined);throw Error('Delivery requires review');}const result=await res.json();if(typeof result.id!=='string'||!result.id)throw Error('Receipt missing');
  if(task.payload.type==='executed_copy'){
   if(await db('rpc/icash_finish_title_copy','POST',{p_account:accountId,p_task:taskId,p_provider:result.id})!==true)throw Error('Original copy receipt required');
  }else{
   if(await db('rpc/icash_finish_title_task_delivery','POST',{p_account:accountId,p_task:taskId,p_provider:result.id})!==true)throw Error('Original task receipt required');
  }
  return {status:'title_followup_sent'};
 }catch{
  if(task.payload.type!=='executed_copy'){
   await db('rpc/icash_hold_title_task_delivery','POST',{p_account:accountId,p_task:taskId});
   return {status:'title_followup_needs_reconciliation'};
  }
  // Never resend a possibly accepted email after a timeout or lost database response.
  // Receipt uncertainty and task state are separate: a late failure cannot undo
  // a cancellation, dismissal or completion recorded while provider I/O ran.
  await db(`icash_title_tasks?id=eq.${taskId}&account_id=eq.${accountId}&email_state=eq.dispatching`,'PATCH',{email_state:'needs_review',updated_at:new Date().toISOString()});
  await db(`icash_title_tasks?id=eq.${taskId}&account_id=eq.${accountId}&email_state=eq.needs_review&state=eq.scheduled`,'PATCH',{state:'needs_review',updated_at:new Date().toISOString()});
  return {status:'title_followup_needs_reconciliation'};
 }
}
