import type Stripe from 'stripe';
import {db} from '@/lib/stripe-test';
import {fundingStripe} from '@/lib/funding';
import {earlyAccessFundingEnabled,fundingEnabled,fundingMode} from '@/lib/funding-policy';
import {processingFeeCents} from '@/lib/funding-fees';
import {dailyConsent} from '@/lib/daily-consent';
export {dailyConsent,dailyConsentVersion} from '@/lib/daily-consent';
export type DailyPlan={id:string;mode:'test'|'live';guest_hash:string;account_id:string|null;stripe_subscription_id:string|null;stripe_session_id:string|null;state:string;checkout_url:string|null;created_at:string};
type Quote={id:string;plan_id:string;pack_code:string;budget_cents:number;credit_cents:number;fee_cents:number;budget_price:string;fee_price:string|null};
export function dailyReady(){return (fundingEnabled()||earlyAccessFundingEnabled())&&!!process.env.CRON_SECRET&&process.env.ICASH_DAILY_BILLING_READY==='true';}
export async function dailyQuote(p:DailyPlan,code:string,consentText:string=dailyConsent){
 const [pack]=await db<{code:string;price_cents:number;credit_cents:number}[]>(`icash_credit_packs?code=eq.${code}${p.mode==='live'?'&enabled=eq.true':''}&select=code,price_cents,credit_cents`);
 if(!pack||pack.price_cents<1000||pack.price_cents>100000)throw new Error('Budget unavailable');
 const [q]=await db<Quote[]>('icash_daily_quotes','POST',{plan_id:p.id,pack_code:code,budget_cents:pack.price_cents,credit_cents:pack.credit_cents,fee_cents:processingFeeCents(pack.price_cents),consent_text:consentText});
 const stripe=fundingStripe();
 const product=await stripe.products.create({name:'iCash X daily bot budget',metadata:{icash_daily_quote:q.id}},{idempotencyKey:`daily-product:${q.id}`});
 const base={currency:'usd',tax_behavior:'exclusive' as const,recurring:{interval:'day' as const},product:product.id};
 const budget=await stripe.prices.create({...base,unit_amount:q.budget_cents,nickname:'Bot budget'},{idempotencyKey:`daily-budget:${q.id}`});
 await db(`icash_daily_quotes?id=eq.${q.id}`,'PATCH',{budget_price:budget.id});
 return {...q,budget_price:budget.id,fee_price:null};
}
export async function stopDaily(p:DailyPlan){
 await db(`icash_daily_plans?id=eq.${p.id}`,'PATCH',{state:'stop_requested'});
 if(p.account_id)await db(`icash_accounts?id=eq.${p.account_id}`,'PATCH',{bot_paused:true});
 const stripe=fundingStripe();let subId=p.stripe_subscription_id;
 if(p.stripe_session_id){const s=await stripe.checkout.sessions.retrieve(p.stripe_session_id);if(s.status==='open')await stripe.checkout.sessions.expire(s.id);subId=subId||(typeof s.subscription==='string'?s.subscription:s.subscription?.id)||null;}
 if(subId){const sub=await stripe.subscriptions.retrieve(subId);if(sub.status!=='canceled')await stripe.subscriptions.cancel(subId,{invoice_now:false,prorate:false});
 // Cancel unpaid invoices so Stripe cannot retry them after the bot is stopped.
 const invoices=await stripe.invoices.list({subscription:subId,status:'open',limit:100});for(const i of invoices.data)await stripe.invoices.voidInvoice(i.id);
 }
 await db(`icash_daily_plans?id=eq.${p.id}`,'PATCH',{state:'stopped',stripe_subscription_id:subId});
}
export async function syncDailySubscription(sub:Stripe.Subscription){
 const id=sub.metadata.icash_daily_plan;if(!id)return;
 const [p]=await db<DailyPlan[]>(`icash_daily_plans?id=eq.${id}&select=*`);if(!p||sub.livemode!==(p.mode==='live')||(p.stripe_subscription_id&&p.stripe_subscription_id!==sub.id))throw new Error('Subscription mismatch');
 await db(`icash_daily_plans?id=eq.${p.id}`,'PATCH',{stripe_subscription_id:sub.id});
 if(p.state==='stop_requested'||p.state==='stopped'){if(sub.status!=='canceled')await stopDaily({...p,stripe_subscription_id:sub.id});return;}
 if(['canceled','unpaid','past_due','incomplete_expired','paused'].includes(sub.status)){
 if(p.account_id)await db(`icash_accounts?id=eq.${p.account_id}`,'PATCH',{bot_paused:true});
 await db(`icash_daily_plans?id=eq.${p.id}`,'PATCH',{state:sub.status==='canceled'?'stopped':'payment_failed'});
 if(sub.status!=='canceled')await stopDaily({...p,stripe_subscription_id:sub.id});
 }
}
export async function settleDailyInvoice(invoiceId:string){
 const stripe=fundingStripe();const i=await stripe.invoices.retrieve(invoiceId);
 const sid=i.parent?.subscription_details?.subscription;const subId=typeof sid==='string'?sid:sid?.id;if(!subId)return;
 const sub=await stripe.subscriptions.retrieve(subId);const planId=sub.metadata.icash_daily_plan;if(!planId)return;
 const [p]=await db<DailyPlan[]>(`icash_daily_plans?id=eq.${planId}&select=*`);if(!p||i.livemode!==(p.mode==='live')||i.livemode!==(fundingMode()==='live'))throw new Error('Invoice mode mismatch');
 await syncDailySubscription(sub);
 if(i.status!=='paid'||i.amount_remaining!==0||i.currency!=='usd')throw new Error('Invoice not ready');
 const lines=await stripe.invoices.listLineItems(i.id,{limit:10});if(lines.has_more||lines.data.length!==1)throw new Error('Unexpected invoice lines');
 const ids=lines.data.map(l=>l.pricing?.price_details?.price);if(ids.some(id=>typeof id!=='string'||!/^price_[a-zA-Z0-9]+$/.test(id)))throw new Error('Price missing');
 const qs=await db<Quote[]>(`icash_daily_quotes?plan_id=eq.${p.id}&budget_price=in.(${ids.join(',')})&select=*`);const q=qs[0];
 if(!q||qs.length!==1)throw new Error('Unauthorized prices');
 const budget=lines.data.find(l=>l.pricing?.price_details?.price===q.budget_price);
 if(!budget||q.fee_cents!==0||budget.quantity!==1||budget.amount!==q.budget_cents||i.subtotal!==q.budget_cents+q.fee_cents||(i.total_discount_amounts??[]).some(d=>d.amount!==0))throw new Error('Invoice amount mismatch');
 const tax=(i.total_taxes??[]).reduce((n,t)=>n+t.amount,0);
 if(tax!==0||i.total!==i.subtotal+tax||i.amount_paid!==i.total)throw new Error('Partial or adjusted payment');
 const payments=await stripe.invoicePayments.list({invoice:i.id,status:'paid',limit:10});if(payments.has_more||payments.data.length!==1)throw new Error('Payment requires review');
 const payment=payments.data[0].payment.payment_intent;const paymentId=typeof payment==='string'?payment:payment?.id;if(!paymentId)throw new Error('Payment missing');
 const pi=await stripe.paymentIntents.retrieve(paymentId);if(pi.status!=='succeeded'||pi.amount_received!==i.total||pi.currency!=='usd'||pi.livemode!==i.livemode)throw new Error('Payment mismatch');
 await db('rpc/icash_settle_daily_invoice','POST',{p_plan:p.id,p_quote:q.id,p_invoice:i.id,p_payment:pi.id,p_amount:i.total,p_tax:tax,p_email:i.customer_email,p_phone:i.customer_phone});
}

/** Only call with a plan resolved from the authenticated account or secure guest cookie. */
export async function reconcileDailyCheckout(p:DailyPlan){
 if(p.state!=='pending'||!p.stripe_session_id)return p;
 const stripe=fundingStripe();
 const session=await stripe.checkout.sessions.retrieve(p.stripe_session_id);
 if(session.id!==p.stripe_session_id||session.mode!=='subscription'||session.metadata?.icash_daily_plan!==p.id||session.livemode!==(p.mode==='live'))throw new Error('Checkout binding mismatch');
 if(session.status!=='complete'||session.payment_status!=='paid')return p;
 const subId=typeof session.subscription==='string'?session.subscription:session.subscription?.id;
 if(!subId||(p.stripe_subscription_id&&p.stripe_subscription_id!==subId))throw new Error('Checkout subscription mismatch');
 const sub=await stripe.subscriptions.retrieve(subId);
 if(sub.metadata.icash_daily_plan!==p.id||sub.livemode!==session.livemode)throw new Error('Checkout owner mismatch');
 await syncDailySubscription(sub);
 const invoiceId=typeof sub.latest_invoice==='string'?sub.latest_invoice:sub.latest_invoice?.id;
 if(invoiceId)await settleDailyInvoice(invoiceId);
 const [saved]=await db<DailyPlan[]>(`icash_daily_plans?id=eq.${p.id}&select=*`);
 return saved??p;
}
