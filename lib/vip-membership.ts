import {recordPurchaseAcceptance} from '@/lib/purchase-acceptance';
import {vipTermsVersion,vipPurchaseTerms,vipRetentionVersion,vipRetentionTerms,vipRetentionCents} from './vip-policy.ts';
import type Stripe from 'stripe';
import {db} from '@/lib/stripe-test';
import {fundingStripe} from '@/lib/funding';
import {fundingMode} from '@/lib/funding-policy';
import {vipActive,vipUpgradeCents} from '@/lib/vip-policy';
import {checkoutPublishableKey,checkoutMatchesPresentation} from '@/lib/embedded-checkout-policy';
import type {Membership} from '@/lib/membership';
export type PlanChange={id:string;membership_id:string;account_id:string;action:'upgrade'|'downgrade'|'keep_vip'|'retain_vip';state:string;period_end:string;from_price:number;to_price:number;session_id:string|null;payment_id:string|null;price_id:string|null};
const ref=(v:string|{id:string}|null|undefined)=>typeof v==='string'?v:v?.id;
async function membership(id:string){const [m]=await db<Membership[]>(`icash_memberships?id=eq.${id}&select=*`);if(!m)throw Error('Subscription unavailable');return m;}
function boundSubscription(m:Membership,s:Stripe.Subscription,change?:PlanChange){
 const i=s.items.data[0];
 if(m.mode!==fundingMode()||s.livemode!==(m.mode==='live')||s.id!==m.stripe_subscription_id||s.metadata.icash_membership!==m.id||ref(s.customer)!==m.stripe_customer_id||s.items.has_more||s.items.data.length!==1||i.quantity!==1||i.price.currency!=='usd'||i.price.recurring?.interval!=='month'||i.price.recurring.interval_count!==1||![m.price_cents,change?.to_price].includes(i.price.unit_amount??-1))throw Error('Subscription binding changed');
 return i;
}
/** Called by the canonical subscription reader during a payment webhook race. */
export async function authorizedPlanPrice(m:Membership,s:Stripe.Subscription){
 const [c]=await db<PlanChange[]>(`icash_plan_changes?membership_id=eq.${m.id}&state=in.(pending,paid)&select=*&limit=1`);
 return !!c&&(c.action!=='upgrade'||c.state==='paid')&&c.price_id===s.items.data[0]?.price.id&&c.to_price===s.items.data[0]?.price.unit_amount;
}
export async function vipRetentionOffer(m:Membership|null){
 if(!m?.account_id||m.state!=='active'||!(Date.parse(m.paid_through??'')>Date.now()+3600_000)||m.cancel_at_period_end||!m.stripe_subscription_id||m.vip_retained_at||![5000,10000].includes(m.price_cents))return null;
 const [pending]=await db<PlanChange[]>(`icash_plan_changes?membership_id=eq.${m.id}&state=in.(pending,paid)&select=*&limit=1`);
 if(pending&&pending.action!=='retain_vip')return null;
 return {eligible:true,retryable:!!pending,priceCents:vipRetentionCents,version:vipRetentionVersion,plan:'vip' as const};
}
async function applyChange(c:PlanChange){
 if(c.state==='applied')return;
 const m=await membership(c.membership_id),stripe=fundingStripe();
 if(m.state!=='active'||m.cancel_at_period_end||!(Date.parse(m.paid_through??'')>Date.now())||c.action==='upgrade'&&c.state!=='paid')throw Error('Plan change is awaiting payment or subscription access');
 if(c.action==='retain_vip'){
  const [receipt]=await db<{terms_text:string;amount_cents:number}[]>(`icash_purchase_acceptances?kind=eq.vip&reference_id=eq.${c.id}&account_id=eq.${m.account_id}&mode=eq.${m.mode}&version=eq.${vipRetentionVersion}&select=terms_text,amount_cents&limit=1`);
  if(!receipt||receipt.terms_text!==vipRetentionTerms||receipt.amount_cents!==vipRetentionCents)throw Error('Review and accept the VIP retention offer first');
 }
 const s=await stripe.subscriptions.retrieve(m.stripe_subscription_id!),item=boundSubscription(m,s,c);
 if(s.status!=='active'||s.cancel_at_period_end||s.pending_update||s.schedule)throw Error('Resolve the pending subscription change first');
 if(Date.parse(c.period_end)!==item.current_period_end*1000)throw Error('Renewal occurred during the change; payment requires review');
 // Ordinary plan changes preserve discounts. The explicitly accepted retention
 // plan replaces them with the fixed $50 monthly price.
 const product=ref(item.price.product);if(!product)throw Error('Subscription product unavailable');
 let priceId=c.price_id;
 if(!priceId){const price=await stripe.prices.create({currency:'usd',unit_amount:c.to_price,recurring:{interval:'month'},product,metadata:{icash_plan_change:c.id}},{idempotencyKey:`vip-price:${c.id}`});priceId=price.id;await db(`icash_plan_changes?id=eq.${c.id}`,'PATCH',{price_id:priceId});}
 const changed=await stripe.subscriptions.update(s.id,{items:[{id:item.id,price:priceId,quantity:1}],proration_behavior:'none',payment_behavior:'error_if_incomplete',...(c.action==='retain_vip'?{discounts:'' as const}:{})},{idempotencyKey:`vip-apply:${c.id}`});
 const next=changed.items.data[0];
 if(c.action==='retain_vip'&&(changed.discounts?.length??0)!==0)throw Error('Retained VIP price not confirmed');
 if(changed.status!=='active'||changed.cancel_at_period_end||changed.items.has_more||next.quantity!==1||next.price.currency!=='usd'||next.price.recurring?.interval!=='month'||next.price.recurring.interval_count!==1||next.price.id!==priceId||next.price.unit_amount!==c.to_price||next.current_period_end!==item.current_period_end||changed.items.data.length!==1)throw Error('Plan update not confirmed');
 await db('rpc/icash_apply_plan_change','POST',{p_change:c.id,p_subscription:changed.id,p_price:priceId});
}
export async function reconcileVipCheckout(sessionId:string){
 if(!/^cs_(live|test)_[A-Za-z0-9]+$/.test(sessionId))throw Error('Invalid upgrade checkout');
 const stripe=fundingStripe(),s=await stripe.checkout.sessions.retrieve(sessionId),id=s.metadata?.icash_vip_change;
 if(!id||!/^[0-9a-f-]{36}$/i.test(id))throw Error('Upgrade binding missing');
 const [c]=await db<PlanChange[]>(`icash_plan_changes?id=eq.${id}&select=*`);if(!c)throw Error('Upgrade missing');
 const m=await membership(c.membership_id);
 if(c.action!=='upgrade'||s.id!==c.session_id||s.mode!=='payment'||s.livemode!==(m.mode==='live')||m.mode!==fundingMode()||ref(s.customer)!==m.stripe_customer_id||s.currency!=='usd'||s.amount_total!==vipUpgradeCents||s.amount_subtotal!==vipUpgradeCents||(s.total_details?.amount_discount??0)!==0||(s.total_details?.amount_tax??0)!==0)throw Error('Upgrade checkout mismatch');
 if(s.status==='expired'){await db(`icash_plan_changes?id=eq.${c.id}&state=eq.pending`,'PATCH',{state:'expired'});return false;}
 if(s.status!=='complete'||s.payment_status!=='paid')return false;
 const payment=ref(s.payment_intent);if(!payment)throw Error('Upgrade payment missing');
 const pi=await stripe.paymentIntents.retrieve(payment);
 if(pi.status!=='succeeded'||pi.amount_received!==vipUpgradeCents||pi.currency!=='usd'||pi.livemode!==s.livemode||ref(pi.customer)!==m.stripe_customer_id)throw Error('Upgrade payment mismatch');
 if(c.state==='applied')return true;
 await db('rpc/icash_mark_plan_change_paid','POST',{p_change:c.id,p_session:s.id,p_payment:pi.id});
 await applyChange({...c,state:'paid',payment_id:pi.id});return true;
}
export async function reconcileVipChanges(membershipId:string){
 const rows=await db<PlanChange[]>(`icash_plan_changes?membership_id=eq.${membershipId}&state=in.(pending,paid)&select=*&limit=1`);
 for(const c of rows){if(c.action==='upgrade'){if(c.session_id)await reconcileVipCheckout(c.session_id);else if(c.state==='pending'&&Date.parse(c.period_end)<=Date.now())await db(`icash_plan_changes?id=eq.${c.id}&state=eq.pending`,'PATCH',{state:'expired'});}else await applyChange(c);}
}
export async function changeVipPlan(m:Membership,action:PlanChange['action'],origin:string,options:{webinar?:boolean;embedded?:boolean;request?:Request}={}){
 if(!m.account_id||!m.stripe_subscription_id||!m.stripe_customer_id)throw Error('Active subscription required');
 // A previous acceptance write may have failed. An explicit retry records it
 // before applying; background reconciliation still requires its saved receipt.
 if(action!=='retain_vip')await reconcileVipChanges(m.id);m=await membership(m.id);
 if(action==='upgrade'&&vipActive(m))throw Error('VIP is already active. Refresh your plan.');
 const [pending]=action==='retain_vip'?await db<PlanChange[]>(`icash_plan_changes?membership_id=eq.${m.id}&state=in.(pending,paid)&select=*&limit=1`):[];
 const stripe=fundingStripe(),s=await stripe.subscriptions.retrieve(m.stripe_subscription_id!),item=boundSubscription(m,s,pending?.action==='retain_vip'?pending:undefined);
 if(s.status!=='active'||s.cancel_at_period_end||s.pending_update||s.schedule)throw Error('Resolve the pending subscription change first');
 if(m.state!=='active'||m.cancel_at_period_end||!(Date.parse(m.paid_through??'')>Date.now()))throw Error('Active subscription required');
 if(action==='retain_vip'&&m.vip_retained_at&&m.price_cents===vipRetentionCents)return {saved:true,message:'VIP is already active at $50/month. No charge today.'};
 if((action==='upgrade'||action==='retain_vip')&&item.current_period_end*1000-Date.now()<3600_000)throw Error('Your renewal is within an hour. Refresh after renewal to review this offer.');
 const c=await db<PlanChange>('rpc/icash_begin_plan_change','POST',{p_membership:m.id,p_account:m.account_id,p_action:action,p_period_end:new Date(item.current_period_end*1000).toISOString()});
 if(action==='retain_vip'){
  if(!options.request)throw Error('Review the VIP retention terms first');
  await recordPurchaseAcceptance(options.request,{kind:'vip',reference:c.id,mode:m.mode,accountId:m.account_id,guestHash:m.guest_hash,version:vipRetentionVersion,terms:vipRetentionTerms,amountCents:vipRetentionCents});
  await applyChange(c);
  return {saved:true,message:'VIP is active. Your subscription renews at $50/month on your existing date. No charge today.'};
 }
 if(action!=='upgrade'){await applyChange(c);return {saved:true,message:action==='downgrade'?'Downgrade saved. VIP continues through your paid period.':'VIP renewal restored. No charge today.'};}
 const publishableKey=checkoutPublishableKey(m.mode),embedded=options.embedded===true&&!!publishableKey;
 const response=(session:Stripe.Checkout.Session)=>session.ui_mode==='embedded_page'?{clientSecret:session.client_secret,publishableKey,sessionId:session.id}:{url:session.url,sessionId:session.id};
 if(!options.request)throw Error('Review the current VIP terms before payment');
 if(c.session_id){const old=await stripe.checkout.sessions.retrieve(c.session_id);if(old.metadata?.icash_vip_change!==c.id||old.livemode!==(m.mode==='live')||ref(old.customer)!==m.stripe_customer_id)throw Error('Upgrade checkout binding changed');if(old.status==='open'){if(checkoutMatchesPresentation(old,embedded)&&old.metadata?.icash_terms_version===vipTermsVersion)return response(old);await stripe.checkout.sessions.expire(old.id);}if(old.status==='complete')throw Error('Your upgrade payment is being confirmed. Do not pay again.');}
 await recordPurchaseAcceptance(options.request,{kind:'vip',reference:c.id,mode:m.mode,accountId:m.account_id,guestHash:m.guest_hash,version:vipTermsVersion,terms:vipPurchaseTerms,amountCents:vipUpgradeCents});
 const checkout=await stripe.checkout.sessions.create({mode:'payment',customer:m.stripe_customer_id!,payment_method_types:['card'],automatic_tax:{enabled:false},line_items:[{price_data:{currency:'usd',unit_amount:vipUpgradeCents,product_data:{name:'iCash X VIP upgrade',description:'$50 upgrade for your current billing period. VIP renews at $100/month before any existing subscription discount. Work credits separate.'}},quantity:1}],metadata:{icash_vip_change:c.id,icash_terms_version:vipTermsVersion},custom_text:{submit:{message:vipPurchaseTerms}},...(embedded?{ui_mode:'embedded_page' as const,redirect_on_completion:'never' as const}:{success_url:origin+(options.webinar?'/webinar/upgrade?upgrade=paid&vip_session={CHECKOUT_SESSION_ID}':'/?settings=billing&vip_session={CHECKOUT_SESSION_ID}'),cancel_url:origin+(options.webinar?'/webinar/upgrade':'/?settings=billing')}),expires_at:Math.min(Math.floor(Date.now()/1000)+3600,item.current_period_end-60)},{idempotencyKey:`vip-checkout:${c.id}:${vipTermsVersion}:${c.session_id??'first'}`});
 if(checkout.metadata?.icash_vip_change!==c.id||checkout.livemode!==(m.mode==='live')||ref(checkout.customer)!==m.stripe_customer_id||!checkoutMatchesPresentation(checkout,embedded))throw Error('Upgrade checkout could not be verified');
 await db(`icash_plan_changes?id=eq.${c.id}&state=eq.pending`,'PATCH',{session_id:checkout.id});return response(checkout);
}
