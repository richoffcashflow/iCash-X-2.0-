import {currentUser} from '@/lib/account-auth';
import {fundingReturnSummary} from '@/lib/funding-return';
import {privatePaymentCheckAllowed} from '@/lib/private-payment-check';
import {customerFundingReady} from "@/lib/launch-readiness";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db,guestHash } from "@/lib/stripe-test";
import { earlyAccessFundingEnabled,fundingMode,type FundingOrder } from "@/lib/funding-policy";
import { fundingStripe,settleFunding,validGuest } from "@/lib/funding";
import {customFundingCode,minimumFundingCents,maximumFundingCents} from '@/lib/funding-amount';
export const dynamic="force-dynamic";
export async function GET(req:Request){
 const headers={"Cache-Control":"private, no-store"};const mode=fundingMode();
 try{
 const catalog=await db<{code:string;price_cents:number;credit_cents:number;enabled:boolean}[]>("icash_credit_packs?price_cents=gte.1000&select=code,price_cents,credit_cents,enabled&order=price_cents&limit=250");
 const packs=catalog.filter(p=>p.code!==customFundingCode);
 const custom={enabled:catalog.some(p=>p.code===customFundingCode&&p.enabled),minCents:minimumFundingCents,maxCents:maximumFundingCents};
 const pack=packs.find(p=>p.code==="budget_ten");
 const [planning]=await db("icash_planning_estimates?id=eq.1&select=lookup_cents,voice_minute_cents,lookup_share_percent,call_minutes_low,call_minutes_high") as import("@/lib/funding-forecast").PlanningPrices[];
 const token=(await cookies()).get("icash_funding_guest")?.value;
 const user=await currentUser(true);
 const [account]=user?await db<{id:string}[]>(`icash_accounts?owner_user_id=eq.${user.id}&select=id&limit=1`):[];
 // Session IDs identify a checkout, but never authorize access to it.
 const scope=account?`account_id=eq.${account.id}`:validGuest(token)?`guest_hash=eq.${guestHash(token)}`:null;
 const sessionId=new URL(req.url).searchParams.get('session_id');
 if(sessionId&&!/^cs_(live|test)_[A-Za-z0-9]{1,240}$/.test(sessionId))return NextResponse.json({error:'Invalid checkout reference.'},{status:400,headers});
 let orders:FundingOrder[]=[];
 if(mode&&scope){
 let checkoutFilter='';
 if(sessionId){
 const [plan]=await db<{id:string}[]>(`icash_daily_plans?${scope}&mode=eq.${mode}&stripe_session_id=eq.${sessionId}&select=id&limit=1`);
 checkoutFilter=plan?`&daily_plan_id=eq.${plan.id}`:`&stripe_session_id=eq.${sessionId}`;
 }
 const query=`icash_funding_orders?${scope}&mode=eq.${mode}${checkoutFilter}&select=*&order=created_at.desc&limit=100`;
 orders=await db<FundingOrder[]>(query);
 const pending=orders.find(o=>o.state==="pending"&&o.stripe_session_id);
 if(pending?.stripe_session_id){
 const s=await fundingStripe().checkout.sessions.retrieve(pending.stripe_session_id);
 if(s.payment_status==="paid"){
 await settleFunding(s);
 // Settlement can credit the wallet. Re-read rather than returning stale claim state.
 orders=await db<FundingOrder[]>(query);
 }
 }
 }
 const [autoRecharge]=account&&mode?await db<{enabled:boolean;amount_cents:number|null;issue:string|null}[]>(`icash_auto_recharges?account_id=eq.${account.id}&mode=eq.${mode}&select=enabled,amount_cents,issue`):[];
 const summary=fundingReturnSummary(orders,!!user);
 return NextResponse.json({privatePaymentCheck:await privatePaymentCheckAllowed(),mode,enabled:await customerFundingReady(),earlyAccess:earlyAccessFundingEnabled(),autoRecharge:autoRecharge??{enabled:false},packs,custom,planning,forecast:{cycleChargeCents:null,qualified:null},priceCents:pack?.price_cents??null,creditCents:pack?.credit_cents??null,...summary},{headers});
 }catch{return NextResponse.json({enabled:false,error:"Could not check funding. Please retry."},{status:503,headers});}
}
