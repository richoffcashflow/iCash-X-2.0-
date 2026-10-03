import { NextResponse } from "next/server";
import { db,settleTestSession } from "@/lib/stripe-test";
import { fundingMode } from "@/lib/funding-policy";
import { fundingStripe,settleFunding } from "@/lib/funding";
import {syncDailySubscription,settleDailyInvoice,stopDaily,type DailyPlan} from '@/lib/daily-billing';
import {syncMembershipSubscription,settleMembershipInvoice,reconcileMembershipSession} from '@/lib/membership';
export const runtime="nodejs";
export async function POST(req:Request) {
 const mode=fundingMode();
 if(!mode||!process.env.STRIPE_WEBHOOK_SECRET)return NextResponse.json({error:"Webhook unavailable"},{status:503});
 const stripe=fundingStripe();let event;
 try{event=stripe.webhooks.constructEvent(await req.text(),req.headers.get("stripe-signature")??"",process.env.STRIPE_WEBHOOK_SECRET);}
 catch{return NextResponse.json({error:"Invalid signature"},{status:400});}
 if(event.livemode!==(mode==="live"))return NextResponse.json({error:"Payment mode mismatch"},{status:400});
 try{
 if(event.type==="checkout.session.completed"||event.type==="checkout.session.async_payment_succeeded"){
  const s=event.data.object;
  if(s.payment_status==="paid"){
   if(s.metadata?.icash_membership)await reconcileMembershipSession(s.id);
   else if(s.metadata?.icash_daily_plan){const subId=typeof s.subscription==='string'?s.subscription:s.subscription?.id;if(!subId)throw new Error();const sub=await stripe.subscriptions.retrieve(subId);await syncDailySubscription(sub);const invoiceId=typeof sub.latest_invoice==='string'?sub.latest_invoice:sub.latest_invoice?.id;if(invoiceId)await settleDailyInvoice(invoiceId);}
   else if(s.metadata?.icash_funding_order)await settleFunding(await stripe.checkout.sessions.retrieve(s.id));
   else if(mode==="test"&&s.metadata?.icash_test_order)await settleTestSession(await stripe.checkout.sessions.retrieve(s.id));
  }
 }else if(event.type==="invoice.paid"){if(!await settleMembershipInvoice(event.data.object.id))await settleDailyInvoice(event.data.object.id);
 }else if(event.type==="invoice.payment_failed"||event.type==="invoice.payment_action_required"){const sid=event.data.object.parent?.subscription_details?.subscription;const id=typeof sid==='string'?sid:sid?.id;if(id){const sub=await stripe.subscriptions.retrieve(id);if(!await syncMembershipSubscription(sub))await syncDailySubscription(sub);}
 }else if(event.type==="customer.subscription.updated"||event.type==="customer.subscription.deleted"){const sub=await stripe.subscriptions.retrieve(event.data.object.id);if(!await syncMembershipSubscription(sub))await syncDailySubscription(sub);
 }else if(event.type==="charge.refunded"||event.type==="charge.dispute.created"){
  const obj=event.data.object;const payment=typeof obj.payment_intent==="string"?obj.payment_intent:obj.payment_intent?.id;
  if(payment){await db("rpc/icash_flag_billing_issue","POST",{p_event:event.id,p_payment:payment,p_reason:event.type});await db('rpc/icash_flag_membership_issue','POST',{p_payment:payment});const [o]=await db<{daily_plan_id:string|null}[]>(`icash_funding_orders?stripe_payment_id=eq.${payment}&select=daily_plan_id`);if(o?.daily_plan_id){const [p]=await db<DailyPlan[]>(`icash_daily_plans?id=eq.${o.daily_plan_id}&select=*`);if(p)await stopDaily(p);}}
 }
 return NextResponse.json({received:true});
 }catch{return NextResponse.json({error:"Confirmation pending retry"},{status:500});}
}
