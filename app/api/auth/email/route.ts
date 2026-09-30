import {accountMode} from '@/lib/account-mode';
import { NextResponse } from "next/server";
import { authRequest } from "@/lib/account-auth";
import { db } from "@/lib/stripe-test";
import { allowedOrigin,normalizeEmail } from "@/lib/funding-policy";
import { limitRequest } from "@/lib/funding";
export const runtime="nodejs";
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:"Open iCash X directly and try again."},{status:403});
 if(process.env.ICASH_AUTH_EMAIL_READY!=="true"||!accountMode())return NextResponse.json({error:"Email sign-in is being connected. Your payment remains saved."},{status:503});
 try{
  const {email:value}=await req.json();const email=normalizeEmail(value);if(!email)return NextResponse.json({error:"Enter a valid email address."},{status:400});
  await limitRequest(req,"email",email,3,600);
  const eligible=await db<boolean>('rpc/icash_can_sign_in','POST',{p_email:email,p_mode:accountMode()});
  // Keep responses identical for unknown emails. Existing verified accounts may return before purchasing again.
  if(eligible)await authRequest("otp",{email,create_user:true});
  return NextResponse.json({sent:true,message:"If this email has an account or confirmed payment, a sign-in code is on its way."},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Could not send a code. Wait a moment and try again."},{status:429});}
}
