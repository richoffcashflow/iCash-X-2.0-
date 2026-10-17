import {randomBytes,createHash} from 'node:crypto';
import {titleEmailAddress} from './title-inbound-policy.ts';

type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Environment=Record<string,string|undefined>;
type Message={from:string;to:string[];reply_to:string;subject:string;text:string;html:string;tags:{name:string;value:string}[]};
type Claim={id:string;claimToken:string;source:'access_help'|'chat';recipient:string|null;accessRequestId:string|null;threadId:string|null;customerUserId:string|null;message:Message|null};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escapeHtml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function supportCustomerNotificationsEnabled(env:Environment=process.env){return env.VERCEL_ENV==='production'&&env.ICASH_SUPPORT_CUSTOMER_EMAIL_ENABLED!=='false';}

export function supportCustomerMessage(job:Claim,recipient:string,from:string,secret?:string):Message{
 const guest=job.source==='access_help',reference=guest?job.accessRequestId:job.threadId;
 if(!uuid.test(job.id)||!reference||!uuid.test(reference)||!titleEmailAddress(recipient)||!titleEmailAddress(from)||guest&&!/^[a-f0-9]{64}$/.test(secret??''))throw Error('Invalid customer notification');
 const link=guest?`https://www.geticashx.com/access/help/return#${secret}`:`https://www.geticashx.com/support?threadId=${reference}`;
 const instructions=guest?'Open your conversation to read the reply and send a message. No account or password needed.':'Open your conversation to read the reply and send a message. Sign in with your account email if asked.';
 const footer=guest?'This private support link works for 30 days. Keep this email so you can return on any device.':'This link opens this specific support conversation after sign-in.';
 const subject='You have a reply from iCash X support';
 // No customer-authored text or sensitive account details in an unverified inbox.
 const text=`You have a new support reply.\n\n${instructions}\n\nView reply & respond:\n${link}\n\n${footer}\n\nConversation reference: ${reference.slice(0,8)}\n\nIf you did not contact support, you can ignore this email.\n\niCash X support`;
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head><body style="margin:0;background:#f5f5f5;color:#171717;font:16px/1.6 Arial,sans-serif"><main style="max-width:520px;margin:24px auto;padding:28px;background:#fff;border-radius:12px"><p style="font-weight:700;margin-top:0">iCash X support</p><h1 style="font-size:26px;line-height:1.25">You have a new reply.</h1><p>${instructions}</p><p><a href="${escapeHtml(link)}" style="display:block;background:#111;color:#fff;text-align:center;text-decoration:none;padding:16px 20px;border-radius:8px;font-weight:600">View reply &amp; respond</a></p><p>${footer}</p><p style="font-size:13px;color:#555">Conversation reference: ${reference.slice(0,8)}</p><p style="font-size:13px;color:#555">If you did not contact support, you can ignore this email.</p></main></body></html>`;
 return {from:`iCash X Support <${from}>`,to:[recipient],reply_to:'support@geticashx.com',subject,text,html,tags:[{name:'icash_support_customer_id',value:job.id}]};
}

export async function processSupportCustomerNotifications({db,env=process.env,transport=fetch,limit=5}:{db:Database;env?:Environment;transport?:typeof fetch;limit?:number}){
 if(!supportCustomerNotificationsEnabled(env))return {state:'disabled',accepted:0,failed:0};
 const from=titleEmailAddress(env.ICASH_RELIABILITY_FROM_EMAIL);
 if(!from||!env.RESEND_API_KEY||!env.RESEND_RECEIVING_WEBHOOK_SECRET||env.ICASH_AUTH_EMAIL_READY!=='true')return {state:'unconfigured',accepted:0,failed:1};
 async function verifiedEmail(userId:string|null){
  if(!userId||!uuid.test(userId)||!env.SUPABASE_SECRET_KEY)throw Error('Support identity unavailable');
  const origin=new URL(env.SUPABASE_URL??'');
  if(origin.protocol!=='https:'||!origin.hostname.endsWith('.supabase.co')||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('Support identity unavailable');
  const response=await transport(new URL(`/auth/v1/admin/users/${userId}`,origin),{headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:`Bearer ${env.SUPABASE_SECRET_KEY}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error('Support identity unavailable');
  const user=await response.json(),email=titleEmailAddress(user.email);
  if(user.id!==userId||!email||email.length>254||!user.email_confirmed_at||!Number.isFinite(Date.parse(user.email_confirmed_at))||user.deleted_at||user.banned_until&&Date.parse(user.banned_until)>Date.now())throw Error('Support identity unavailable');
  return email;
 }
 let accepted=0,failed=0;
 for(let count=0;count<Math.min(10,Math.max(1,limit));count++){
  const job=await db<Claim|null>('rpc/icash_claim_support_customer_email','POST',{});
  if(!job)break;
  if(!uuid.test(job.id)||!uuid.test(job.claimToken))throw Error('Invalid support notification claim');
  let retry=true;
  try{
   const recipient=job.source==='chat'?await verifiedEmail(job.customerUserId):titleEmailAddress(job.recipient);
   if(!recipient)throw Error('Support recipient unavailable');
   const secret=job.source==='access_help'&&!job.message?randomBytes(32).toString('hex'):undefined;
   const message=await db<Message|null>('rpc/icash_authorize_support_customer_email','POST',{p_id:job.id,p_claim:job.claimToken,p_recipient:recipient,p_message:job.message??supportCustomerMessage(job,recipient,from,secret),p_link_hash:secret?createHash('sha256').update(secret).digest('hex'):null});
   if(!message)continue;
   const response=await transport('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`support-customer-${job.id}`},body:JSON.stringify(message)});
   retry=response.status===429||response.status===409||response.status>=500;
   if(!response.ok)throw Error('Support notification not accepted');
   retry=true;
   const receipt=await response.json();if(typeof receipt?.id!=='string'||!uuid.test(receipt.id))throw Error('Missing support notification receipt');
   await db('rpc/icash_finish_support_customer_email','POST',{p_id:job.id,p_claim:job.claimToken,p_provider:receipt.id});accepted++;
  }catch{
   failed++;
   try{await db('rpc/icash_finish_support_customer_email','POST',{p_id:job.id,p_claim:job.claimToken,p_provider:null,p_retry:retry});}catch{/* Maintenance recovers the same frozen payload/key within the provider's idempotency window. */}
  }
 }
 return {state:'ready',accepted,failed};
}

/** Only called from the existing signature-verified delivery webhook. */
export async function recordSupportCustomerDelivery(event:{type?:string;data?:{email_id?:unknown;to?:unknown;tags?:Record<string,unknown>}},db:Database){
 const kind=event.type?.replace(/^email\./,''),data=event.data;
 if(!kind||!['delivered','bounced','complained','delivery_delayed','failed','suppressed'].includes(kind)||typeof data?.email_id!=='string'||!uuid.test(data.email_id)||!Array.isArray(data.to)||data.to.length!==1||typeof data.to[0]!=='string'||!titleEmailAddress(data.to[0]))return;
 const id=data.tags?.icash_support_customer_id;
 await db('rpc/icash_support_customer_email_delivery','POST',{p_id:typeof id==='string'&&uuid.test(id)?id:null,p_provider:data.email_id,p_recipient:data.to[0],p_kind:kind});
}
