import {db} from '@/lib/stripe-test';
import {fundingMode} from '@/lib/funding-policy';
import {titleEmailAddress} from '@/lib/title-inbound-policy';
import {isCancelEmail,supportId} from '@/lib/support-policy';

/** No inferred mailbox, sender or app URL. Enable only after both sending and receiving are verified. */
export function supportReceiptConfiguration(){
 const mailbox=titleEmailAddress(process.env.ICASH_SUPPORT_EMAIL);
 if(process.env.ICASH_SUPPORT_EMAIL_READY!=='true'||!mailbox||!process.env.RESEND_API_KEY)return null;
 try{const u=new URL(process.env.ICASH_APP_ORIGIN??'');if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)return null;
  return {mailbox,origin:u.origin,apiKey:process.env.RESEND_API_KEY};
 }catch{return null;}
}

/**
 * Server-internal intake, called only after the receiving route verifies its raw
 * signature and fetches the exact provider email. Only a pending request and a
 * bounded transactional receipt are allowed. No email content reaches an AI.
 */
export async function intakeVerifiedSupportEmail(providerId:string,value:unknown){
 const mailbox=titleEmailAddress(process.env.ICASH_SUPPORT_EMAIL);
 if(!mailbox||!supportId.safeParse(providerId).success||!value||typeof value!=='object')return false;
 const email=value as {id?:unknown;to?:unknown;from?:unknown;subject?:unknown};
 if(email.id!==providerId||!Array.isArray(email.to)||!email.to.some(to=>titleEmailAddress(to)===mailbox)||!isCancelEmail(email.subject))return false;
 const sender=titleEmailAddress(email.from);if(!sender)return true;
 const mode=fundingMode(),config=supportReceiptConfiguration();
 // Request-only email must not be activated silently without a working receipt path.
 if(!mode||!config)throw Error('SUPPORT_RECEIVING_UNAVAILABLE');
 await db('rpc/icash_support_request_email_cancel','POST',{p_email:sender,p_provider:providerId,p_mode:mode});
 // From is only a hint. Recipient is resolved again from verified auth ownership,
 // never Reply-To/email content. The DB claim applies dedupe, budgets and suppression.
 const job=await db<{id:string;recipient:string}|null>('rpc/icash_support_claim_cancel_receipt','POST',{p_provider:providerId,p_mode:mode});
 if(!job)return true;
 if(!supportId.safeParse(job.id).success)throw Error('INVALID_RECEIPT_CLAIM');
 try{
  const recipient=titleEmailAddress(job.recipient);if(!recipient||recipient!==job.recipient)throw Error('INVALID_RECEIPT_RECIPIENT');
  const response=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json','Idempotency-Key':`support-cancel-receipt-${job.id}`},body:JSON.stringify({
   from:`iCash X support <${config.mailbox}>`,to:[recipient],reply_to:config.mailbox,
   subject:'Action required: confirm your iCash X cancellation request',
   text:`We received an email asking to cancel ${mode} subscription renewals in this environment. That email alone does not pause your bot or stop subscription renewals.\n\nSign in and review the request here:\n${new URL('/support',config.origin).href}\n\nTo stop future bot work and subscription renewals, select Review this request and explicitly confirm. Until your account shows cancellation is confirmed, do not assume renewals have stopped. If you already confirmed, check the current result there.\n\nIf you did not request this, you can ignore the request; the email alone cannot change your account. Deletion and refunds require a separate support review.\n\niCash X support`,
  })});
  if(!response.ok)throw Error('RECEIPT_PROVIDER_UNAVAILABLE');const receipt=await response.json();const accepted=supportId.parse(receipt?.id);
  await db('rpc/icash_support_finish_cancel_receipt','POST',{p_request:job.id,p_provider:accepted});
 }catch{
  // A timeout may follow provider acceptance. Never automatically resend, even
  // after the provider's idempotency window. The consumed claim remains visible.
  try{await db('rpc/icash_support_finish_cancel_receipt','POST',{p_request:job.id,p_provider:null});}catch{/* The durable claimed state still blocks duplicate sends. */}
 }
 return true;
}
