type Database=<T>(path:string,method?:string,body?:unknown,signal?:AbortSignal)=>Promise<T>;
type Environment=Record<string,string|undefined>;
type Claim={id:string;claimToken:string;membershipId:string;recipient:string;vip:boolean;message:PurchaseMessage|null};
type PurchaseMessage={from:string;to:string[];reply_to:string;subject:string;text:string;html:string;tags:{name:string;value:string}[]};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const escapeHtml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function purchaseEmailReady(env:Environment){
 return env.VERCEL_ENV==='production'&&env.ICASH_AUTH_EMAIL_READY==='true'&&!!env.RESEND_API_KEY&&!!env.RESEND_RECEIVING_WEBHOOK_SECRET;
}
/** Links are navigation only. Account/VIP access always requires verified sign-in. */
export function purchaseAccessMessage(job:Claim,reminder=false):PurchaseMessage{
 if(!uuid.test(job.id)||!uuid.test(job.membershipId)||!email.test(job.recipient)||job.recipient.length>254)throw Error('Invalid purchase email');
 const access=`https://www.geticashx.com/access?purchase=${job.membershipId}`,vip=access+'&destination=vip';
 const subject=reminder?'Your iCash X login link — save this email':'Your iCash X login link — purchase confirmed';
 const heading=reminder?'Your account link is right here.':'Your purchase is confirmed.';
 const instructions='Use the same email you paid with. Tap “Email me a code,” then enter that code to create or open your account. No password needed.';
 const text=`${heading}\n\nOpen your account:\n${access}\n\n${instructions}\n\nSave this email. Your sign-in link is always https://www.geticashx.com/access\n\n${job.vip?`Watch your VIP session (sign-in required):\n${vip}\n\n`:''}Your payment is saved. You do not need to pay again.\n\nNeed help? https://www.geticashx.com/support\n\niCash X`;
 const button=(label:string,url:string)=>`<a href="${escapeHtml(url)}" style="display:block;background:#111;color:#fff;text-align:center;text-decoration:none;padding:16px 20px;border-radius:8px;font-size:16px;font-weight:600;margin:20px 0">${label}</a>`;
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head><body style="margin:0;background:#f5f5f5;color:#171717;font:16px/1.6 Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden">Your payment is saved. Open your account with your payment email.</div><main style="max-width:520px;margin:24px auto;background:#fff;padding:28px;border-radius:12px"><p style="font-weight:700;margin-top:0">iCash X</p><h1 style="font-size:26px;line-height:1.25">${heading}</h1>${button('Open my account',access)}<p>${instructions}</p><p>Save this email. Your sign-in link is always<br><a href="https://www.geticashx.com/access" style="color:#111;overflow-wrap:anywhere">https://www.geticashx.com/access</a></p>${job.vip?`<p>Your VIP session is ready to watch after sign-in.</p>${button('Watch my VIP session',vip)}`:''}<p><strong>You do not need to pay again.</strong></p><p style="font-size:14px;color:#555">Need help? <a href="https://www.geticashx.com/support" style="color:#111">Contact support</a>.</p></main></body></html>`;
 return {from:'iCash X <signin@geticashx.com>',to:[job.recipient],reply_to:'support@geticashx.com',subject,text,html,tags:[{name:'icash_purchase_email_id',value:job.id}]};
}

export async function processPurchaseAccessEmails({db,env=process.env,transport=fetch,membershipId,limit=5}:{db:Database;env?:Environment;transport?:typeof fetch;membershipId?:string;limit?:number}){
 if(!purchaseEmailReady(env))return {ready:false,accepted:0,failed:0};
 if(membershipId&&!uuid.test(membershipId))throw Error('Invalid membership');
 let accepted=0,failed=0;
 for(let count=0;count<Math.min(limit,10);count++){
  const job=await db<Claim|null>('rpc/icash_claim_purchase_access_email','POST',{p_membership:membershipId??null});
  if(!job)break;
  if(!uuid.test(job.id)||!uuid.test(job.claimToken))throw Error('Invalid purchase email claim');
  let retry=true;
  try{
   const message=await db<PurchaseMessage|null>('rpc/icash_authorize_purchase_access_email','POST',{p_id:job.id,p_claim:job.claimToken,p_message:job.message??purchaseAccessMessage(job)});
   if(!message)continue;
   const response=await transport('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`purchase-access-${job.id}`},body:JSON.stringify(message)});
   retry=response.status===429||response.status>=500||response.status===409;
   if(!response.ok)throw Error('Purchase email not accepted');
   retry=true; // A lost/malformed success receipt can retry the identical payload safely.
   const receipt=await response.json();if(typeof receipt?.id!=='string'||!uuid.test(receipt.id))throw Error('Missing purchase email receipt');
   await db('rpc/icash_finish_purchase_access_email','POST',{p_id:job.id,p_claim:job.claimToken,p_provider:receipt.id});accepted++;
  }catch{
   failed++;
   try{await db('rpc/icash_finish_purchase_access_email','POST',{p_id:job.id,p_claim:job.claimToken,p_provider:null,p_retry:retry});}catch{/* Durable lease is recovered by the next maintenance pass. */}
  }
 }
 return {ready:true,accepted,failed};
}

/** Called only from the existing signature-verified Resend webhook. */
export async function recordPurchaseEmailDelivery(event:{type?:string;data?:{email_id?:unknown;to?:unknown;tags?:Record<string,unknown>}},db:Database){
 const kind=event.type?.replace(/^email\./,''),data=event.data;
 if(!kind||!['delivered','bounced','complained','delivery_delayed','failed','suppressed'].includes(kind)||typeof data?.email_id!=='string'||!uuid.test(data.email_id)||!Array.isArray(data.to)||data.to.length!==1||typeof data.to[0]!=='string'||data.to[0].length>254)return;
 const id=data.tags?.icash_purchase_email_id;
 await db('rpc/icash_purchase_access_email_delivery','POST',{p_id:typeof id==='string'&&uuid.test(id)?id:null,p_provider:data.email_id,p_recipient:data.to[0],p_kind:kind});
}
