import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db,guestHash } from "@/lib/stripe-test";
import { fundingMode,fundingEnabled,type FundingOrder } from "@/lib/funding-policy";
import { fundingStripe,settleFunding,validGuest } from "@/lib/funding";
export const dynamic="force-dynamic";
export async function GET(){
 const headers={"Cache-Control":"private, no-store"};const mode=fundingMode();
 try{
 const packs=await db<{code:string;price_cents:number;credit_cents:number;enabled:boolean}[]>("icash_credit_packs?price_cents=gte.2000&select=code,price_cents,credit_cents,enabled&order=price_cents&limit=10");
 const pack=packs.find(p=>p.code==="start");
 const [planning]=await db("icash_planning_estimates?id=eq.1&select=lookup_cents,voice_minute_cents,lookup_share_percent,call_minutes_low,call_minutes_high") as import("@/lib/funding-forecast").PlanningPrices[];
 const token=(await cookies()).get("icash_funding_guest")?.value;
 let orders:FundingOrder[]=[];
 if(mode&&validGuest(token)){
 orders=await db<FundingOrder[]>(`icash_funding_orders?guest_hash=eq.${guestHash(token)}&mode=eq.${mode}&select=*&order=created_at.desc&limit=100`);
 const pending=orders.find(o=>o.state==="pending"&&o.stripe_session_id);
 if(pending?.stripe_session_id){const s=await fundingStripe().checkout.sessions.retrieve(pending.stripe_session_id);if(s.payment_status==="paid"){await settleFunding(s);pending.state="paid";pending.payer_email=s.customer_details?.email??undefined;}}
 }
 const paid=orders.filter(o=>o.state==="paid");
 return NextResponse.json({mode,enabled:fundingEnabled(),packs,planning,forecast:{cycleChargeCents:null,qualified:null},priceCents:pack?.price_cents??null,creditCents:pack?.credit_cents??null,paidCents:paid.reduce((n,o)=>n+o.credit_cents,0),needsClaim:paid.some(o=>!o.credited_at),email:paid[0]?.payer_email??null},{headers});
 }catch{return NextResponse.json({enabled:false,error:"Could not check funding. Please retry."},{status:503,headers});}
}
