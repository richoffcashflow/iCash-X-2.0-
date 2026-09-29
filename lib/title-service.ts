import {db} from '@/lib/stripe-test';
import {reserveOperation} from '@/lib/operating-costs';
import {completedSigningPdf} from '@/lib/signing-service';
type TitleJob={id:string;account_id:string;deal_id:string;purchase_envelope_id:string;recipient:string;rate_id:string;verified_until:string;state:string;property_address:string};
/** Requests opening only. Provider email acceptance never establishes title opened or closing. */
export async function dispatchTitleRequest(accountId:string,jobId:string){
 const [j]=await db<TitleJob[]>(`icash_title_requests?id=eq.${jobId}&account_id=eq.${accountId}&select=*`);
 if(!j||j.state!=='ready'||!process.env.RESEND_API_KEY||!process.env.ICASH_TITLE_FROM_EMAIL||!process.env.ICASH_TITLE_REPLY_EMAIL)return {status:'title_configuration_required'};
 const pdf=await completedSigningPdf(accountId,j.purchase_envelope_id);
 await reserveOperation({accountId,operationKey:`title:${j.id}`,rateId:j.rate_id,permissionUntil:j.verified_until});
 if(!await db<boolean>('rpc/icash_claim_title_request','POST',{p_id:j.id}))return {status:'title_request_held'};
 try{
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`title-${j.id}`},body:JSON.stringify({from:process.env.ICASH_TITLE_FROM_EMAIL,reply_to:process.env.ICASH_TITLE_REPLY_EMAIL,to:[j.recipient],subject:`[ICX-T:${j.id}] Title opening request: ${j.property_address.replace(/[\r\n]/g,' ').slice(0,180)}`,text:`Please review the attached executed purchase agreement for ${j.property_address} and confirm whether your office can handle this transaction. Please reply with your file reference, assigned closer, required documents and next steps. This email requests opening only and does not confirm acceptance, deposit receipt or closing. Reference: ${j.id}. Please do not rely on emailed changes to wire instructions without independent verification.`,attachments:[{filename:'executed-purchase-agreement.pdf',content:Buffer.from(pdf).toString('base64')}] }),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Provider response needs review');
  const result=await response.json();if(typeof result.id!=='string'||!result.id)throw Error('Receipt missing');
  await db(`icash_title_requests?id=eq.${j.id}&state=eq.dispatching`,'PATCH',{state:'sent',provider_id:result.id,updated_at:new Date().toISOString()});
  return {status:'title_request_sent'};
 }catch{
  await db(`icash_title_requests?id=eq.${j.id}&state=eq.dispatching`,'PATCH',{state:'needs_review',updated_at:new Date().toISOString()});
  return {status:'title_delivery_needs_reconciliation'};
 }
}
