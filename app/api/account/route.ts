import type { CustomerIdentity } from "@/lib/customer-identity";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/account-auth";
import { db } from "@/lib/stripe-test";
import { fundingMode } from "@/lib/funding-policy";
export const dynamic="force-dynamic";
export async function GET(){
 const headers={"Cache-Control":"private, no-store"};
 try{
 const mode=fundingMode();const user=await currentUser(true);
 if(!user||!mode)return NextResponse.json({signedIn:false,signInReady:process.env.ICASH_AUTH_EMAIL_READY==="true"},{headers});
 const id=await db<string>("rpc/icash_claim_funding","POST",{p_user:user.id,p_mode:mode});
 if(mode==="live")await db("rpc/icash_apply_funding_pacing","POST",{p_account:id});
 await db("rpc/icash_daily_claim","POST",{p_account:id});
 const [a]=await db<{id:string;assistant_name:string;bot_paused:boolean;daily_limit_cents:number}[]>(`icash_accounts?id=eq.${id}&select=id,assistant_name,bot_paused,daily_limit_cents`);
 const [identity]=await db<CustomerIdentity[]>(`icash_customer_identities?account_id=eq.${id}&select=first_name,last_name,company_name,principal,voice_id,voice_name`);
 const [wallet]=await db<{balance_cents:number;reserved_cents:number}[]>(`icash_wallets?account_id=eq.${id}&select=balance_cents,reserved_cents`);
 const totals=await db<{creditCents:number;phone:string|null}>("rpc/icash_funding_account_totals","POST",{p_account:id,p_mode:mode});
 // Sandbox balances are order totals, never spendable live-wallet grants.
 const balance=mode==="test"?totals.creditCents:wallet.balance_cents-wallet.reserved_cents;
 const reviews=await db<{event_id:string}[]>(`icash_billing_reviews?account_id=eq.${id}&resolved_at=is.null&select=event_id&limit=1`);
 return NextResponse.json({signedIn:true,identity:identity??null,mode,email:user.email,phone:totals.phone,balanceCents:balance,reservedCents:mode==="test"?0:wallet.reserved_cents,assistantName:a.assistant_name,paused:a.bot_paused,dailyLimitCents:a.daily_limit_cents,billingReview:reviews.length>0,workReady:false},{headers});
 }catch{return NextResponse.json({error:"Your account is temporarily unavailable. Please retry."},{status:503,headers});}
}
