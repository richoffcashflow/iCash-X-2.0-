import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { db,guestHash,paymentSetup,previewPayments,stripeTest,type TestOrder } from "@/lib/stripe-test";
export const runtime="nodejs";
export async function POST(req:Request) {
 if(!previewPayments()) return NextResponse.json({error:"Live payments are not enabled."},{status:403});
 const expectedOrigin=process.env.VERCEL_URL?`https://${process.env.VERCEL_URL}`:new URL(req.url).origin;
 if(req.headers.get("origin")!==expectedOrigin) return NextResponse.json({error:"Open this deployment directly to test checkout."},{status:403});
 const setup=paymentSetup();
 if(!setup.stripe||!setup.database) return NextResponse.json({error:"Test payment setup is incomplete."},{status:503});
 const jar=await cookies();
 let token=jar.get("icash_test_guest")?.value;
 if(!token || !/^[a-f0-9]{64}$/.test(token)) {token=randomBytes(32).toString("hex");jar.set("icash_test_guest",token,{httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:86400});}
 const hash=guestHash(token);
 try {
  const previous=await db<TestOrder[]>(`icash_test_orders?guest_hash=eq.${hash}&state=eq.pending&order=created_at.desc&limit=1`);
  let order=previous[0];
  const stripe=stripeTest();
  if(order?.stripe_session_id) {
   const session=await stripe.checkout.sessions.retrieve(order.stripe_session_id);
   if(session.status==="open" && session.url) return NextResponse.json({url:session.url});
   if(session.status==="complete") return NextResponse.json({error:"Your payment is being confirmed. Refresh this page."},{status:409});
   order=undefined as unknown as TestOrder;
  }
  if(!order) {
   const packs=await db<{code:string;price_cents:number;credit_cents:number}[]>("icash_credit_packs?code=eq.start&select=code,price_cents,credit_cents");
   if(!packs[0]) throw new Error("Pack missing");
   const pack=packs[0];
   const rows=await db<TestOrder[]>("icash_test_orders","POST",{guest_hash:hash,pack_code:pack.code,price_cents:pack.price_cents,credit_cents:pack.credit_cents});order=rows[0];
  }
  const session=await stripe.checkout.sessions.create({mode:"payment",payment_method_types:["card"],line_items:[{price_data:{currency:"usd",unit_amount:order.price_cents,product_data:{name:"iCash X — TEST credits",description:"Sandbox only. No real bot credits or acquisition work."}},quantity:1}],metadata:{icash_test_order:order.id},success_url:`${expectedOrigin}/?payment=test-return`,cancel_url:`${expectedOrigin}/?payment=test-canceled`},{idempotencyKey:`icash-test:${order.id}`});
  if(session.livemode || !session.url) throw new Error("Invalid session");
  await db(`icash_test_orders?id=eq.${order.id}`,"PATCH",{stripe_session_id:session.id});
  return NextResponse.json({url:session.url});
 } catch {return NextResponse.json({error:"Could not start test checkout. Please try again."},{status:503});}
}
