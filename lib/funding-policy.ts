import type Stripe from "stripe";
export type FundingMode = "test" | "live";
export type FundingOrder = { id:string; mode:FundingMode; guest_hash:string; account_id:string|null; pack_code:string; price_cents:number; processing_fee_cents?:number; tax_required?:boolean; credit_cents:number; stripe_session_id:string|null; state:string; payer_email?:string; credited_at?:string|null };
export function fundingMode(env:NodeJS.ProcessEnv=process.env):FundingMode|null {
 if(env.VERCEL_ENV==="preview" && env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) return "test";
 if(env.VERCEL_ENV==="production" && env.STRIPE_SECRET_KEY?.startsWith("sk_live_")) return "live";
 return null;
}
export function fundingEnabled(env:NodeJS.ProcessEnv=process.env) {
 const mode=fundingMode(env);
 return !!mode && !!env.SUPABASE_URL && !!env.SUPABASE_SECRET_KEY && !!env.STRIPE_WEBHOOK_SECRET && env.ICASH_AUTH_EMAIL_READY==="true" &&
 (mode==="test" || (env.ICASH_LIVE_PAYMENTS_ENABLED==="true" && env.ICASH_LIVE_WORK_READY==="true"));
}
export function fundingSessionMatches(s:Stripe.Checkout.Session,o:FundingOrder) {
 const tax=s.total_details?.amount_tax??0;
 const amounts=o.tax_required? s.automatic_tax?.enabled===true&&s.automatic_tax.status==="complete"&&Number.isSafeInteger(tax)&&tax>=0&&s.amount_subtotal===o.price_cents&&(s.total_details?.amount_discount??0)===0&&(s.total_details?.amount_shipping??0)===0&&s.amount_total===o.price_cents+tax : s.amount_total===o.price_cents;
 return s.livemode===(o.mode==="live") && s.id.startsWith(o.mode==="live"?"cs_live_":"cs_test_") &&
 s.mode==="payment" && s.status==="complete" && s.payment_status==="paid" && s.currency==="usd" &&
 amounts && s.metadata?.icash_funding_order===o.id &&
 (!o.stripe_session_id || o.stripe_session_id===s.id) && typeof s.payment_intent==="string" &&
 !!s.customer_details?.email;
}
export function normalizeEmail(value:unknown) {
 if(typeof value!=="string") return null;
 const email=value.trim().toLowerCase();
 return email.length<=320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null;
}
export function allowedOrigin(req:Request,env:NodeJS.ProcessEnv=process.env) {
 const allowed=[env.VERCEL_URL,env.VERCEL_BRANCH_URL,env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).map(h=>`https://${h}`);
 if(env.ICASH_APP_ORIGIN) {try {const u=new URL(env.ICASH_APP_ORIGIN);if(u.protocol==="https:")allowed.push(u.origin);}catch{/* Fail closed. */}}
 return !!req.headers.get("origin") && allowed.includes(req.headers.get("origin")!);
}
