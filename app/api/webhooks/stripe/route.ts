import { NextResponse } from "next/server";
import { previewPayments,settleTestSession,stripeTest } from "@/lib/stripe-test";
export const runtime="nodejs";
export async function POST(req:Request) {
 if(!previewPayments() || !process.env.STRIPE_WEBHOOK_SECRET) return NextResponse.json({error:"Webhook unavailable"},{status:503});
 const stripe=stripeTest();
 let event;
 try {event=stripe.webhooks.constructEvent(await req.text(),req.headers.get("stripe-signature")??"",process.env.STRIPE_WEBHOOK_SECRET);}
 catch {return NextResponse.json({error:"Invalid signature"},{status:400});}
 if(event.livemode) return NextResponse.json({error:"Live events are not accepted"},{status:400});
 if(event.type!=="checkout.session.completed" && event.type!=="checkout.session.async_payment_succeeded") return NextResponse.json({received:true});
 const session=event.data.object;
 if(!session.metadata?.icash_test_order || session.payment_status!=="paid") return NextResponse.json({received:true});
 try {await settleTestSession(await stripe.checkout.sessions.retrieve(session.id));return NextResponse.json({received:true});}
 catch {return NextResponse.json({error:"Confirmation pending retry"},{status:500});}
}
