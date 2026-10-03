import type Stripe from 'stripe';
import {db} from '@/lib/stripe-test';
import {fundingStripe} from '@/lib/funding';
import {fundingMode} from '@/lib/funding-policy';
import {membershipAccessible,validOffer,type MembershipOffer} from './membership-policy';
export type Membership={id:string;mode:'live'|'test';account_id:string|null;guest_hash:string;price_cents:number;offer_revision:number;state:string;stripe_session_id:string|null;stripe_subscription_id:string|null;stripe_customer_id:string|null;paid_through:string|null;cancel_at_period_end:boolean;payer_email:string|null;payer_phone?:string|null;checkout_url:string|null};
const identifier=(value:unknown,prefix:string)=>typeof value==='string'&&new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(value);
const ref=(value:string|{id:string}|null|undefined)=>typeof value==='string'?value:value?.id;
export async function membershipOffer():Promise<MembershipOffer>{const [row]=await db<{revision:number;price_cents:number;enabled:boolean}[]>('icash_membership_offer?id=eq.1&select=revision,price_cents,enabled');const offer={revision:row?.revision,priceCents:row?.price_cents,interval:'month' as const,enabled:row?.enabled};if(!validOffer(offer))throw Error('Software pricing is unavailable.');return offer;}
export async function accountMembership(accountId:string){const mode=fundingMode();if(!mode)throw Error('Billing mode unavailable');const rows=await db<Membership[]>(`icash_memberships?account_id=eq.${accountId}&mode=eq.${mode}&order=created_at.desc&limit=10&select=*`);return rows.find(m=>membershipAccessible(m))??rows.find(m=>m.state!=='cancelled')??rows[0]??null;}
export function publicMembership(m:Membership|null){return m?{state:m.state,priceCents:m.price_cents,paidThrough:m.paid_through,cancelAtPeriodEnd:m.cancel_at_period_end,accessible:membershipAccessible(m)}:null;}
async function matchingMembership(sub:Stripe.Subscription){
 const id=sub.metadata.icash_membership;if(!id)return null;
 if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('Invalid membership reference');
 const [m]=await db<Membership[]>(`icash_memberships?id=eq.${id}&select=*`);const item=sub.items.data[0];
 if(!m||m.id!==id||m.mode!==fundingMode()||sub.livemode!==(m.mode==='live')||m.stripe_subscription_id&&m.stripe_subscription_id!==sub.id||sub.items.has_more||sub.items.data.length!==1||item.quantity!==1||item.price.currency!=='usd'||item.price.unit_amount!==m.price_cents||item.price.recurring?.interval!=='month'||item.price.recurring.interval_count!==1)throw Error('Membership subscription mismatch');
 const customer=ref(sub.customer);if(!customer||m.stripe_customer_id&&m.stripe_customer_id!==customer)throw Error('Membership customer mismatch');
 return m;
}
/** Canonical Stripe reads prevent out-of-order webhook payloads from reviving old state. */
export async function syncMembershipSubscription(sub:Stripe.Subscription){
 const m=await matchingMembership(sub);if(!m)return false;
 const state=m.state==='needs_review'?'needs_review':sub.status==='active'?'active':sub.status==='canceled'?'cancelled':['past_due','unpaid','incomplete_expired','paused'].includes(sub.status)?'payment_failed':'pending';
 await db(`icash_memberships?id=eq.${m.id}${state==='needs_review'?'':'&state=neq.needs_review'}`,'PATCH',{stripe_subscription_id:sub.id,stripe_customer_id:ref(sub.customer),state,cancel_at_period_end:sub.cancel_at_period_end,updated_at:new Date().toISOString()});
 return true;
}
export async function settleMembershipInvoice(invoiceId:string){
 if(!identifier(invoiceId,'in'))throw Error('Invalid invoice');
 const stripe=fundingStripe(),invoice=await stripe.invoices.retrieve(invoiceId),subId=ref(invoice.parent?.subscription_details?.subscription);
 if(!subId)return false;const sub=await stripe.subscriptions.retrieve(subId),m=await matchingMembership(sub);if(!m)return false;
 if(invoice.id!==invoiceId||invoice.livemode!==sub.livemode||invoice.status!=='paid'||invoice.currency!=='usd'||invoice.amount_remaining!==0||invoice.amount_paid!==m.price_cents||invoice.total!==m.price_cents||invoice.subtotal!==m.price_cents||ref(invoice.customer)!==ref(sub.customer)||(invoice.total_discount_amounts??[]).some(d=>d.amount!==0)||(invoice.total_taxes??[]).some(t=>t.amount!==0))throw Error('Membership invoice mismatch');
 const lines=await stripe.invoices.listLineItems(invoice.id,{limit:2});const line=lines.data[0];
 if(lines.has_more||lines.data.length!==1||line.quantity!==1||line.amount!==m.price_cents||line.pricing?.price_details?.price!==sub.items.data[0].price.id||!Number.isSafeInteger(line.period.start)||!Number.isSafeInteger(line.period.end)||line.period.end<=line.period.start||line.period.end-line.period.start>32*86400)throw Error('Membership invoice line mismatch');
 const payments=await stripe.invoicePayments.list({invoice:invoice.id,status:'paid',limit:2});const payment=ref(payments.data[0]?.payment.payment_intent);
 if(payments.has_more||payments.data.length!==1||!payment)throw Error('Membership payment missing');
 const pi=await stripe.paymentIntents.retrieve(payment);if(pi.status!=='succeeded'||pi.amount_received!==m.price_cents||pi.currency!=='usd'||pi.livemode!==sub.livemode||ref(pi.customer)!==ref(sub.customer))throw Error('Membership payment mismatch');
 await db('rpc/icash_settle_membership_invoice','POST',{p_membership:m.id,p_subscription:sub.id,p_customer:ref(sub.customer),p_invoice:invoice.id,p_payment:pi.id,p_amount:invoice.total,p_email:invoice.customer_email,p_phone:invoice.customer_phone,p_period_end:new Date(line.period.end*1000).toISOString()});
 await syncMembershipSubscription(sub);return true;
}
export async function reconcileMembershipCheckout(m:Membership){
 if(!m.stripe_session_id)return m;const stripe=fundingStripe(),s=await stripe.checkout.sessions.retrieve(m.stripe_session_id);
 if(s.id!==m.stripe_session_id||s.currency!=='usd'||s.amount_total!==m.price_cents||(s.total_details?.amount_discount??0)!==0||s.mode!=='subscription'||s.metadata?.icash_membership!==m.id||s.livemode!==(m.mode==='live'))throw Error('Checkout binding mismatch');
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
 const stripe=fundingStripe();if(m.mode!==fundingMode())throw Error('Billing mode mismatch');
 if(!m.stripe_subscription_id){if(m.stripe_session_id){const s=await stripe.checkout.sessions.retrieve(m.stripe_session_id);if(s.metadata?.icash_membership!==m.id)throw Error('Checkout mismatch');if(s.status==='open')await stripe.checkout.sessions.expire(s.id);else if(s.status==='complete'){m=await reconcileMembershipCheckout(m);if(m.stripe_subscription_id)return stopMembership(m);}}await db(`icash_memberships?id=eq.${m.id}`,'PATCH',{state:'cancelled',cancel_at_period_end:true});return;}
 const sub=await stripe.subscriptions.retrieve(m.stripe_subscription_id);if((await matchingMembership(sub))?.id!==m.id)throw Error('Cancellation subscription mismatch');
 if(sub.status==='canceled'){await syncMembershipSubscription(sub);return;}
 const updated=await stripe.subscriptions.update(sub.id,{cancel_at_period_end:true},{idempotencyKey:`membership-stop:${m.id}:${sub.items.data[0].current_period_end}`});
 if(!updated.cancel_at_period_end)throw Error('Cancellation not confirmed');await syncMembershipSubscription(updated);
}
