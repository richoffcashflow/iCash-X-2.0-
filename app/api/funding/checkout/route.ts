import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { currentUser } from "@/lib/account-auth";
import { db,guestHash } from "@/lib/stripe-test";
import { allowedOrigin,fundingEnabled,fundingMode,type FundingOrder } from "@/lib/funding-policy";
import { fundingStripe,limitRequest,settleFunding,validGuest } from "@/lib/funding";
import {acceptedFundingTerms,fundingTermsVersion,fundingTermsText} from "@/lib/funding-consent";
export const runtime="nodejs";
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:"Open iCash X directly and try again."},{status:403});
 if(!fundingEnabled())return NextResponse.json({error:"Funding is not open yet."},{status:503});
 let consent;try{const raw=await req.text();if(raw.length>512)throw new Error();consent=JSON.parse(raw);}catch{return NextResponse.json({error:"Accept the purchase terms to continue."},{status:400});}
 if(!acceptedFundingTerms(consent))return NextResponse.json({error:"Accept the current purchase terms to continue."},{status:400});
 const choice=consent as {packCode?:unknown;days?:unknown};
 const packCode=typeof choice.packCode==="string"&&/^[a-z_]{1,30}$/.test(choice.packCode)?choice.packCode:"start";
 const runDays=typeof choice.days==="number"?choice.days:7;
 if(!Number.isInteger(runDays)||runDays<1||runDays>30)return NextResponse.json({error:"Choose 1–30 days."},{status:400});
 const mode=fundingMode()!;const origin=req.headers.get("origin")!;
 const jar=await cookies();let token=jar.get("icash_funding_guest")?.value;
 if(!validGuest(token)){token=randomBytes(32).toString("hex");jar.set("icash_funding_guest",token,{httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:86400*30});}
 try{
 await limitRequest(req,"checkout",token,10,600);
 const user=await currentUser();
 const accounts=user?await db<{id:string}[]>(`icash_accounts?owner_user_id=eq.${user.id}&select=id&limit=1`):[];
 const accountId=accounts[0]?.id??null;const hash=guestHash(token);
 const stripe=fundingStripe();
 const old=await db<FundingOrder[]>(`icash_funding_orders?guest_hash=eq.${hash}&mode=eq.${mode}&state=eq.pending&order=created_at.desc&limit=1`);
 let order:FundingOrder|undefined=old[0];
 if(order && order.account_id!==accountId)return NextResponse.json({error:"Finish or cancel the checkout already open in this browser before switching accounts."},{status:409});
 if(order&&!order.stripe_session_id&&(order.pack_code!==packCode||(order as FundingOrder & {run_days?:number}).run_days!==runDays)){await db(`icash_funding_orders?id=eq.${order.id}`,"PATCH",{state:"expired"});order=undefined;}
 if(order?.stripe_session_id&& (order.pack_code!==packCode||(order as FundingOrder & {run_days?:number}).run_days!==runDays)){const previous=await stripe.checkout.sessions.retrieve(order.stripe_session_id);if(previous.payment_status==="paid"){await settleFunding(previous);return NextResponse.json({error:"Payment received. Refresh your balance."},{status:409});}if(previous.status==="open")await stripe.checkout.sessions.expire(previous.id);await db(`icash_funding_orders?id=eq.${order.id}`,"PATCH",{state:"expired"});order=undefined;}
 if(order?.stripe_session_id){const s=await stripe.checkout.sessions.retrieve(order.stripe_session_id);
 if(s.status==="open"&&s.url){await db("rpc/icash_record_funding_consent","POST",{p_order:order.id,p_version:fundingTermsVersion,p_terms:fundingTermsText,p_guest:hash,p_agent_hash:guestHash(req.headers.get("user-agent")||"unknown")});return NextResponse.json({url:s.url});}
 if(s.payment_status==="paid"){await settleFunding(s);return NextResponse.json({error:"Payment received. Check your balance before adding more."},{status:409});}
 if(s.status!=="expired")return NextResponse.json({error:"Your previous payment is still being confirmed."},{status:409});
 await db(`icash_funding_orders?id=eq.${order.id}`,"PATCH",{state:"expired"});order=undefined;
 }
 if(!order){const [pack]=await db<{code:string;price_cents:number;credit_cents:number}[]>(`icash_credit_packs?code=eq.${packCode}${mode==="live"?"&enabled=eq.true":""}&select=code,price_cents,credit_cents`);
 if(!pack||pack.price_cents<2000)throw new Error("No enabled pack");
 [order]=await db<FundingOrder[]>("icash_funding_orders","POST",{mode,guest_hash:hash,account_id:accountId,pack_code:pack.code,price_cents:pack.price_cents,credit_cents:pack.credit_cents,run_days:runDays});}
 await db("rpc/icash_record_funding_consent","POST",{p_order:order.id,p_version:fundingTermsVersion,p_terms:fundingTermsText,p_guest:hash,p_agent_hash:guestHash(req.headers.get("user-agent")||"unknown")});
 const s=await stripe.checkout.sessions.create({mode:"payment",payment_method_types:["card"],customer_email:user?.email,phone_number_collection:{enabled:true},line_items:[{price_data:{currency:"usd",unit_amount:order.price_cents,product_data:{name:mode==="test"?"iCash X — test funding":"iCash X bot credits",description:mode==="test"?"Sandbox funds only. No real acquisition work.":"Prepaid bot services. No deal or income is guaranteed."}},quantity:1}],metadata:{icash_funding_order:order.id,icash_terms_version:fundingTermsVersion},success_url:`${origin}/?payment=funded`,cancel_url:`${origin}/?payment=canceled`},{idempotencyKey:`icash-funding:${order.id}`});
 if(s.livemode!==(mode==="live")||!s.url)throw new Error("Mode mismatch");
 await db(`icash_funding_orders?id=eq.${order.id}`,"PATCH",{stripe_session_id:s.id});
 return NextResponse.json({url:s.url},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Could not open checkout. Please wait a moment and retry."},{status:503});}
}
