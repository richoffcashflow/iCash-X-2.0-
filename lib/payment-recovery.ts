import type Stripe from 'stripe';
import {recoveryCopy,recoveryStep} from './payment-recovery-policy.ts';
type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type BillingStripe=Pick<Stripe,'invoices'|'subscriptions'>;
type Kind='membership'|'private_vip'|'recharge';
type Recovery={id:string;kind:Kind;source_id:string;account_id:string|null;invoice_id:string|null;amount_cents:number;started_at:string;lease_token:string};
type Member={id:string;account_id:string|null;mode:string;state:string;stripe_subscription_id?:string;stripe_customer_id?:string;subscription_id?:string;customer_id?:string;membership_id?:string;payer_email?:string;checkout_email?:string;cancel_at_period_end:boolean};
const ref=(v:string|{id:string}|null|undefined)=>typeof v==='string'?v:v?.id;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailOk=(value:unknown):value is string=>typeof value==='string'&&value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
async function invoiceSource(invoice:Stripe.Invoice,sub:Stripe.Subscription,db:Database){
 if(!invoice.livemode||!sub.livemode||invoice.currency!=='usd'||ref(invoice.parent?.subscription_details?.subscription)!==sub.id||ref(invoice.customer)!==ref(sub.customer))throw Error('Recovery invoice binding mismatch');
 const kind=sub.metadata.icash_private_vip?'private_vip':'membership';
 const id=sub.metadata.icash_private_vip??sub.metadata.icash_membership;
 if(!id||!uuid.test(id))return null;
 const [m]=await db<Member[]>(`${kind==='private_vip'?'icash_private_vip_subscriptions':'icash_memberships'}?id=eq.${id}&select=*`);
 if(!m||m.mode!=='live'||(m.stripe_subscription_id??m.subscription_id)!==sub.id||(m.stripe_customer_id??m.customer_id)!==ref(sub.customer))throw Error('Recovery membership binding mismatch');
 let email=m.payer_email??m.checkout_email;
 if(kind==='private_vip'){
  if(!m.membership_id||!uuid.test(m.membership_id))throw Error('Recovery VIP parent missing');
  const [parent]=await db<Member[]>(`icash_memberships?id=eq.${m.membership_id}&account_id=eq.${m.account_id}&mode=eq.live&select=payer_email,checkout_email`);
  email=parent?.payer_email??parent?.checkout_email;
 }
 if(!emailOk(email)||invoice.customer_email?.toLowerCase()!==email.toLowerCase())throw Error('Recovery recipient mismatch');
 return {kind:kind as 'membership'|'private_vip',member:m,email:email.toLowerCase()};
}
/** Called only with fresh Stripe reads; webhook order never determines eligibility. */
export async function observeInvoiceRecovery(invoice:Stripe.Invoice,sub:Stripe.Subscription,db:Database,now=Date.now()){
 if(!invoice.livemode&&!sub.livemode)return;
 if(invoice.status!=='open'||!invoice.attempted||invoice.billing_reason!=='subscription_cycle'||invoice.amount_remaining<=0||sub.status!=='past_due'||sub.cancel_at_period_end||sub.cancel_at||sub.pause_collection||invoice.created*1000<now-14*86400000)return;
 const source=await invoiceSource(invoice,sub,db);if(!source)return;
 await db('rpc/icash_register_invoice_recovery','POST',{p_kind:source.kind,p_source:source.member.id,p_account:source.member.account_id,p_invoice:invoice.id,p_amount:invoice.amount_remaining,p_started:new Date(invoice.created*1000).toISOString()});
}
function invoiceLink(value:string|null|undefined){
 if(!value)throw Error('Recovery invoice link missing');
 const u=new URL(value);if(u.protocol!=='https:'||u.hostname!=='invoice.stripe.com'||u.username||u.password)throw Error('Invalid invoice link');return u.href;
}
/** A bounded maintenance lane. No invoice.pay calls: Stripe owns renewal retries. */
export async function processPaymentRecoveries({db,stripe,env=process.env,transport=fetch,now=Date.now()}:{db:Database;stripe:()=>BillingStripe;env?:Record<string,string|undefined>;transport?:typeof fetch;now?:number}){
 if(env.VERCEL_ENV!=='production'||env.ICASH_AUTH_EMAIL_READY!=='true'||!env.RESEND_API_KEY)return {checked:0,accepted:0,failed:0,disabled:true};
 const cases=await db<Recovery[]>('rpc/icash_claim_payment_recoveries','POST',{});
 let checked=0,accepted=0,failed=0;
 for(const c of cases){
  checked++;let state:'open'|'closed'|'recovered'='open',recovered=0;
  try{
   if(!uuid.test(c.id)||!uuid.test(c.source_id)||!uuid.test(c.lease_token))throw Error('Invalid recovery claim');
   let email:string,link:string;
   if(c.invoice_id){
    const provider=stripe(),invoice=await provider.invoices.retrieve(c.invoice_id),sid=ref(invoice.parent?.subscription_details?.subscription);
    if(!sid)throw Error('Recovery subscription missing');
    const sub=await provider.subscriptions.retrieve(sid),source=await invoiceSource(invoice,sub,db);
    if(!source||source.kind!==c.kind||source.member.id!==c.source_id||source.member.account_id!==c.account_id)throw Error('Recovery source changed');
    if(invoice.status==='paid'){state='recovered';recovered=Math.min(c.amount_cents,invoice.amount_paid);continue;}
    if(invoice.status!=='open'||sub.status!=='past_due'||sub.cancel_at_period_end||sub.cancel_at||sub.pause_collection||source.member.cancel_at_period_end||['cancelled','cancel_requested','needs_review'].includes(source.member.state)){state='closed';continue;}
    if(invoice.amount_remaining!==c.amount_cents){state='closed';continue;}
    email=source.email;link=invoiceLink(invoice.hosted_invoice_url);
   }else if(c.kind==='recharge'&&c.account_id){
    const [order]=await db<{payer_email:string;price_cents:number}[]>(`icash_funding_orders?id=eq.${c.source_id}&account_id=eq.${c.account_id}&mode=eq.live&state=eq.paid&select=payer_email,price_cents`);
    if(!order||!emailOk(order.payer_email)||order.price_cents!==c.amount_cents)throw Error('Recharge reminder binding mismatch');
    const paid=await db<{id:string}[]>(`icash_funding_orders?account_id=eq.${c.account_id}&mode=eq.live&state=eq.paid&credited_at=gt.${encodeURIComponent(c.started_at)}&select=id&limit=1`);
    if(paid.length){state='closed';continue;}
    email=order.payer_email.toLowerCase();link='https://www.geticashx.com/#funding';
   }else throw Error('Invalid recovery kind');
   if(now-Date.parse(c.started_at)>=14*86400000||!await db<boolean>('rpc/icash_payment_recovery_active','POST',{p_case:c.id})){state='closed';continue;}
   for(const channel of ['email','sms'] as const){
    if(channel==='sms'&&(!env.CONTIGUITY_API_KEY||!env.CONTIGUITY_WEBHOOK_SECRET))continue;
    const step=recoveryStep(channel,c.started_at,now);if(step===null)continue;
    const copy=recoveryCopy(c.kind,c.amount_cents,step,link);
    const message=channel==='email'?{from:'iCash X <signin@geticashx.com>',reply_to:'support@geticashx.com',to:[email],subject:copy.subject,text:copy.text}:{message:copy.sms};
    const job=await db<{id:string;recipient:string;sender:string|null;message:typeof message}|null>('rpc/icash_claim_payment_recovery_message','POST',{p_case:c.id,p_token:c.lease_token,p_channel:channel,p_step:step,p_email:email,p_message:message});
    if(!job)continue;
    if(!uuid.test(job.id)||channel==='email'&&job.recipient!==email||channel==='sms'&&(!/^\+[1-9]\d{7,14}$/.test(job.recipient)||!/^\+[1-9]\d{7,14}$/.test(job.sender??'')))throw Error('Invalid recovery recipient');
    // The database has just rechecked cancellation, suppression and SMS consent.
    const response=await transport(channel==='email'?'https://api.resend.com/emails':'https://api.contiguity.com/send/text',{
     method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:channel==='email'?{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`payment-recovery-${job.id}`}:{Authorization:`Token ${env.CONTIGUITY_API_KEY}`,'Content-Type':'application/json'},
     body:JSON.stringify(channel==='email'?{...job.message,tags:[{name:'icash_payment_recovery_id',value:job.id}]}:{from:job.sender,to:job.recipient,message:job.message.message,attachments:[],fast_track:false})});
    if(!response.ok)throw Error('Recovery delivery unconfirmed');
    const receipt=await response.json(),providerId=channel==='email'?receipt?.id:receipt?.data?.message_id;
    if(typeof providerId!=='string'||!providerId||providerId.length>200)throw Error('Recovery receipt missing');
    await db(`icash_payment_recovery_deliveries?id=eq.${job.id}&state=eq.sending`,'PATCH',{state:'accepted',provider_id:providerId});accepted++;
   }
  }catch{failed++;}
  finally{try{await db('rpc/icash_finish_payment_recovery','POST',{p_case:c.id,p_token:c.lease_token,p_state:state,p_recovered:recovered});}catch{failed++;}}
 }
 return {checked,accepted,failed};
}
/** The caller verifies the Resend signature before reaching this handler. */
export async function recordPaymentRecoveryDelivery(event:{type?:string;data?:{email_id?:unknown;to?:unknown;tags?:Record<string,unknown>}},db:Database){
 const data=event.data,id=data?.tags?.icash_payment_recovery_id,recipient=Array.isArray(data?.to)&&data.to.length===1?data.to[0]:null;
 if(!['email.delivered','email.bounced','email.complained','email.failed','email.suppressed'].includes(event.type??'')||typeof data?.email_id!=='string'||!uuid.test(data.email_id)||!emailOk(recipient))return;
 await db('rpc/icash_payment_recovery_delivery_event','POST',{p_id:typeof id==='string'&&uuid.test(id)?id:null,p_provider:data.email_id,p_recipient:recipient.toLowerCase(),p_event:event.type});
}
