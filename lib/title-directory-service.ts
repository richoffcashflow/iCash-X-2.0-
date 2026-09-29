import {db} from '@/lib/stripe-test';
import {reserveOperation} from '@/lib/operating-costs';
export async function qualifyTitleCompanies(accountId:string,dealId:string){
 await db('rpc/icash_queue_title_qualification','POST',{p_account:accountId,p_deal:dealId});
 if(!process.env.RESEND_API_KEY||!process.env.ICASH_TITLE_FROM_EMAIL||!process.env.ICASH_TITLE_REPLY_EMAIL)return {status:'title_mailbox_required'};
 const [j]=await db<{id:string;company_id:string;market:string;state_code:string}[]>(`icash_title_qualification_jobs?account_id=eq.${accountId}&state=eq.ready&order=created_at&limit=1`);if(!j)return {status:'no_title_inquiry_pending'};
 const [c]=await db<{name:string;public_email:string;contact_checked_until:string}[]>(`icash_title_directory?id=eq.${j.company_id}&select=name,public_email,contact_checked_until`);
 const [r]=await db<{id:string}[]>(`icash_operation_rates?operation=eq.title_qualification&enabled=eq.true&expires_at=gt.${new Date().toISOString()}&order=verified_at.desc&limit=1&select=id`);
 const [identity]=await db<{principal:string}[]>(`icash_customer_identities?account_id=eq.${accountId}&select=principal`);
 if(!c?.public_email||!identity?.principal||!r)return {status:'title_qualification_setup_required'};
 await reserveOperation({accountId,operationKey:`title-qualify:${j.id}`,rateId:r.id,permissionUntil:c.contact_checked_until});
 if(!await db<boolean>('rpc/icash_claim_title_qualification','POST',{p_id:j.id,p_recipient:c.public_email}))return {status:'title_inquiry_held'};
 try{
 const res=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`title-qualify-${j.id}`},body:JSON.stringify({from:process.env.ICASH_TITLE_FROM_EMAIL,reply_to:process.env.ICASH_TITLE_REPLY_EMAIL,to:[c.public_email],subject:`[ICX-Q:${j.id}] Assignment closing inquiry — ${j.market.replace(/[\r\n]/g,' ')}`,text:`Hello ${c.name},\n\nI’m the automated coordination assistant for ${identity.principal}, using iCash X. We are looking for a closing office serving ${j.market}, ${j.state_code}. Do you handle purchase-contract assignments and double closings? Please confirm your county coverage, fees, required disclosures and documents, escrow/deposit process, and the name and direct contact for an assigned closer. Please also confirm whether email coordination works for your office.\n\nWe will send transaction documents only after confirming the correct recipient and file acceptance. No commitment or volume guarantee is being made. If your office does not want further inquiries, please reply and we will stop.\nReference: ${j.id}`}),signal:AbortSignal.timeout(15000)});
 if(!res.ok)throw Error('Provider failure');const data=await res.json();if(typeof data.id!=='string')throw Error('Receipt missing');
 await db(`icash_title_qualification_jobs?id=eq.${j.id}&state=eq.dispatching`,'PATCH',{state:'sent',provider_id:data.id,updated_at:new Date().toISOString()});return {status:'title_inquiry_sent'};
 }catch{await db(`icash_title_qualification_jobs?id=eq.${j.id}&state=eq.dispatching`,'PATCH',{state:'needs_review',updated_at:new Date().toISOString()});return {status:'title_inquiry_needs_reconciliation'};}
}
