import { cookies } from "next/headers";
import { db } from "@/lib/stripe-test";
import { fundingMode } from "@/lib/funding-policy";
type AuthUser={id:string;email?:string;email_confirmed_at?:string};
type AuthSession={access_token:string;refresh_token:string;expires_in:number;user:AuthUser};
export async function authRequest<T>(path:string,body?:unknown,access?:string):Promise<T> {
 if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SECRET_KEY)throw new Error("Account access unavailable");
 const r=await fetch(`${process.env.SUPABASE_URL}/auth/v1/${path}`,{method:body===undefined?"GET":"POST",headers:{apikey:process.env.SUPABASE_SECRET_KEY,...(access?{Authorization:`Bearer ${access}`}:{}) ,"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),cache:"no-store",signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new Error("Could not verify account access. Request a new code and try again.");
 if(r.status===204)return undefined as T;
 return r.json();
}
export async function saveSession(s:AuthSession) {
 const jar=await cookies();
 const options={httpOnly:true,secure:true,sameSite:"lax" as const,path:"/"};
 jar.set("icash_access",s.access_token,{...options,maxAge:Math.min(s.expires_in,3600)});
 jar.set("icash_refresh",s.refresh_token,{...options,maxAge:60*60*24*30});
}
export async function clearSession(){const jar=await cookies();jar.delete("icash_access");jar.delete("icash_refresh");}
export async function currentUser(refresh=false):Promise<AuthUser|null> {
 const jar=await cookies();const access=jar.get("icash_access")?.value;
 if(access) {try{const u=await authRequest<AuthUser>("user",undefined,access);if(u.email_confirmed_at)return u;}catch{/* Expired/revoked tokens never authorize. */}}
 const token=jar.get("icash_refresh")?.value;
 if(refresh&&token){try{const s=await authRequest<AuthSession>("token?grant_type=refresh_token",{refresh_token:token});if(!s.user.email_confirmed_at)return null;await saveSession(s);return s.user;}catch{await clearSession();}}
 return null;
}
export async function verifyEmail(email:string,token:string) {
 const s=await authRequest<AuthSession>("verify",{email,token,type:"email"});
 if(!s.user.email_confirmed_at)throw new Error("Verify your email first");
 const mode=fundingMode();if(!mode)throw new Error("Account mode unavailable");
 await db("rpc/icash_claim_funding","POST",{p_user:s.user.id,p_mode:mode});
 await saveSession(s);
}
