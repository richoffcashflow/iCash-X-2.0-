import Stripe from "stripe";
import { db,guestHash } from "@/lib/stripe-test";
import { fundingMode,fundingSessionMatches,type FundingOrder } from "@/lib/funding-policy";
export function fundingStripe() {
 if(!fundingMode())throw new Error("Payment mode unavailable");
 return new Stripe(process.env.STRIPE_SECRET_KEY!,{maxNetworkRetries:2,timeout:15000});
}
export async function settleFunding(s:Stripe.Checkout.Session) {
 const id=s.metadata?.icash_funding_order;
 if(!id || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id))throw new Error("Unrecognized order");
 const [o]=await db<FundingOrder[]>(`icash_funding_orders?id=eq.${id}&select=*`);
 if(!o || !fundingSessionMatches(s,o))throw new Error("Payment mismatch");
 await db("rpc/icash_settle_taxed_funding","POST",{p_order:o.id,p_mode:o.mode,p_session:s.id,p_payment:s.payment_intent,p_amount:s.amount_total,p_tax:s.total_details?.amount_tax??0,p_email:s.customer_details?.email,p_phone:s.customer_details?.phone??null});
}
export async function limitRequest(req:Request,scope:string,identifier:string,limit:number,seconds:number) {
 // Vercel overwrites this trusted proxy header; a missing address shares a restrictive bucket.
 const ip=req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()||"unknown";
 for(const key of [`${scope}:ip:${guestHash(ip)}`,`${scope}:id:${guestHash(identifier)}`]) {
  if(!await db<boolean>("rpc/icash_take_request","POST",{p_bucket:key,p_limit:limit,p_seconds:seconds}))throw new Error("Too many attempts. Please wait and try again.");
 }
}
export function validGuest(value?:string):value is string{return !!value && /^[a-f0-9]{64}$/.test(value);}
