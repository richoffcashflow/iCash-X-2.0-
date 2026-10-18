import type Stripe from 'stripe';
import type {Membership} from '@/lib/membership';
import {db} from '@/lib/stripe-test';
import {fundingStripe} from '@/lib/funding';
import {fundingMode} from '@/lib/funding-policy';
import {membershipAccessible} from '@/lib/membership-policy';
import {recordPurchaseAcceptance} from '@/lib/purchase-acceptance';
import {bindCheckoutMeasurement} from '@/lib/checkout-measurement';
import {privateVipVersion,privateVipTerms,privateVipCents} from './private-vip-policy.ts';
type PrivateVip={id:string;membership_id:string;account_id:string;mode:'live'|'test';state:string;customer_id:string|null;session_id:string|null;subscription_id:string|null;paid_until:string|null;cancel_at_period_end:boolean;created_at:string};
const ref=(v:string|{id:string}|null|undefined)=>typeof v==='string'?v:v?.id;
async function row(id:string){if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('Invalid VIP reference');const [v]=await db<PrivateVip[]>(`icash_private_vip_subscriptions?id=eq.${id}&select=*`);if(!v||v.mode!==fundingMode())throw Error('VIP subscription unavailable');return v;}
async function latest(m:Membership){const [v]=await db<PrivateVip[]>(`icash_private_vip_subscriptions?membership_id=eq.${m.id}&account_id=eq.${m.account_id}&mode=eq.${m.mode}&order=created_at.desc&limit=1&select=*`);return v??null;}
export async function privateVipView(m:Membership|null){if(!m?.private_invite_id)return null;const v=await latest(m);return v?{state:v.state,paidUntil:v.paid_until,cancelAtPeriodEnd:v.cancel_at_period_end,hasSubscription:!!v.subscription_id}:null;}
async function bound(v:PrivateVip,s:Stripe.Subscription){
 const i=s.items.data[0];const [m]=await db<Membership[]>(`icash_memberships?id=eq.${v.membership_id}&select=*`);
 if(!m?.private_invite_id||m.account_id!==v.account_id||m.mode!==v.mode||v.mode!==fundingMode()||s.metadata.icash_private_vip!==v.id||s.livemode!==(v.mode==='live')||ref(s.customer)!==v.customer_id||v.subscription_id&&v.subscription_id!==s.id||s.items.has_more||s.items.data.length!==1||i.quantity!==1||i.price.unit_amount!==privateVipCents||i.price.currency!=='usd'||i.price.recurring?.interval!=='month'||i.price.recurring.interval_count!==1||i.price.recurring.usage_type!=='licensed'||i.price.billing_scheme!=='per_unit'||i.price.transform_quantity||i.discounts?.length||s.discounts.length||s.schedule||s.pending_update)throw Error('VIP subscription binding mismatch');
 const [receipt]=await db<{terms_text:string;amount_cents:number}[]>(`icash_purchase_acceptances?kind=eq.vip&reference_id=eq.${v.id}&account_id=eq.${v.account_id}&mode=eq.${v.mode}&version=eq.${privateVipVersion}&select=terms_text,amount_cents&limit=1`);
 if(!receipt||receipt.terms_text!==privateVipTerms||receipt.amount_cents!==privateVipCents)throw Error('VIP purchase acceptance missing');
 return i;
}
export async function syncPrivateVip(s:Stripe.Subscription){
 const id=s.metadata.icash_private_vip;if(!id)return false;const v=await row(id);await bound(v,s);
 const state=v.state==='needs_review'?'needs_review':v.state==='cancelled'||s.status==='canceled'?'cancelled':s.status==='active'?'active':['past_due','unpaid','paused','incomplete_expired'].includes(s.status)?'past_due':'pending';
 if(v.state==='expired')throw Error('Expired VIP checkout requires review');
 await db(`icash_private_vip_subscriptions?id=eq.${v.id}&state=eq.${v.state}`,'PATCH',{subscription_id:s.id,state,cancel_at_period_end:s.cancel_at_period_end,updated_at:new Date().toISOString()});return true;
}
export async function settlePrivateVipInvoice(invoiceId:string){
 const stripe=fundingStripe(),invoice=await stripe.invoices.retrieve(invoiceId),subId=ref(invoice.parent?.subscription_details?.subscription);if(!subId)return false;
 const s=await stripe.subscriptions.retrieve(subId);if(!s.metadata.icash_private_vip)return false;
 let v=await row(s.metadata.icash_private_vip);const item=await bound(v,s);
 if(invoice.id!==invoiceId||invoice.livemode!==s.livemode||invoice.status!=='paid'||invoice.currency!=='usd'||invoice.amount_remaining!==0||invoice.amount_paid!==privateVipCents||invoice.total!==privateVipCents||invoice.subtotal!==privateVipCents||ref(invoice.customer)!==v.customer_id||(invoice.total_discount_amounts??[]).some(d=>d.amount!==0)||(invoice.total_taxes??[]).some(t=>t.amount!==0))throw Error('VIP invoice mismatch');
 const lines=await stripe.invoices.listLineItems(invoice.id,{limit:2}),line=lines.data[0];
 if(lines.has_more||lines.data.length!==1||line.quantity!==1||line.amount!==privateVipCents||line.pricing?.price_details?.price!==item.price.id||!Number.isSafeInteger(line.period.start)||!Number.isSafeInteger(line.period.end)||line.period.end<=line.period.start||line.period.end-line.period.start>32*86400||line.period.start>Date.now()/1000+300)throw Error('VIP invoice line mismatch');
 const payments=await stripe.invoicePayments.list({invoice:invoice.id,status:'paid',limit:2}),payment=ref(payments.data[0]?.payment.payment_intent);
 if(payments.has_more||payments.data.length!==1||!payment)throw Error('VIP payment missing');
 const pi=await stripe.paymentIntents.retrieve(payment);if(pi.status!=='succeeded'||pi.amount_received!==privateVipCents||pi.currency!=='usd'||pi.livemode!==s.livemode||ref(pi.customer)!==v.customer_id)throw Error('VIP payment mismatch');
 await syncPrivateVip(s);v=await row(v.id);
 await db('rpc/icash_settle_private_vip','POST',{p_id:v.id,p_subscription:s.id,p_customer:v.customer_id,p_invoice:invoice.id,p_payment:pi.id,p_start:new Date(line.period.start*1000).toISOString(),p_end:new Date(line.period.end*1000).toISOString()});return true;
}
export async function reconcilePrivateVipCheckout(sessionId:string){
 const stripe=fundingStripe(),s=await stripe.checkout.sessions.retrieve(sessionId),id=s.metadata?.icash_private_vip;if(!id)throw Error('VIP checkout binding missing');const v=await row(id);
 if(s.id!==sessionId||v.session_id&&v.session_id!==s.id||ref(s.customer)!==v.customer_id||s.mode!=='subscription'||s.livemode!==(v.mode==='live')||s.amount_total!==privateVipCents||s.amount_subtotal!==privateVipCents||s.currency!=='usd'||s.metadata?.icash_terms_version!==privateVipVersion||(s.total_details?.amount_discount??0)!==0||(s.total_details?.amount_tax??0)!==0)throw Error('VIP checkout mismatch');
 if(!v.session_id)await db(`icash_private_vip_subscriptions?id=eq.${v.id}&session_id=is.null`,'PATCH',{session_id:s.id});
 if(s.status==='expired'){await db(`icash_private_vip_subscriptions?id=eq.${v.id}&state=eq.pending&subscription_id=is.null`,'PATCH',{state:'expired'});return false;}
 if(s.status!=='complete'||s.payment_status!=='paid')return false;
 const subId=ref(s.subscription);if(!subId)throw Error('VIP subscription missing');const sub=await stripe.subscriptions.retrieve(subId);await bound(v,sub);await syncPrivateVip(sub);const invoice=ref(sub.latest_invoice);if(invoice)await settlePrivateVipInvoice(invoice);return true;
}
async function recover(v:PrivateVip){
 const stripe=fundingStripe();if(v.session_id&&!v.subscription_id)await reconcilePrivateVipCheckout(v.session_id);
 v=await row(v.id);if(v.subscription_id){const s=await stripe.subscriptions.retrieve(v.subscription_id);await syncPrivateVip(s);const paid=await stripe.invoices.list({subscription:s.id,status:'paid',limit:1});if(paid.data[0])await settlePrivateVipInvoice(paid.data[0].id);}
}
export async function reconcilePrivateVip(m:Membership){if(!m.private_invite_id)return;const v=await latest(m);if(v&&v.state!=='expired')await recover(v);}
export async function reconcilePrivateVips(deadline:number){
 const rows=await db<PrivateVip[]>(`icash_private_vip_subscriptions?mode=eq.${fundingMode()}&state=in.(pending,active,past_due)&order=updated_at.asc&limit=5&select=*`);let checked=0,failed=0;
 for(const v of rows){if(Date.now()>=deadline)break;checked++;try{await recover(v);}catch{failed++;}finally{await db(`icash_private_vip_subscriptions?id=eq.${v.id}`,'PATCH',{updated_at:new Date().toISOString()});}}return {checked,failed};
}
export async function changePrivateVip(m:Membership,action:'upgrade'|'downgrade'|'keep_vip'|'manage',origin:string,req:Request){
 if(!m.private_invite_id||!m.account_id||m.mode!==fundingMode()||!membershipAccessible(m))throw Error('Active free Standard access required');
 await reconcilePrivateVip(m);let v=await latest(m);const stripe=fundingStripe();
 if(action!=='upgrade'){
  if(!v?.subscription_id||!v.customer_id)throw Error('No VIP subscription to manage');const s=await stripe.subscriptions.retrieve(v.subscription_id);await bound(v,s);
  if(action==='manage'){const config=await stripe.billingPortal.configurations.create({business_profile:{headline:'Manage your $50/month VIP subscription'},features:{payment_method_update:{enabled:true},invoice_history:{enabled:true},subscription_cancel:{enabled:true,mode:'at_period_end',proration_behavior:'none'}}},{idempotencyKey:'icash-private-vip-portal-v1'});const portal=await stripe.billingPortal.sessions.create({customer:v.customer_id,configuration:config.id,return_url:origin+'/?settings=billing'});return {url:portal.url};}
  if(s.status==='canceled')return {saved:true,message:'VIP renewal has stopped. Your free Standard access remains.'};
  // Setting a boolean is retry-safe; canonical provider state decides the result.
  const updated=await stripe.subscriptions.update(s.id,{cancel_at_period_end:action==='downgrade',proration_behavior:'none'});await syncPrivateVip(updated);
  return {saved:true,message:action==='downgrade'?'VIP renewal cancelled. VIP continues through your paid period; free Standard access remains.':'VIP renews at $50/month.'};
 }
 v=await db<PrivateVip>('rpc/icash_begin_private_vip','POST',{p_membership:m.id,p_account:m.account_id,p_mode:m.mode});
 if(v.state!=='pending'||v.subscription_id)throw Error('A VIP subscription already exists. Open payment settings instead of paying again.');
 if(Date.now()-Date.parse(v.created_at)>23*3600_000&&!v.session_id)throw Error('An earlier checkout needs verification before another payment can open. Contact Support.');
 if(v.session_id){const s=await stripe.checkout.sessions.retrieve(v.session_id);if(s.metadata?.icash_private_vip!==v.id||ref(s.customer)!==v.customer_id||s.livemode!==(m.mode==='live'))throw Error('VIP checkout binding changed');if(s.status==='open')return {url:s.url};throw Error('Your previous checkout is being confirmed. Refresh before retrying.');}
 await recordPurchaseAcceptance(req,{kind:'vip',reference:v.id,mode:m.mode,accountId:m.account_id,guestHash:m.guest_hash,version:privateVipVersion,terms:privateVipTerms,amountCents:privateVipCents});
 const customer=await stripe.customers.create({email:m.payer_email??undefined,metadata:{icash_private_vip:v.id}},{idempotencyKey:`private-vip-customer:${v.id}`});
 if(customer.livemode!==(m.mode==='live'))throw Error('VIP customer mode mismatch');
 await db(`icash_private_vip_subscriptions?id=eq.${v.id}&state=eq.pending`,'PATCH',{customer_id:customer.id});
 const session=await stripe.checkout.sessions.create({integration_identifier:'private_vip_'+v.id.slice(0,8).replace(/[0-9]/g,c=>String.fromCharCode(97+Number(c))),mode:'subscription',customer:customer.id,automatic_tax:{enabled:false},line_items:[{price_data:{currency:'usd',unit_amount:privateVipCents,recurring:{interval:'month'},product_data:{name:'iCash X VIP',description:'VIP upgrade for free Standard members. $50 per month until cancelled.'}},quantity:1}],metadata:{icash_private_vip:v.id,icash_terms_version:privateVipVersion},subscription_data:{metadata:{icash_private_vip:v.id}},custom_text:{submit:{message:privateVipTerms}},success_url:origin+'/?settings=billing&private_vip=paid',cancel_url:origin+'/?settings=billing',expires_at:Math.floor(Date.parse(v.created_at)/1000)+3600},{idempotencyKey:`private-vip-checkout:${v.id}`});
 if(session.metadata?.icash_private_vip!==v.id||ref(session.customer)!==customer.id||session.livemode!==(m.mode==='live')||session.mode!=='subscription'||!session.url)throw Error('VIP checkout not confirmed');
 await db(`icash_private_vip_subscriptions?id=eq.${v.id}&session_id=is.null`,'PATCH',{session_id:session.id});await bindCheckoutMeasurement(req,session.id,m.mode);return {url:session.url};
}
