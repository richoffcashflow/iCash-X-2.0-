import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authRequest,clearSession } from "@/lib/account-auth";
import { allowedOrigin } from "@/lib/funding-policy";
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:"Invalid origin"},{status:403});
 const token=(await cookies()).get("icash_access")?.value;
 if(token){try{await authRequest("logout?scope=local",{},token);}catch{/* Clear browser access even during an Auth outage. */}}
 await clearSession();return NextResponse.json({signedOut:true},{headers:{"Cache-Control":"no-store"}});
}
