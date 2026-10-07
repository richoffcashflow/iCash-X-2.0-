import type Stripe from 'stripe';
import {vipActive} from '@/lib/vip-policy';
import {authorizedPlanPrice} from '@/lib/vip-membership';
import {db} from '@/lib/stripe-test';
import {fundingStripe} from '@/lib/funding';
import {fundingMode} from '@/lib/funding-policy';
import {membershipAccessible,validOffer,type MembershipOffer} from './membership-policy';
export type Membership={post_purchase_webinar_id?:string|null;vip_until?:string|null;initial_price_cents?:number|null;id:string;mode:'live'|'test';account_id:string|null;guest_hash:string;price_cents:number;offer_revision:number;state:string;stripe_session_id:string|null;stripe_subscription_id:string|null;stripe_customer_id:string|null;paid_through:string|null;cancel_at_period_end:boolean;payer_email:string|null;payer_phone?:string|null;checkout_url:string|null;consent_version?:string;retention_requested_at?:string|null;retention_started_at?:string|null;retention_ends_at?:string|null;retention_discount_id?:string|null};
export const retentionVersion='retention-50-six-months-v1';
const retentionCoupon='icash-retention-50-six-months-v1';
const identifier=(value:unknown,prefix:string)=>typeof value==='string'&&new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(value);
const ref=(value:string|{id:string}|null|undefined)=>typeof value==='string'?value:value?.id;
export async function membershipOffer():Promise<MembershipOffer>{const [row]=await db<{revision:number;price_cents:number;enabled:boolean}[]>('icash_membership_offer?id=eq.1&select=revision,price_cents,enabled');const offer={revision:row?.revision,priceCents:row?.price_cents,interval:'month' as const,enabled:row?.enabled};if(!validOffer(offer))throw Error('Software pricing is unavailable.');return offer;}
export async function accountMembership(accountId:string){const mode=fundingMode();if(!mode)throw Error('Billing mode unavailable');const rows=await db<Membership[]>(`icash_memberships?account_id=eq.${accountId}&mode=eq.${mode}&order=created_at.desc&limit=10&select=*`);return rows.find(m=>membershipAccessible(m))??rows.find(m=>m.state!=='cancelled')??rows[0]??null;}
export function publicMembership(m:Membership|null){return m?{state:m.state,priceCents:m.price_cents,vip:vipActive(m),vipUntil:m.vip_until??null,pendingDowngrade:vipActive(m)&&m.price_cents===5000,paidThrough:m.paid_through,cancelAtPeriodEnd:m.cancel_at_period_end,accessible:membershipAccessible(m),retentionEndsAt:m.retention_ends_at??null}:null;}
export async function membershipRetentionOffer(m:Membership|null){
 if(!m?.account_id||!membershipAccessible(m)||m.cancel_at_period_end||!m.stripe_subscription_id)return null;
 const prior=await db<{id:string}[]>(`icash_memberships?account_id=eq.${m.account_id}&mode=eq.${m.mode}&retention_requested_at=not.is.null&select=id&limit=1`);
 return {eligible:prior.length===0,retryable:!!m.retention_requested_at&&!m.retention_discount_id,priceCents:m.price_cents-Math.round(m.price_cents*.5),months:6,version:retentionVersion};
}
function verifiedRetentionDiscount(m:Membership,subId:string,value:string|Stripe.Discount|Stripe.DeletedDiscount){
 const end=typeof value==='string'?null:'end' in value?value.end:m.retention_ends_at?Date.parse(m.retention_ends_at)/1000:null;
 if(typeof value==='string'||!m.retention_requested_at||value.subscription!==subId||ref(value.customer)!==m.stripe_customer_id||value.promotion_code||value.source.type!=='coupon'||ref(value.source.coupon)!==retentionCoupon||!Number.isSafeInteger(value.start)||!end||!Number.isSafeInteger(end)||value.start<Date.parse(m.retention_requested_at)/1000-60||end-value.start<180*86400||end-value.start>186*86400||m.retention_discount_id&&m.retention_discount_id!==value.id)throw Error('Retention discount mismatch');
 const coupon=value.source.coupon;
 if(typeof coupon!=='object'||!coupon||coupon.percent_off!==50||coupon.duration!=='repeating'||coupon.duration_in_months!==6||coupon.amount_off!==null)throw Error('Retention coupon mismatch');
 return {id:value.id,start:value.start,end:end as number};
}
async function recordRetention(m:Membership,subId:string,value:string|Stripe.Discount|Stripe.DeletedDiscount){
 const discount=verifiedRetentionDiscount(m,subId,value);
 const saved=await db<Membership[]>(`icash_memberships?id=eq.${m.id}&retention_requested_at=not.is.null&retention_discount_id=${m.retention_discount_id?'eq.'+m.retention_discount_id:'is.null'}`,'PATCH',{retention_discount_id:discount.id,retention_started_at:new Date(discount.start*1000).toISOString(),retention_ends_at:new Date(discount.end!*1000).toISOString()});
 if(saved.length!==1)throw Error('Retention record changed');return saved[0];
}
export async function retainMembership(m:Membership){
 if(m.mode!==fundingMode()||!m.account_id||!membershipAccessible(m)||m.cancel_at_period_end||!m.stripe_subscription_id)throw Error('Retention unavailable');
 const stripe=fundingStripe();
 let sub=await stripe.subscriptions.retrieve(m.stripe_subscription_id,{expand:['discounts.source.coupon']});
 if((await matchingMembership(sub))?.id!==m.id||sub.status!=='active'||sub.cancel_at_period_end||sub.pending_update||sub.schedule)throw Error('Retention unavailable');
 if(sub.discounts.length&&(!m.retention_requested_at||sub.discounts.length!==1))throw Error('A discount is already active');
 m=await db<Membership>('rpc/icash_claim_membership_retention','POST',{p_membership:m.id,p_account:m.account_id,p_mode:m.mode});
 if(sub.discounts.length===1){const saved=await recordRetention(m,sub.id,sub.discounts[0]);if(!membershipAccessible(saved))throw Error('Subscription stopped');return;}
 if(m.retention_discount_id)throw Error('Retention was already used');
 let coupon:Stripe.Coupon;
 try{coupon=await stripe.coupons.retrieve(retentionCoupon);}catch(error){if((error as {code?:string}).code!=='resource_missing')throw error;coupon=await stripe.coupons.create({id:retentionCoupon,name:'iCash X · 50% off for 6 months',percent_off:50,duration:'repeating',duration_in_months:6},{idempotencyKey:retentionCoupon});}
 if(!coupon.valid||coupon.percent_off!==50||coupon.duration!=='repeating'||coupon.duration_in_months!==6||coupon.amount_off!==null)throw Error('Retention coupon unavailable');
 sub=await stripe.subscriptions.update(sub.id,{discounts:[{coupon:retentionCoupon}],proration_behavior:'none',expand:['discounts.source.coupon']},{idempotencyKey:`membership-retain:${m.id}`});
 if((await matchingMembership(sub))?.id!==m.id||sub.discounts.length!==1)throw Error('Retention not confirmed');
 const saved=await recordRetention(m,sub.id,sub.discounts[0]);if(!membershipAccessible(saved))throw Error('Subscription stopped');
}
async function matchingMembership(sub:Stripe.Subscription){
 const id=sub.metadata.icash_membership;if(!id)return null;
 if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('Invalid membership reference');
 const [m]=await db<Membership[]>(`icash_memberships?id=eq.${id}&select=*`);const item=sub.items.data[0];
 if(!m||m.id!==id||m.mode!==fundingMode()||sub.livemode!==(m.mode==='live')||m.stripe_subscription_id&&m.stripe_subscription_id!==sub.id||sub.items.has_more||sub.items.data.length!==1||item.quantity!==1||item.price.currency!=='usd'||item.price.unit_amount!==m.price_cents&&!await authorizedPlanPrice(m,sub)||item.price.recurring?.interval!=='month'||item.price.recurring.interval_count!==1)throw Error('Membership subscription mismatch');
 const customer=ref(sub.customer);if(!customer||m.stripe_customer_id&&m.stripe_customer_id!==customer)throw Error('Membership customer mismatch');
 return m;
}
/** Canonical Stripe reads prevent out-of-order webhook payloads from reviving old state. */
export async function syncMembershipSubscription(sub:Stripe.Subscription){
 const m=await matchingMembership(sub);if(!m)return false;
 const state=m.state==='cancelled'||sub.status==='canceled'?'cancelled':m.state==='cancel_requested'?'cancel_requested':m.state==='needs_review'?'needs_review':sub.status==='active'?'active':['past_due','unpaid','incomplete_expired','paused'].includes(sub.status)?'payment_failed':'pending';
 // Compare-and-set prevents a stale provider read from overwriting a newer
 // cancellation or review decision, independently of the database trigger.
 await db(`icash_memberships?id=eq.${m.id}&state=eq.${m.state}${state==='needs_review'?'':'&state=neq.needs_review'}`,'PATCH',{stripe_subscription_id:sub.id,stripe_customer_id:ref(sub.customer),state,cancel_at_period_end:sub.cancel_at_period_end,updated_at:new Date().toISOString()});
 return true;
}
export async function settleMembershipInvoice(invoiceId:string){
 if(!identifier(invoiceId,'in'))throw Error('Invalid invoice');
 const stripe=fundingStripe(),invoice=await stripe.invoices.retrieve(invoiceId,{expand:['discounts.source.coupon']}),subId=ref(invoice.parent?.subscription_details?.subscription);
 if(!subId)return false;const sub=await stripe.subscriptions.retrieve(subId);let m=await matchingMembership(sub);if(!m)return false;
 const [settled]=await db<{membership_id:string;stripe_payment_id:string;amount_cents:number;period_end:string}[]>(`icash_membership_invoices?stripe_invoice_id=eq.${invoice.id}&select=membership_id,stripe_payment_id,amount_cents,period_end`);if(settled){if(settled.membership_id!==m.id||invoice.status!=='paid'||invoice.total!==settled.amount_cents||ref(invoice.customer)!==m.stripe_customer_id||invoice.livemode!==(m.mode==='live'))throw Error('Settled invoice changed');return true;}
 const discounts=(invoice.total_discount_amounts??[]).filter(d=>d.amount!==0);let discountId:string|null=null,expected=m.price_cents;
 if(discounts.length){
  if(discounts.length!==1||discounts[0].amount!==Math.round(m.price_cents*.5)||invoice.discounts.length!==1)throw Error('Unexpected membership discount');
  const discount=verifiedRetentionDiscount(m,subId,invoice.discounts[0]);if(ref(discounts[0].discount)!==discount.id)throw Error('Invoice discount mismatch');
  m=await recordRetention(m,subId,invoice.discounts[0]);discountId=discount.id;expected-=discounts[0].amount;
 }
 if(invoice.id!==invoiceId||invoice.livemode!==sub.livemode||invoice.status!=='paid'||invoice.currency!=='usd'||invoice.amount_remaining!==0||invoice.amount_paid!==expected||invoice.total!==expected||invoice.subtotal!==m.price_cents||ref(invoice.customer)!==ref(sub.customer)||(invoice.total_taxes??[]).some(t=>t.amount!==0))throw Error('Membership invoice mismatch');
 const lines=await stripe.invoices.listLineItems(invoice.id,{limit:2});const line=lines.data[0];
 if(lines.has_more||lines.data.length!==1||line.quantity!==1||line.amount!==m.price_cents||line.pricing?.price_details?.price!==sub.items.data[0].price.id||!Number.isSafeInteger(line.period.start)||!Number.isSafeInteger(line.period.end)||line.period.end<=line.period.start||line.period.end-line.period.start>32*86400)throw Error('Membership invoice line mismatch');
 if(!discountId&&m.retention_started_at&&m.retention_ends_at&&line.period.start>=Date.parse(m.retention_started_at)/1000&&line.period.start<Date.parse(m.retention_ends_at)/1000)throw Error('Missing retention discount');
 if(discountId&&(line.period.start<Date.parse(m.retention_started_at!)/1000||line.period.start>=Date.parse(m.retention_ends_at!)/1000))throw Error('Retention period mismatch');
 const payments=await stripe.invoicePayments.list({invoice:invoice.id,status:'paid',limit:2});const payment=ref(payments.data[0]?.payment.payment_intent);
 if(payments.has_more||payments.data.length!==1||!payment)throw Error('Membership payment missing');
 const pi=await stripe.paymentIntents.retrieve(payment);if(pi.status!=='succeeded'||pi.amount_received!==expected||pi.currency!=='usd'||pi.livemode!==sub.livemode||ref(pi.customer)!==ref(sub.customer))throw Error('Membership payment mismatch');
 await db('rpc/icash_settle_membership_invoice_v2','POST',{p_membership:m.id,p_subscription:sub.id,p_customer:ref(sub.customer),p_invoice:invoice.id,p_payment:pi.id,p_amount:invoice.total,p_email:invoice.customer_email,p_phone:invoice.customer_phone,p_period_end:new Date(line.period.end*1000).toISOString(),p_period_start:new Date(line.period.start*1000).toISOString(),p_discount:discountId});
 await syncMembershipSubscription(sub);return true;
}
export async function reconcileMembershipCheckout(m:Membership){
 if(!m.stripe_session_id)return m;const stripe=fundingStripe(),s=await stripe.checkout.sessions.retrieve(m.stripe_session_id);
 if(s.id!==m.stripe_session_id||s.currency!=='usd'||s.amount_total!==(m.initial_price_cents??m.price_cents)||(s.total_details?.amount_discount??0)!==0||s.mode!=='subscription'||s.metadata?.icash_membership!==m.id||s.livemode!==(m.mode==='live'))throw Error('Checkout binding mismatch');
 if(s.status!=='complete'||s.payment_status!=='paid')return m;
 const subId=ref(s.subscription);if(!subId||m.stripe_subscription_id&&m.stripe_subscription_id!==subId)throw Error('Subscription binding mismatch');
 const sub=await stripe.subscriptions.retrieve(subId);if(sub.metadata.icash_membership!==m.id||ref(s.customer)!==ref(sub.customer))throw Error('Checkout subscription mismatch');await syncMembershipSubscription(sub);const invoice=ref(sub.latest_invoice);if(invoice)await settleMembershipInvoice(invoice);
 const [saved]=await db<Membership[]>(`icash_memberships?id=eq.${m.id}&select=*`);if(!saved.payer_phone&&s.customer_details?.phone){await db(`icash_memberships?id=eq.${m.id}`,'PATCH',{payer_phone:s.customer_details.phone.slice(0,40)});saved.payer_phone=s.customer_details.phone;}return saved;
}
/** Signed webhook input still requires a canonical Checkout and its stored purchase binding. */
export async function reconcileMembershipSession(sessionId:string){
 if(!/^cs_(live|test)_[A-Za-z0-9]+$/.test(sessionId))throw Error('Invalid membership checkout');
 const s=await fundingStripe().checkout.sessions.retrieve(sessionId),id=s.metadata?.icash_membership;
 if(!id||!/^[0-9a-f-]{36}$/i.test(id))throw Error('Invalid membership reference');
 const [m]=await db<Membership[]>(`icash_memberships?id=eq.${id}&select=*`);
 if(!m||m.id!==id||m.mode!==fundingMode()||s.mode!=='subscription'||s.livemode!==(m.mode==='live')||m.stripe_session_id&&m.stripe_session_id!==s.id)throw Error('Membership checkout mismatch');
 if(!m.stripe_session_id)await db(`icash_memberships?id=eq.${m.id}`,'PATCH',{stripe_session_id:s.id});
 return reconcileMembershipCheckout({...m,stripe_session_id:s.id});
}
/** Authenticated callers supply the account-scoped row; no caller-provided Stripe IDs. */
export async function stopMembership(m:Membership){
 if(m.mode!==fundingMode())throw Error('Billing mode mismatch');
 // Persist the lock and pause before contacting Stripe. The reconciliation job retries failures.
 m=await db<Membership>('rpc/icash_request_membership_cancellation','POST',{p_membership:m.id,p_account:m.account_id,p_mode:m.mode});
 try{
 const stripe=fundingStripe();
 if(!m.stripe_subscription_id){if(m.stripe_session_id){const s=await stripe.checkout.sessions.retrieve(m.stripe_session_id);if(s.metadata?.icash_membership!==m.id)throw Error('Checkout mismatch');if(s.status==='open')await stripe.checkout.sessions.expire(s.id);else if(s.status==='complete'){m=await reconcileMembershipCheckout(m);if(m.stripe_subscription_id)return stopMembership(m);}}await db(`icash_memberships?id=eq.${m.id}`,'PATCH',{state:'cancelled',cancel_at_period_end:true});return;}
 const sub=await stripe.subscriptions.retrieve(m.stripe_subscription_id);if((await matchingMembership(sub))?.id!==m.id)throw Error('Cancellation subscription mismatch');
 if(sub.status==='canceled'){await syncMembershipSubscription(sub);return;}
 const updated=await stripe.subscriptions.cancel(sub.id,{invoice_now:false,prorate:false});
 if(updated.status!=='canceled')throw Error('Cancellation not confirmed');await syncMembershipSubscription(updated);
 }catch{throw Error('MEMBERSHIP_CANCELLATION_PENDING');}
}
