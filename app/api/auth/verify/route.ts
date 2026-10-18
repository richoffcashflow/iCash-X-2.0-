import { NextResponse } from "next/server";
import { verifyEmail, AuthRequestError } from "@/lib/account-auth";
import { allowedOrigin,normalizeEmail } from "@/lib/funding-policy";
import { limitRequest } from "@/lib/funding";
export const runtime="nodejs";
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:"Open iCash X directly and try again."},{status:403});
 if(process.env.ICASH_AUTH_EMAIL_READY!=="true")return NextResponse.json({error:"Email sign-in is not ready."},{status:503});
 try{const body=await req.json();const email=normalizeEmail(body.email);const token=body.code;
 if(!email||typeof token!=="string"||!/^\d{6,10}$/.test(token))return NextResponse.json({error:"Enter the code from your email."},{status:400});
 await limitRequest(req,"verify",email,8,600);const result=await verifyEmail(email,token);
 return NextResponse.json({signedIn:true,accessPending:result?.accessPending??false},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
 const invalid=error instanceof AuthRequestError&&[400,401,403].includes(error.status);
 const limited=(error as {status?:number})?.status===429;
 return NextResponse.json({error:limited?'Please wait before trying another code. Your payment is saved.':invalid?'That code could not be verified. Request a new code and try again.':'Sign-in could not finish right now. Please retry shortly; do not pay again.'},{status:limited?429:invalid?400:503,headers:{'Cache-Control':'no-store'}});
 }
}
