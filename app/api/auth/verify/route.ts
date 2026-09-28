import { NextResponse } from "next/server";
import { verifyEmail } from "@/lib/account-auth";
import { allowedOrigin,normalizeEmail } from "@/lib/funding-policy";
import { limitRequest } from "@/lib/funding";
export const runtime="nodejs";
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:"Open iCash X directly and try again."},{status:403});
 if(process.env.ICASH_AUTH_EMAIL_READY!=="true")return NextResponse.json({error:"Email sign-in is not ready."},{status:503});
 try{const body=await req.json();const email=normalizeEmail(body.email);const token=body.code;
 if(!email||typeof token!=="string"||!/^\d{6,10}$/.test(token))return NextResponse.json({error:"Enter the code from your email."},{status:400});
 await limitRequest(req,"verify",email,8,600);await verifyEmail(email,token);
 return NextResponse.json({signedIn:true},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"That code could not be verified. Request a new code and try again."},{status:400});}
}
