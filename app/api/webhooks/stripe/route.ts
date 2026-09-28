import { NextResponse } from "next/server";
import { db,settleTestSession } from "@/lib/stripe-test";
import { fundingMode } from "@/lib/funding-policy";
import { fundingStripe,settleFunding } from "@/lib/funding";
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
   if(s.metadata?.icash_funding_order)await settleFunding(await stripe.checkout.sessions.retrieve(s.id));
   else if(mode==="test"&&s.metadata?.icash_test_order)await settleTestSession(await stripe.checkout.sessions.retrieve(s.id));
  }
 }else if(event.type==="charge.refunded"||event.type==="charge.dispute.created"){
  const obj=event.data.object;const payment=typeof obj.payment_intent==="string"?obj.payment_intent:obj.payment_intent?.id;
  if(payment)await db("rpc/icash_flag_billing_issue","POST",{p_event:event.id,p_payment:payment,p_reason:event.type});
 }
 return NextResponse.json({received:true});
 }catch{return NextResponse.json({error:"Confirmation pending retry"},{status:500});}
}
