import {ownerInboundTarget} from './owner-inbound-acceptance.ts';
import {redactSupportQuestion,isCancelEmail} from './support-policy.ts';
import {titleEmailAddress,titleReference} from './title-inbound-policy.ts';

type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Environment=Record<string,string|undefined>;
type Message={from:string;to:string[];subject:string;text:string;html:string;tags:{name:string;value:string}[]};
type Claim={id:string;claimToken:string;recipient:string;source:'chat'|'email'|'access_help'|'purchase_access';sourceId:string;threadId:string|null;customerUserId:string|null;customerEmail:string|null;subject:string;question:string;reply:string|null;replyStatus:'saved'|'accepted'|'unconfirmed'|'none';createdAt:string;message:Message|null};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escapeHtml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function supportOwnerNotificationsEnabled(env:Environment=process.env){return env.VERCEL_ENV==='production'&&env.ICASH_SUPPORT_OWNER_EMAIL_ENABLED==='true';}

export function supportCancelReceiptText(mode:string,origin:string){
 return `We received an email asking to cancel ${mode} subscription renewals in this environment. That email alone does not pause your bot or stop subscription renewals.\n\nSign in and review the request here:\n${new URL('/support',origin).href}\n\nTo stop future bot work and subscription renewals, select Review this request and explicitly confirm. Until your account shows cancellation is confirmed, do not assume renewals have stopped. If you already confirmed, check the current result there.\n\nIf you did not request this, you can ignore the request; the email alone cannot change your account. Deletion and refunds require a separate support review.\n\niCash X support`;
}

/** Called only after the webhook signature and exact provider email have been verified.
 * Content is display-only, redacted text. It never reaches AI, tools or a recipient field. */
export async function queueSupportEmailCopy({db,providerId,email,receiptText,env=process.env}:{db:Database;providerId:string;email:unknown;receiptText:string|null;env?:Environment}){
 if(!supportOwnerNotificationsEnabled(env)||!uuid.test(providerId)||!email||typeof email!=='object')return;
 const value=email as {id?:unknown;to?:unknown;from?:unknown;subject?:unknown;text?:unknown};
 const mailbox=titleEmailAddress(env.ICASH_SUPPORT_EMAIL),sender=titleEmailAddress(value.from);
 if(!mailbox||!sender||value.id!==providerId||!Array.isArray(value.to)||!value.to.some(to=>titleEmailAddress(to)===mailbox)||titleReference(value.subject))return;
 const subject=typeof value.subject==='string'?redactSupportQuestion(value.subject).replace(/[\r\n]+/g,' ').slice(0,180):'Support email';
 const question=typeof value.text==='string'&&value.text.trim()?redactSupportQuestion(value.text)+(value.text.length>2000?'\n\n[Message excerpt. Open the original email for the full text.]':''):'No plain-text body. Open the original email to see its content and attachments.';
 await db('rpc/icash_queue_support_email_copy','POST',{p_provider:providerId,p_sender:sender,p_subject:subject||'Support email',p_question:question,p_receipt:isCancelEmail(value.subject)?receiptText:null});
}

export function supportOwnerMessage(job:Claim,from:string):Message{
 if(!uuid.test(job.id)||!uuid.test(job.sourceId)||!titleEmailAddress(job.recipient)||!titleEmailAddress(from)||job.threadId&&!uuid.test(job.threadId)||!Number.isFinite(Date.parse(job.createdAt)))throw Error('Invalid support notification');
 const when=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',dateStyle:'medium',timeStyle:'short',hour12:true}).format(new Date(job.createdAt));
 const responseLabel=job.source==='chat'?'AI support response':job.source==='email'?'Automatic email response':'On-page support response';
 const reply=job.reply??'No automatic response was sent.';
 const status=job.replyStatus==='saved'?'Shown in the customer’s support conversation.':job.replyStatus==='accepted'?'Accepted by the email provider.':job.replyStatus==='unconfirmed'?'Sending was not confirmed. This is the attempted response.':'Needs a reply from the team.';
 const link=job.source==='email'?`https://resend.com/emails/receiving/${job.sourceId}`:'https://www.geticashx.com/support/admin';
 const label=job.source==='email'?'Open original email':job.source==='chat'?'Open support conversations':'Open paid access support';
 const customer=job.customerEmail??(job.source==='purchase_access'?'Review the paid access queue':'Email unavailable');
 const identity=['email','access_help'].includes(job.source)?'Sender (email address not verified)':job.source==='purchase_access'?'Access check':'Customer';
 const subject=`iCash X support: ${job.subject.replace(/[\r\n]+/g,' ').slice(0,120)}`;
 const text=`${identity}: ${customer}\nReceived: ${when} Central Time\n\nCUSTOMER MESSAGE\n${job.question}\n\n${responseLabel.toUpperCase()}\n${reply}\n\n${status}\n\n${label}:\n${link}${job.threadId?`\nConversation: ${job.threadId}`:''}\n\nThis is your owner copy. Review the conversation before replying to the customer.`;
 const paragraph=(s:string)=>escapeHtml(s).replace(/\n/g,'<br>');
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>iCash X support update</title></head><body style="margin:0;background:#f5f5f5;color:#171717;font:16px/1.6 Arial,sans-serif"><main style="max-width:620px;margin:24px auto;padding:28px;background:#fff;border-radius:12px"><h1 style="font-size:24px;margin-top:0">iCash X support update</h1><p><strong>${identity}:</strong> ${escapeHtml(customer)}<br><strong>Received:</strong> ${escapeHtml(when)} Central Time</p><h2 style="font-size:18px">Customer message</h2><div style="padding:16px;background:#f5f5f5;border-radius:8px;overflow-wrap:anywhere">${paragraph(job.question)}</div><h2 style="font-size:18px">${responseLabel}</h2><div style="padding:16px;border:1px solid #ddd;border-radius:8px;overflow-wrap:anywhere">${paragraph(reply)}</div><p style="color:#555">${escapeHtml(status)}</p><p><a href="${link}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px">${label}</a></p>${job.threadId?`<p style="font-size:12px;color:#555">Conversation: ${job.threadId}</p>`:''}<p style="font-size:13px;color:#555">This is your owner copy. Review the conversation before replying to the customer.</p></main></body></html>`;
 return {from:`iCash X Support <${from}>`,to:[job.recipient],subject,text,html,tags:[{name:'icash_support_copy_id',value:job.id}]};
}

export async function processSupportOwnerNotifications({db,env=process.env,transport=fetch,limit=5,monitorAccess=false}:{db:Database;env?:Environment;transport?:typeof fetch;limit?:number;monitorAccess?:boolean}){
 if(!supportOwnerNotificationsEnabled(env))return {state:'disabled',accepted:0,failed:0};
 const from=titleEmailAddress(env.ICASH_RELIABILITY_FROM_EMAIL);
 let origin:URL;try{origin=new URL(env.SUPABASE_URL??'');}catch{return {state:'unconfigured',accepted:0,failed:1};}
 if(!from||!env.RESEND_API_KEY||!env.SUPABASE_SECRET_KEY||origin.protocol!=='https:'||!origin.hostname.endsWith('.supabase.co')||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)return {state:'unconfigured',accepted:0,failed:1};
 async function verifiedEmail(userId:string){
  if(!uuid.test(userId))throw Error('Invalid support identity');
  const response=await transport(new URL(`/auth/v1/admin/users/${userId}`,origin),{headers:{apikey:env.SUPABASE_SECRET_KEY!,Authorization:`Bearer ${env.SUPABASE_SECRET_KEY}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error('Support identity unavailable');
  const user=await response.json(),email=titleEmailAddress(user.email);
  if(user.id!==userId||!email||email.length>254||!user.email_confirmed_at||!Number.isFinite(Date.parse(user.email_confirmed_at))||user.deleted_at||user.banned_until&&Date.parse(user.banned_until)>Date.now())throw Error('Support identity unavailable');
  return email;
 }
 // Reuse the Auth admin API; service_role deliberately has no SELECT on auth.users.
 let recipient:string;try{recipient=await verifiedEmail(ownerInboundTarget.ownerUserId);}catch{return {state:'recipient_unverified',accepted:0,failed:1};}
 if(monitorAccess)await db('rpc/icash_queue_purchase_access_attention','POST',{});
 let accepted=0,failed=0;
 for(let count=0;count<Math.min(10,Math.max(1,limit));count++){
  // The recipient is resolved from the platform owner's verified auth record.
  const job=await db<Claim|null>('rpc/icash_claim_support_owner_copy','POST',{p_owner:ownerInboundTarget.ownerUserId,p_recipient:recipient});
  if(!job)break;
  if(!uuid.test(job.id)||!uuid.test(job.claimToken))throw Error('Invalid support notification claim');
  let retry=true;
  try{
   if(!job.message&&job.source==='chat'&&job.customerUserId){try{job.customerEmail=await verifiedEmail(job.customerUserId);}catch{job.customerEmail=null;}}
   const message=await db<Message|null>('rpc/icash_authorize_support_owner_copy','POST',{p_id:job.id,p_claim:job.claimToken,p_message:job.message??supportOwnerMessage(job,from)});
   if(!message)continue;
   const response=await transport('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`support-owner-${job.id}`},body:JSON.stringify(message)});
   retry=response.status===429||response.status===409||response.status>=500;
   if(!response.ok)throw Error('Support notification not accepted');
   retry=true;
   const receipt=await response.json();if(typeof receipt?.id!=='string'||!uuid.test(receipt.id))throw Error('Missing notification receipt');
   await db('rpc/icash_finish_support_owner_copy','POST',{p_id:job.id,p_claim:job.claimToken,p_provider:receipt.id});accepted++;
  }catch{
   failed++;
   try{await db('rpc/icash_finish_support_owner_copy','POST',{p_id:job.id,p_claim:job.claimToken,p_provider:null,p_retry:retry});}catch{/* The durable lease is recovered by maintenance with the same payload/key. */}
  }
 }
 return {state:'ready',accepted,failed};
}

/** Called only inside the existing signature-verified delivery webhook. */
export async function recordSupportOwnerDelivery(event:{type?:string;data?:{email_id?:unknown;to?:unknown;tags?:Record<string,unknown>}},db:Database){
 const kind=event.type?.replace(/^email\./,''),data=event.data;
 if(!kind||!['delivered','bounced','complained','delivery_delayed','failed','suppressed'].includes(kind)||typeof data?.email_id!=='string'||!uuid.test(data.email_id)||!Array.isArray(data.to)||data.to.length!==1||typeof data.to[0]!=='string'||!titleEmailAddress(data.to[0]))return;
 const id=data.tags?.icash_support_copy_id;
 await db('rpc/icash_support_owner_copy_delivery','POST',{p_id:typeof id==='string'&&uuid.test(id)?id:null,p_provider:data.email_id,p_recipient:data.to[0],p_kind:kind});
}
