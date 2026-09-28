import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db,guestHash } from "@/lib/stripe-test";
import { fundingMode,fundingEnabled,type FundingOrder } from "@/lib/funding-policy";
import { fundingStripe,settleFunding,validGuest } from "@/lib/funding";
export const dynamic="force-dynamic";
export async function GET(){
 const headers={"Cache-Control":"private, no-store"};const mode=fundingMode();
 try{
 const [pack]=await db<{price_cents:number;credit_cents:number}[]>("icash_credit_packs?code=eq.start&select=price_cents,credit_cents");
 const token=(await cookies()).get("icash_funding_guest")?.value;
 let orders:FundingOrder[]=[];
 if(mode&&validGuest(token)){
 orders=await db<FundingOrder[]>(`icash_funding_orders?guest_hash=eq.${guestHash(token)}&mode=eq.${mode}&select=*&order=created_at.desc&limit=100`);
 const pending=orders.find(o=>o.state==="pending"&&o.stripe_session_id);
 if(pending?.stripe_session_id){const s=await fundingStripe().checkout.sessions.retrieve(pending.stripe_session_id);if(s.payment_status==="paid"){await settleFunding(s);pending.state="paid";pending.payer_email=s.customer_details?.email??undefined;}}
 }
 const paid=orders.filter(o=>o.state==="paid");
 return NextResponse.json({mode,enabled:fundingEnabled(),priceCents:pack?.price_cents??null,creditCents:pack?.credit_cents??null,paidCents:paid.reduce((n,o)=>n+o.credit_cents,0),needsClaim:paid.some(o=>!o.credited_at),email:paid[0]?.payer_email??null},{headers});
 }catch{return NextResponse.json({enabled:false,error:"Could not check funding. Please retry."},{status:503,headers});}
}
