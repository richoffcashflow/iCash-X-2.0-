import {autoRechargeVersion,autoRechargeTerms,autoRechargeSummary} from '@/lib/auto-recharge-policy';
import {accountMembership} from '@/lib/membership';
import {privatePaymentCheckAllowed} from '@/lib/private-payment-check';
import {customerFundingReady} from "@/lib/launch-readiness";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { currentUser } from "@/lib/account-auth";
import { db,guestHash } from "@/lib/stripe-test";
import { allowedOrigin,earlyAccessFundingEnabled,fundingMode,type FundingOrder } from "@/lib/funding-policy";
import { fundingStripe,limitRequest,settleFunding,validGuest } from "@/lib/funding";
import {acceptedFundingTerms,fundingTermsVersion,fundingTermsText,acceptedEarlyAccessTerms,earlyAccessTermsVersion,earlyAccessDisclosure} from "@/lib/funding-consent";
import {maximumFundingDays} from '@/lib/funding-duration';
import {processingFeeCents} from '@/lib/funding-fees';
import {workCreditTerms,workCreditTermsVersion} from '@/lib/membership-policy';
import {customFundingCode,validFundingAmount} from '@/lib/funding-amount';
export const runtime="nodejs";
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:"Open iCash X directly and try again."},{status:403});
 const privateAllowed=await privatePaymentCheckAllowed();
 if(!privateAllowed&&!(await customerFundingReady()))return NextResponse.json({error:"Funding is not open yet."},{status:503});
 let consent;try{const raw=await req.text();if(raw.length>512)throw new Error();consent=JSON.parse(raw);}catch{return NextResponse.json({error:"Accept the purchase terms to continue."},{status:400});}
 const prepaid=consent?.accepted===true&&consent?.version===workCreditTermsVersion;
 if(!prepaid&&!acceptedFundingTerms(consent))return NextResponse.json({error:"Accept the current purchase terms to continue."},{status:400});
 const choice=consent as {packCode?:unknown;days?:unknown;totalCents?:unknown;customAmountCents?:unknown};
 const privateCheck=privateAllowed&&choice.packCode==='private_check_three';
 if(!privateCheck&&!(await customerFundingReady()))return NextResponse.json({error:"Funding is not open yet."},{status:503});
 const earlyAccess=!privateCheck&&earlyAccessFundingEnabled();
 if(earlyAccess&&!acceptedEarlyAccessTerms(consent))return NextResponse.json({error:"Acknowledge the current early-access limitations before payment."},{status:400});
 if(earlyAccess&&choice.days!==1)return NextResponse.json({error:"Early-access funding is one credit purchase with no daily renewal."},{status:400});
 const autoRecharge=consent.autoRecharge===true;
 if(consent.autoRecharge!==undefined&&typeof consent.autoRecharge!=='boolean'||autoRecharge&&(!prepaid||consent.autoRechargeVersion!==autoRechargeVersion||privateCheck))return NextResponse.json({error:'Refresh the auto recharge option and try again.'},{status:400});
 const consentVersion=prepaid?workCreditTermsVersion+(autoRecharge?':'+autoRechargeVersion:''):earlyAccess?`${fundingTermsVersion}:early:${earlyAccessTermsVersion}`:fundingTermsVersion;
 let consentText=prepaid?workCreditTerms+(earlyAccess?' '+earlyAccessDisclosure:''):earlyAccess?`${fundingTermsText} Early-access acknowledgment: ${earlyAccessDisclosure}`:fundingTermsText;
 const packCode=typeof choice.packCode==="string"&&/^[a-z0-9_]{1,30}$/.test(choice.packCode)?choice.packCode:"start";
 const custom=packCode===customFundingCode;
 if(custom?(!prepaid||!validFundingAmount(choice.customAmountCents)||choice.days!==1):choice.customAmountCents!==undefined)return NextResponse.json({error:'Choose an amount from $10 to $1,000, with up to two decimal places.'},{status:400});
 if(privateCheck&&(choice.packCode!=='private_check_three'||choice.days!==1||choice.totalCents!==300))return NextResponse.json({error:'Private payment checks are limited to $3, once per checkout, with no renewal.'},{status:400});
 const runDays=typeof choice.days==="number"?choice.days:1;
 if(!Number.isInteger(runDays)||runDays<1||runDays>7)return NextResponse.json({error:"Choose 1–7 days."},{status:400});
 const mode=fundingMode()!;const origin=req.headers.get("origin")!;
 const jar=await cookies();let token=jar.get("icash_funding_guest")?.value;
 if(!validGuest(token)){token=randomBytes(32).toString("hex");jar.set("icash_funding_guest",token,{httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:86400*30});}
 try{
 await limitRequest(req,"checkout",token,10,600);
 const user=await currentUser();
 const accounts=user?await db<{id:string}[]>(`icash_accounts?owner_user_id=eq.${user.id}&select=id&limit=1`):[];
 const accountId=accounts[0]?.id??null;const hash=guestHash(token);
 if(!privateCheck&&(!prepaid||!accountId||runDays!==1))return NextResponse.json({error:'Open your software account first, then add one-time work credits from your workspace.'},{status:401});
 if(prepaid&&accountId){const [legacy]=await db<{id:string}[]>(`icash_daily_plans?account_id=eq.${accountId}&mode=eq.${mode}&state=neq.stopped&select=id&limit=1`);if(legacy)return NextResponse.json({error:'Stop the existing daily plan before switching to prepaid credits.'},{status:409});if(mode==='live'&&!await db<boolean>('rpc/icash_membership_work_allowed','POST',{p_account:accountId}))return NextResponse.json({error:'Your software subscription needs attention. Manage it before adding credits.'},{status:409});}
 const membership=prepaid&&accountId?await accountMembership(accountId):null;
 const billingCustomer=membership?.mode===mode&&membership.account_id===accountId&&/^cus_[A-Za-z0-9]+$/.test(membership.stripe_customer_id??'')?membership.stripe_customer_id:null;
 const stripe=fundingStripe();
 const [pack]=await db<{code:string;price_cents:number;credit_cents:number}[]>(`icash_credit_packs?code=eq.${packCode}${mode==="live"&&!privateCheck?"&enabled=eq.true":""}&select=code,price_cents,credit_cents`);
 if(!pack||!Number.isSafeInteger(pack.price_cents)||!Number.isSafeInteger(pack.credit_cents)||pack.credit_cents<=0||(privateCheck?(pack.price_cents!==300||pack.credit_cents!==300):(pack.price_cents<1000||pack.price_cents>100000||pack.credit_cents>100000)))throw new Error("No enabled pack");
 // The enabled custom pack identifies the product. The order snapshots the exact
 // validated amount; payment and wallet settlement are bound to that snapshot.
 if(custom&&validFundingAmount(choice.customAmountCents)){pack.price_cents=choice.customAmountCents;pack.credit_cents=choice.customAmountCents;}
 if(autoRecharge&&(processingFeeCents(pack.price_cents)!==0||pack.price_cents!==pack.credit_cents))return NextResponse.json({error:'Auto recharge is unavailable. Add money manually.'},{status:409});
 if(autoRecharge)consentText+=' '+autoRechargeTerms(pack.price_cents);
 const budgetPrice=pack.price_cents*runDays,fee=processingFeeCents(budgetPrice),totalPrice=budgetPrice+fee,totalCredits=pack.credit_cents*runDays;
 if(!Number.isSafeInteger(totalPrice)||!Number.isSafeInteger(totalCredits)||choice.totalCents!==totalPrice)return NextResponse.json({error:"Budget changed. Refresh and confirm your total."},{status:400});
 if(!privateCheck&&runDays>maximumFundingDays(pack.price_cents))return NextResponse.json({error:"Choose fewer days for this budget."},{status:400});
 const old=await db<FundingOrder[]>(`icash_funding_orders?guest_hash=eq.${hash}&mode=eq.${mode}&state=eq.pending&order=created_at.desc&limit=1`);
 let order:FundingOrder|undefined=old[0];
 if(order && order.account_id!==accountId)return NextResponse.json({error:"Finish or cancel the checkout already open in this browser before switching accounts."},{status:409});
 if(order&&!order.stripe_session_id&&(!(order as FundingOrder & {flexible_pacing?:boolean}).flexible_pacing||!!order.auto_recharge!==autoRecharge||order.pack_code!==packCode||order.price_cents!==totalPrice||order.tax_required||order.credit_cents!==totalCredits||(order as FundingOrder & {run_days?:number}).run_days!==runDays)){await db(`icash_funding_orders?id=eq.${order.id}`,"PATCH",{state:"expired"});order=undefined;}
 if(order?.stripe_session_id&& (!(order as FundingOrder & {flexible_pacing?:boolean}).flexible_pacing||!!order.auto_recharge!==autoRecharge||order.pack_code!==packCode||order.price_cents!==totalPrice||order.tax_required||order.credit_cents!==totalCredits||(order as FundingOrder & {run_days?:number}).run_days!==runDays)){const previous=await stripe.checkout.sessions.retrieve(order.stripe_session_id);if(previous.payment_status==="paid"){await settleFunding(previous);return NextResponse.json({error:"Payment received. Refresh your balance."},{status:409});}if(previous.status==="open")await stripe.checkout.sessions.expire(previous.id);await db(`icash_funding_orders?id=eq.${order.id}`,"PATCH",{state:"expired"});order=undefined;}
 if(order?.stripe_session_id){const s=await stripe.checkout.sessions.retrieve(order.stripe_session_id);
 if(s.status==="open"&&((earlyAccess&&s.metadata?.icash_early_access_terms_version!==earlyAccessTermsVersion)||(prepaid&&(s.metadata?.icash_prepaid_work!=='true'||s.metadata?.icash_terms_version!==consentVersion|| (s.metadata?.icash_auto_recharge==='true')!==autoRecharge)))){
 await stripe.checkout.sessions.expire(s.id);await db(`icash_funding_orders?id=eq.${order.id}`,"PATCH",{state:"expired"});order=undefined;
 }else if(s.status==="open"&&s.url){await db("rpc/icash_record_funding_consent","POST",{p_order:order.id,p_version:consentVersion,p_terms:consentText,p_guest:hash,p_agent_hash:guestHash(req.headers.get("user-agent")||"unknown")});return NextResponse.json({url:s.url});}
 else if(s.payment_status==="paid"){await settleFunding(s);return NextResponse.json({error:"Payment received. Check your balance before adding more."},{status:409});}
 else if(s.status!=="expired")return NextResponse.json({error:"Your previous payment is still being confirmed."},{status:409});
 if(order){await db(`icash_funding_orders?id=eq.${order.id}`,"PATCH",{state:"expired"});order=undefined;}
 }
 if(!order){
 [order]=await db<FundingOrder[]>("icash_funding_orders","POST",{mode,guest_hash:hash,account_id:accountId,pack_code:pack.code,price_cents:totalPrice,processing_fee_cents:fee,tax_required:false,credit_cents:totalCredits,run_days:runDays,flexible_pacing:true,auto_recharge:autoRecharge});}
 await db("rpc/icash_record_funding_consent","POST",{p_order:order.id,p_version:consentVersion,p_terms:consentText,p_guest:hash,p_agent_hash:guestHash(req.headers.get("user-agent")||"unknown")});
 if(autoRecharge)await db('rpc/icash_prepare_auto_recharge','POST',{p_order:order.id});
 const s=await stripe.checkout.sessions.create({mode:"payment",automatic_tax:{enabled:false},payment_method_types:["card"],...(billingCustomer?{customer:billingCustomer}:{customer_email:user?.email,...(autoRecharge?{customer_creation:'always' as const}:{})}),...(autoRecharge?{payment_intent_data:{setup_future_usage:'off_session' as const}}:{}),phone_number_collection:{enabled:true},line_items:[{price_data:{currency:"usd",tax_behavior:"exclusive",unit_amount:order.price_cents-(order.processing_fee_cents??0),product_data:{name:mode==="test"?"iCash X — test funding":"iCash X work credits",description:mode==="test"?"Sandbox funds only. No real acquisition work.":earlyAccess?earlyAccessDisclosure:"Prepaid bot services. No deal or income is guaranteed."}},quantity:1}],metadata:{icash_funding_order:order.id,...(autoRecharge?{icash_auto_recharge:'true'}:{}),icash_terms_version:consentVersion,...(prepaid?{icash_prepaid_work:'true'}:{}),...(earlyAccess?{icash_early_access_terms_version:earlyAccessTermsVersion}:{}),...(privateCheck?{icash_private_payment_check:"true"}:{})},custom_text:{submit:{message:autoRecharge?autoRechargeSummary(order.price_cents):prepaid?'One-time work credits. Eligible AI work may use the full amount after payment. No daily renewal or automatic refill. '+(earlyAccess?earlyAccessDisclosure:''):earlyAccess?earlyAccessDisclosure:'One-time credit purchase.'}},success_url:`${origin}/?payment=funded&session_id={CHECKOUT_SESSION_ID}#funding`,cancel_url:`${origin}/?payment=canceled#funding`},{idempotencyKey:`icash-funding:${order.id}`});
 if(s.livemode!==(mode==="live")||!s.url)throw new Error("Mode mismatch");
 await db(`icash_funding_orders?id=eq.${order.id}`,"PATCH",{stripe_session_id:s.id});
 return NextResponse.json({url:s.url},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Could not open checkout. Please wait a moment and retry."},{status:503});}
}
