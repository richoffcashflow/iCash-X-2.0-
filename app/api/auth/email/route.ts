import { NextResponse } from "next/server";
import { authRequest } from "@/lib/account-auth";
import { db } from "@/lib/stripe-test";
import { allowedOrigin,fundingMode,normalizeEmail } from "@/lib/funding-policy";
import { limitRequest } from "@/lib/funding";
export const runtime="nodejs";
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:"Open iCash X directly and try again."},{status:403});
 if(process.env.ICASH_AUTH_EMAIL_READY!=="true"||!fundingMode())return NextResponse.json({error:"Email sign-in is being connected. Your payment remains saved."},{status:503});
 try{
  const {email:value}=await req.json();const email=normalizeEmail(value);if(!email)return NextResponse.json({error:"Enter a valid email address."},{status:400});
  await limitRequest(req,"email",email,3,600);
  const orders=await db<{id:string}[]>(`icash_funding_orders?payer_email=eq.${encodeURIComponent(email)}&state=eq.paid&mode=eq.${fundingMode()}&select=id&limit=1`);
  // Same response for unknown emails. An Auth user is created only after funding.
  if(orders.length)await authRequest("otp",{email,create_user:true});
  return NextResponse.json({sent:true,message:"If this email has a funded account, a sign-in code is on its way."},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Could not send a code. Wait a moment and try again."},{status:429});}
}
