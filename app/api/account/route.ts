import {discoveryAccountReadiness,contactAccountReadiness} from '@/lib/discovery-channel-readiness';
import {smsAccountReady} from '@/lib/sms-channel-readiness';
import {liveWorkReady} from '@/lib/live-work-admission';
import {launchReadiness} from "@/lib/launch-readiness";
import type { CustomerIdentity } from "@/lib/customer-identity";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/account-auth";
import { db } from "@/lib/stripe-test";
import {accountMode} from "@/lib/account-mode";
export const dynamic="force-dynamic";
export async function GET(){
 const headers={"Cache-Control":"private, no-store"};
 try{
 const mode=accountMode();const user=await currentUser(true);
 if(!user||!mode)return NextResponse.json({signedIn:false,signInReady:process.env.ICASH_AUTH_EMAIL_READY==="true"},{headers});
 const id=await db<string>("rpc/icash_claim_funding","POST",{p_user:user.id,p_mode:mode});
 if(mode==="live")await db("rpc/icash_apply_funding_pacing","POST",{p_account:id});
 await db("rpc/icash_daily_claim","POST",{p_account:id});
 await db("rpc/icash_claim_bot_setup","POST",{p_account:id});
 const [[a],[identity],[wallet],totals,[botSetup],reviews,readiness,voiceWork,propertyWork,billingPlans,smsReady,discoveryReadiness,contactReadiness]=await Promise.all([
 db<{id:string;assistant_name:string;bot_paused:boolean;daily_limit_cents:number}[]>(`icash_accounts?id=eq.${id}&select=id,assistant_name,bot_paused,daily_limit_cents`),
 db<CustomerIdentity[]>(`icash_customer_identities?account_id=eq.${id}&select=first_name,last_name,company_name,principal,voice_id,voice_name`),
 db<{balance_cents:number;reserved_cents:number}[]>(`icash_wallets?account_id=eq.${id}&select=balance_cents,reserved_cents`),
 db<{creditCents:number;phone:string|null}>('rpc/icash_funding_account_totals','POST',{p_account:id,p_mode:mode}),
 db<{profile:unknown;stage:number}[]>(`icash_bot_setups?account_id=eq.${id}&select=profile,stage`),
 db<{event_id:string}[]>(`icash_billing_reviews?account_id=eq.${id}&resolved_at=is.null&select=event_id&limit=1`),
 mode==='live'?launchReadiness(id):Promise.resolve({ready:false}),
 db<{id:string}[]>(`icash_live_conversations?account_id=eq.${id}&state=eq.waiting&created_at=gte.${encodeURIComponent(new Date(Date.now()-15*60_000).toISOString())}&select=id&limit=1`),
 db<{id:string}[]>(`icash_screening_jobs?account_id=eq.${id}&state=in.(queued,running)&select=id&limit=1`),
 db<{id:string}[]>(`icash_daily_plans?account_id=eq.${id}&mode=eq.${mode}&state=neq.stopped&select=id&limit=1`),
 mode==='live'?smsAccountReady(id,user.id):Promise.resolve(false),
 mode==='live'?discoveryAccountReadiness(id,user.id):Promise.resolve({ready:false,quote:null}),
 mode==='live'?contactAccountReadiness(id,user.id):Promise.resolve({ready:false,quote:null})
 ]);
 // Sandbox balances are order totals, never spendable live-wallet grants.
 const balance=mode==="test"?totals.creditCents:wallet.balance_cents-wallet.reserved_cents;
 return NextResponse.json({signedIn:true,botSetup:botSetup??null,identity:identity??null,mode,email:user.email,phone:totals.phone,balanceCents:balance,reservedCents:mode==="test"?0:wallet.reserved_cents,assistantName:a.assistant_name,paused:a.bot_paused,billingActive:billingPlans.length>0,dailyLimitCents:a.daily_limit_cents,billingReview:reviews.length>0,workReady:mode==="live"&&liveWorkReady()&&readiness.ready,smsWorkReady:smsReady,discoveryWorkReady:discoveryReadiness.ready,discoveryQuote:discoveryReadiness.quote,contactWorkReady:contactReadiness.ready,contactQuote:contactReadiness.quote,activeWork:voiceWork.length>0||propertyWork.length>0},{headers});
 }catch{return NextResponse.json({error:"Your account is temporarily unavailable. Please retry."},{status:503,headers});}
}
