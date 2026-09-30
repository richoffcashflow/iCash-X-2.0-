import {db} from '@/lib/stripe-test';
import {titleEmailAddress} from './title-inbound-policy.ts';
import {emailFromName} from './deal-email-policy.ts';
export function dealEmailConfigured(){return !!(process.env.RESEND_API_KEY&&process.env.RESEND_RECEIVING_WEBHOOK_SECRET&&titleEmailAddress(process.env.ICASH_TITLE_FROM_EMAIL)&&titleEmailAddress(process.env.ICASH_TITLE_REPLY_EMAIL));}
export async function dispatchDealEmail(accountId:string,id:string){
 if(process.env.ICASH_LIVE_WORK_READY!=='true')return {status:'live_work_not_ready'};
 if(!dealEmailConfigured())return {status:'email_configuration_required'};
 const [prior]=await db<{state:string}[]>(`icash_deal_emails?id=eq.${id}&account_id=eq.${accountId}&select=state`);
 if(prior?.state==='accepted')return {status:'email_accepted'};
 if(prior?.state!=='ready')return {status:'email_needs_review'};
 const job=await db<{id:string;to:string;subject:string;text:string;principal:string}|null>('rpc/icash_claim_deal_email','POST',{p_account:accountId,p_id:id});
 if(!job)return {status:'email_held'};
 try{
 const response=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`deal-email-${job.id}`},body:JSON.stringify({from:`${emailFromName(job.principal)} via iCash X <${titleEmailAddress(process.env.ICASH_TITLE_FROM_EMAIL)}>`,to:[job.to],reply_to:process.env.ICASH_TITLE_REPLY_EMAIL,subject:`[ICX-M:${job.id}] ${job.subject}`,text:job.text}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Delivery response needs review');
 const result=await response.json();if(typeof result.id!=='string'||!/^[0-9a-f-]{36}$/i.test(result.id))throw Error('Receipt missing');
 await db(`icash_deal_emails?id=eq.${job.id}&account_id=eq.${accountId}&state=eq.dispatching`,'PATCH',{state:'accepted',provider_id:result.id,updated_at:new Date().toISOString()});
 return {status:'email_accepted'};
 }catch{
 await db(`icash_deal_emails?id=eq.${job.id}&account_id=eq.${accountId}&state=eq.dispatching`,'PATCH',{state:'needs_review',updated_at:new Date().toISOString()});
 return {status:'email_needs_review'};
 }
}
