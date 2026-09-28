import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db,guestHash,paymentSetup,previewPayments,settleTestSession,stripeTest,type TestOrder } from "@/lib/stripe-test";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET() {
 const headers={"Cache-Control":"no-store"};
 if(!previewPayments()) return NextResponse.json({mode:"disabled"},{headers});
 const setup=paymentSetup();
 if(!setup.stripe || !setup.database) return NextResponse.json({mode:"setup",setup},{headers});
 try {
  const token=(await cookies()).get("icash_test_guest")?.value;
  let testCreditCents=0;
  if(token && /^[a-f0-9]{64}$/.test(token)) {
   const rows=await db<TestOrder[]>(`icash_test_orders?guest_hash=eq.${guestHash(token)}&select=*&order=created_at.desc&limit=100`);
   const pending=rows.find(r=>r.state==="pending" && r.stripe_session_id);
   if(pending?.stripe_session_id) {
    const session=await stripeTest().checkout.sessions.retrieve(pending.stripe_session_id);
    if(session.payment_status==="paid") {await settleTestSession(session);pending.state="paid";}
   }
   testCreditCents=rows.filter(r=>r.state==="paid").reduce((sum,r)=>sum+r.credit_cents,0);
  }
  return NextResponse.json({mode:"test",testCreditCents,webhookConfigured:setup.webhook},{headers});
 }catch{return NextResponse.json({mode:"error",error:"Payment confirmation is temporarily unavailable."},{status:503,headers});}
}
