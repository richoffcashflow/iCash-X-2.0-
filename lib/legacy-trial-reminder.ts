import type Stripe from 'stripe';
import {db as database} from '@/lib/stripe-test';
import {fundingStripe} from '@/lib/funding';
import {legacyTrialVersion} from '@/lib/legacy-trial-policy';
type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Environment=Record<string,string|undefined>;
type TrialMember={id:string;mode:string;state:string;price_cents:number;legacy_trial_offer:string|null;legacy_trial_end:string|null;legacy_trial_started_at:string|null;stripe_subscription_id:string|null;stripe_customer_id:string|null;checkout_email:string|null;payer_email:string|null;paid_through:string|null;cancel_at_period_end:boolean};
type Message={from:string;to:string[];reply_to:string;subject:string;text:string};
type Claim={id:string;token:string;message:Message};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ref=(v:string|{id:string}|null|undefined)=>typeof v==='string'?v:v?.id;
export function legacyTrialReminderMessage(email:string,end:number):Message{
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||!Number.isSafeInteger(end))throw Error('Invalid trial reminder');
 const date=new Intl.DateTimeFormat('en-US',{dateStyle:'long',timeStyle:'long',timeZone:'UTC',hour12:true}).format(new Date(end*1000));
 return {from:'iCash X <signin@geticashx.com>',to:[email],reply_to:'support@geticashx.com',subject:'Your iCash X free period ends soon',text:`Your iCash X free software-access period ends on ${date}.\n\nAfter that time, your software subscription will renew at $50 USD per month until cancelled. Paid AI work credits are separate and are not included in this subscription.\n\nTo avoid the first $50 charge, cancel before ${date}. Sign in with your checkout email at https://www.geticashx.com/access, then open Settings → Billing and cancel your subscription. Cancellation ends software access immediately.\n\nNeed help cancelling or signing in? https://www.geticashx.com/access/help\n\nThis is a billing reminder, not a receipt or a request to purchase again.\n\niCash X`};
}
/** Only the signature-verified Stripe trial_will_end handler calls this. Provider
 * reads, not event metadata or event email, determine the subscription/recipient.
 * Stripe retries failed webhooks; durable claims reuse a single immutable payload.
 */
export async function sendLegacyTrialReminder(subscriptionId:string,options:{db?:Database;stripe?:Pick<Stripe,'subscriptions'|'customers'>;env?:Environment;transport?:typeof fetch;now?:number}={}){
 const env=options.env??process.env;
 // Preview/test never sends, even when the preview offer itself is enabled.
 if(env.VERCEL_ENV!=='production')return {sent:false,reason:'not_production'};
 if(!/^sub_[A-Za-z0-9]+$/.test(subscriptionId))throw Error('Invalid trial subscription');
 const stripe=options.stripe??fundingStripe(),db=options.db??database,now=options.now??Date.now();
 const sub=await stripe.subscriptions.retrieve(subscriptionId);
 if(sub.id!==subscriptionId||!sub.livemode)throw Error('Trial reminder mode mismatch');
 if(sub.metadata.icash_legacy_trial!==legacyTrialVersion)return {sent:false,reason:'not_offer'};
 const id=sub.metadata.icash_membership;if(!id||!uuid.test(id))throw Error('Invalid trial membership');
 if(sub.status!=='trialing'||sub.cancel_at_period_end||sub.cancel_at!==null||!sub.trial_end||sub.trial_end*1000<=now||sub.trial_end*1000>now+4*86400000)return {sent:false,reason:'not_due'};
 const [m]=await db<TrialMember[]>(`icash_memberships?id=eq.${id}&select=*`),item=sub.items.data[0],customerId=ref(sub.customer);
 if(!m||m.mode!=='live'||m.legacy_trial_offer!==legacyTrialVersion||m.stripe_subscription_id!==sub.id||m.stripe_customer_id!==customerId||!m.legacy_trial_end||Date.parse(m.legacy_trial_end)!==sub.trial_end*1000)throw Error('Trial reminder binding mismatch');
 if(m.state!=='active'||!m.legacy_trial_started_at||m.cancel_at_period_end||!m.paid_through||Date.parse(m.paid_through)<sub.trial_end*1000)return {sent:false,reason:'access_stopped'};
 if(m.price_cents!==5000||sub.items.has_more||sub.items.data.length!==1||item.quantity!==1||item.price.unit_amount!==5000||item.price.currency!=='usd'||item.price.recurring?.interval!=='month'||item.price.recurring.interval_count!==1||sub.discounts.length||sub.schedule||sub.pending_update)throw Error('Trial renewal terms changed');
 if(!customerId)throw Error('Trial customer missing');
 const customer=await stripe.customers.retrieve(customerId);
 if(customer.deleted||!customer.livemode||customer.id!==customerId||!customer.email||customer.email.toLowerCase()!==m.checkout_email||m.payer_email?.toLowerCase()!==m.checkout_email)throw Error('Trial recipient mismatch');
 if(env.ICASH_AUTH_EMAIL_READY!=='true'||!env.RESEND_API_KEY)throw Error('Trial reminder email unavailable');
 const message=legacyTrialReminderMessage(m.checkout_email!,sub.trial_end);
 const claim=await db<Claim|null>('rpc/icash_claim_legacy_trial_reminder','POST',{p_membership:m.id,p_subscription:sub.id,p_trial_end:new Date(sub.trial_end*1000).toISOString(),p_message:message});
 if(!claim)return {sent:false,reason:'already_sent_or_stopped'};
 if(!uuid.test(claim.id)||!uuid.test(claim.token)||JSON.stringify(claim.message.to)!==JSON.stringify(message.to))throw Error('Invalid reminder claim');
 let retry=true;
 try{
  const response=await (options.transport??fetch)('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`legacy-trial-ending-${claim.id}`},body:JSON.stringify(claim.message)});
  retry=response.status===429||response.status>=500||response.status===409;
  if(!response.ok)throw Error('Reminder provider rejected request');
  retry=true;const receipt=await response.json();if(typeof receipt?.id!=='string'||!uuid.test(receipt.id))throw Error('Missing reminder receipt');
  await db('rpc/icash_finish_legacy_trial_reminder','POST',{p_id:claim.id,p_token:claim.token,p_provider:receipt.id,p_retry:false});
  return {sent:true};
 }catch(error){
  try{await db('rpc/icash_finish_legacy_trial_reminder','POST',{p_id:claim.id,p_token:claim.token,p_provider:null,p_retry:retry});}catch{/* Keep lease/first-attempt boundary; Stripe will retry. */}
  throw error;
 }
}
