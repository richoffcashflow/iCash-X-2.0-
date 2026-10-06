import {customerFundingReady} from '@/lib/launch-readiness';
import type Stripe from 'stripe';
import {db} from '@/lib/stripe-test';
import {fundingStripe} from '@/lib/funding';
import {fundingMode} from '@/lib/funding-policy';
type Attempt={id:string;account_id:string;mode:'live'|'test';order_id:string;approved_order:string;amount_cents:number;stripe_customer_id:string;stripe_payment_method_id:string;stripe_payment_id:string|null;created_at:string;state:string};
const id=(value:string|{id:string}|null)=>typeof value==='string'?value:value?.id;
export async function activateAutoRecharge(session:Stripe.Checkout.Session){
 if(session.metadata?.icash_auto_recharge!=='true')return;
 const pi=await fundingStripe().paymentIntents.retrieve(id(session.payment_intent)!);
 if(pi.status!=='succeeded'||pi.setup_future_usage!=='off_session'||id(pi.customer)!==id(session.customer)||!id(pi.payment_method))throw Error('Recharge setup not confirmed');
 await db('rpc/icash_activate_auto_recharge','POST',{p_order:session.metadata.icash_funding_order,p_customer:id(pi.customer),p_method:id(pi.payment_method)});
}
export async function settleAutoRecharge(pi:Stripe.PaymentIntent){
 const attemptId=pi.metadata?.icash_auto_recharge_attempt;if(!attemptId)return false;
 const [t]=await db<Attempt[]>(`icash_auto_recharge_attempts?id=eq.${attemptId}&select=*`);
 if(!t||pi.status!=='succeeded'||pi.currency!=='usd'||pi.amount!==t.amount_cents||pi.amount_received!==t.amount_cents||pi.livemode!==(t.mode==='live')||id(pi.customer)!==t.stripe_customer_id||id(pi.payment_method)!==t.stripe_payment_method_id||pi.metadata.icash_funding_order!==t.order_id)throw Error('Recharge payment mismatch');
 await db('rpc/icash_settle_auto_recharge','POST',{p_attempt:t.id,p_payment:pi.id,p_amount:pi.amount_received,p_customer:id(pi.customer),p_method:id(pi.payment_method),p_mode:t.mode});return true;
}
async function stopAttempt(t:Attempt,state:'failed'|'cancelled',issue?:string){
 await db(`icash_auto_recharge_attempts?id=eq.${t.id}&state=eq.pending`,'PATCH',{state,lease_until:null});
 await db(`icash_funding_orders?id=eq.${t.order_id}&state=eq.pending`,'PATCH',{state:'expired'});
 if(issue)await db(`icash_auto_recharges?account_id=eq.${t.account_id}&mode=eq.${t.mode}&approved_order=eq.${t.approved_order}`,'PATCH',{enabled:false,pending_order:null,issue,updated_at:new Date().toISOString()});
}
export async function reconcileAutoRecharge(deadline:number){
 const mode=fundingMode();if(mode!=='live')return {checked:0,failed:0};
 const candidates=await db<{account_id:string}[]>('rpc/icash_due_auto_recharges','POST',{p_mode:mode});
 let checked=0,failed=0;
 for(const account of new Set(candidates.map(r=>r.account_id))){
  if(Date.now()>=deadline)break;
  const t=await db<Attempt|null>('rpc/icash_claim_auto_recharge','POST',{p_account:account,p_mode:mode});if(!t)continue;checked++;
  try{
   const stripe=fundingStripe();let pi:Stripe.PaymentIntent;
   if(t.stripe_payment_id)pi=await stripe.paymentIntents.retrieve(t.stripe_payment_id);
   else{
    // Do not replay an unrecorded create after Stripe's idempotency retention.
    if(Date.now()-Date.parse(t.created_at)>23*3600_000){await stopAttempt(t,'failed','Please add money to restart auto recharge.');continue;}
    if(!await customerFundingReady()||!await db<boolean>('rpc/icash_auto_recharge_allowed','POST',{p_attempt:t.id})){await stopAttempt(t,'cancelled');continue;}
    pi=await stripe.paymentIntents.create({amount:t.amount_cents,currency:'usd',customer:t.stripe_customer_id,payment_method:t.stripe_payment_method_id,payment_method_types:['card'],metadata:{icash_auto_recharge_attempt:t.id,icash_funding_order:t.order_id},description:'iCash X auto recharge'},{idempotencyKey:`icash-auto-create:${t.id}`});
    await db(`icash_auto_recharge_attempts?id=eq.${t.id}`,'PATCH',{stripe_payment_id:pi.id});
   }
   if(pi.status==='requires_confirmation'){
    if(!await customerFundingReady()||!await db<boolean>('rpc/icash_auto_recharge_allowed','POST',{p_attempt:t.id})){await stripe.paymentIntents.cancel(pi.id);await stopAttempt(t,'cancelled');continue;}
    try{pi=await stripe.paymentIntents.confirm(pi.id,{off_session:true},{idempotencyKey:`icash-auto-confirm:${t.id}`});}
    catch{pi=await stripe.paymentIntents.retrieve(pi.id);}
   }
   if(pi.status==='succeeded')await settleAutoRecharge(pi);
   else if(['requires_payment_method','requires_action','canceled'].includes(pi.status)){
    if(pi.status!=='canceled')await stripe.paymentIntents.cancel(pi.id);
    await stopAttempt(t,'failed','Auto recharge needs a payment update. Add money to continue.');
   }
  }catch{failed++;/* Preserve the same attempt and PaymentIntent for recovery. */}
 }
 return {checked,failed};
}
