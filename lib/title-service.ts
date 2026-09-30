import {db} from '@/lib/stripe-test';
import {reserveOperation} from '@/lib/operating-costs';
import {completedSigningPdf} from '@/lib/signing-service';
type TitleJob={id:string;account_id:string;deal_id:string;purchase_envelope_id:string;recipient:string;rate_id:string;verified_until:string;state:string;property_address:string};
/** Requests opening only. Provider email acceptance never establishes title opened or closing. */
export async function dispatchTitleRequest(accountId:string,jobId:string){
 const [j]=await db<TitleJob[]>(`icash_title_requests?id=eq.${jobId}&account_id=eq.${accountId}&select=*`);
 if(!j||j.state!=='ready'||!process.env.RESEND_API_KEY||!process.env.ICASH_TITLE_FROM_EMAIL||!process.env.ICASH_TITLE_REPLY_EMAIL)return {status:'title_configuration_required'};
 const pdf=await completedSigningPdf(accountId,j.purchase_envelope_id);
 const attachments=[{filename:'executed-purchase-agreement.pdf',content:Buffer.from(pdf).toString('base64')}];
 // Only signed, live agreements belonging to this exact account and deal may leave it.
 const assignments=await db<{id:string}[]>(`icash_signing_envelopes?account_id=eq.${accountId}&deal_id=eq.${j.deal_id}&kind=eq.assignment&state=eq.completed&test_mode=eq.false&select=id&limit=2`);
 if(assignments.length>1)return {status:'title_assignment_review_required'};
 if(assignments[0]){
  const assignment=await completedSigningPdf(accountId,assignments[0].id);
  if(pdf.byteLength+assignment.byteLength>20*1024*1024)return {status:'title_attachment_limit_review'};
  attachments.push({filename:'executed-assignment-agreement.pdf',content:Buffer.from(assignment).toString('base64')});
 }

 await reserveOperation({accountId,operationKey:`title:${j.id}`,rateId:j.rate_id,permissionUntil:j.verified_until});
 if(!await db<boolean>('rpc/icash_claim_title_request','POST',{p_id:j.id}))return {status:'title_request_held'};
 try{
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`title-${j.id}`},body:JSON.stringify({from:process.env.ICASH_TITLE_FROM_EMAIL,reply_to:process.env.ICASH_TITLE_REPLY_EMAIL,to:[j.recipient],subject:`[ICX-T:${j.id}] Title opening request: ${j.property_address.replace(/[\r\n]/g,' ').slice(0,180)}`,text:`Please review the attached executed purchase agreement for ${j.property_address} and confirm whether your office can handle this transaction. Please reply with your file reference, assigned closer, required documents and next steps. Please itemize title-company, escrow/settlement and other closing charges and allocate them according to the attached executed agreements. Our requested structure is buyer-paid closing costs, including legally allocable title-company fees; this email does not amend the signed agreements or shift seller liens/payoffs. Please confirm buyer deposit requirements and due dates through your secure process. This email requests opening only and does not confirm acceptance, deposit receipt or closing. Reference: ${j.id}. Please do not rely on emailed changes to wire instructions without independent verification.`,attachments }),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Provider response needs review');
  const result=await response.json();if(typeof result.id!=='string'||!result.id)throw Error('Receipt missing');
  await db(`icash_title_requests?id=eq.${j.id}&state=eq.dispatching`,'PATCH',{state:'sent',provider_id:result.id,updated_at:new Date().toISOString()});
  return {status:'title_request_sent'};
 }catch{
  await db(`icash_title_requests?id=eq.${j.id}&state=eq.dispatching`,'PATCH',{state:'needs_review',updated_at:new Date().toISOString()});
  return {status:'title_delivery_needs_reconciliation'};
 }
}

/** Reuses the existing signed-agreement, contact, pause and spend checks. */
export async function coordinateTitleOpening(accountId:string,dealId:string){
 const [setting]=await db<{enabled:boolean}[]>('icash_title_followup_settings?id=eq.1&select=enabled');
 if(!setting?.enabled)return {status:'title_automation_paused'};
 const [contact]=await db<{email:string}[]>(`icash_title_contacts?account_id=eq.${accountId}&deal_id=eq.${dealId}&enabled=eq.true&verified_until=gt.${new Date().toISOString()}&select=email`);
 if(!contact)return {status:'verified_title_contact_required'};
 const job=await db<{id:string;state:string}>('rpc/icash_prepare_title_request','POST',{p_account:accountId,p_deal:dealId});
 if(job.state==='sent')return {status:'title_request_already_sent'};
 if(job.state!=='ready')return {status:'title_delivery_needs_reconciliation'};
 return dispatchTitleRequest(accountId,job.id);
}
