import {voiceReservationFailure} from './voice-budget-failure.ts';
import Stripe from "stripe";
import { createHash } from "node:crypto";
export type TestOrder = { id:string; guest_hash:string; pack_code:string; price_cents:number; credit_cents:number; stripe_session_id:string|null; state:string };
export function previewPayments() { return process.env.VERCEL_ENV === "preview"; }
export function paymentSetup() {
 return {stripe:!!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_"),database:!!process.env.SUPABASE_URL && !!process.env.SUPABASE_SECRET_KEY,webhook:!!process.env.STRIPE_WEBHOOK_SECRET};
}
export function stripeTest() {
 if(!previewPayments() || !paymentSetup().stripe) throw new Error("Test checkout unavailable");
 return new Stripe(process.env.STRIPE_SECRET_KEY!,{maxNetworkRetries:2,timeout:15000});
}
export function guestHash(token:string) { return createHash("sha256").update(token).digest("hex"); }
export async function db<T>(path:string,method="GET",body?:unknown,signal?:AbortSignal):Promise<T> {
 if(!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error("Database not configured");
 const response=await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`,{method,headers:{apikey:process.env.SUPABASE_SECRET_KEY,Authorization:`Bearer ${process.env.SUPABASE_SECRET_KEY}`,"Content-Type":"application/json",Prefer:"return=representation"},body:body===undefined?undefined:JSON.stringify(body),cache:"no-store",signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
 if(!response.ok) throw await voiceReservationFailure(path,response.status,response);
 const payload=await response.text();
 return (payload?JSON.parse(payload):null) as T;
}
export function paidSessionMatches(session:Stripe.Checkout.Session,order:TestOrder) {
 return !session.livemode && session.id.startsWith("cs_test_") && session.mode==="payment" && session.status==="complete" && session.payment_status==="paid" && session.currency==="usd" && session.amount_total===order.price_cents && session.metadata?.icash_test_order===order.id && (!order.stripe_session_id || order.stripe_session_id===session.id) && typeof session.payment_intent==="string";
}
export async function settleTestSession(session:Stripe.Checkout.Session) {
 const id=session.metadata?.icash_test_order;
 if(!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Unrecognized order");
 const orders=await db<TestOrder[]>(`icash_test_orders?id=eq.${id}&select=*`);
 const order=orders[0];
 if(!order || !paidSessionMatches(session,order)) throw new Error("Payment does not match order");
 await db("rpc/icash_settle_test_order","POST",{p_order:order.id,p_session:session.id,p_payment:session.payment_intent,p_amount:session.amount_total});
}
