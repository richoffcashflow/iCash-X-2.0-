import { cookies } from "next/headers";
import { db } from "@/lib/stripe-test";
import {accountMode} from "@/lib/account-mode";
import {accessHash,phoneSessionCookie} from '@/lib/purchase-phone-access';
export class AuthRequestError extends Error { constructor(public status:number){super("Account authentication unavailable");} }
type AuthUser={id:string;email?:string;email_confirmed_at?:string;new_email?:string;phone_verified?:boolean};
export type AuthSession={access_token:string;refresh_token:string;expires_in:number;user:AuthUser};
export async function authRequest<T>(path:string,body?:unknown,access?:string,method?:'PUT',signal?:AbortSignal):Promise<T> {
 if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SECRET_KEY)throw new Error("Account access unavailable");
 const bearer=access??(path.startsWith('admin/')?process.env.SUPABASE_SECRET_KEY:undefined);
 const r=await fetch(`${process.env.SUPABASE_URL}/auth/v1/${path}`,{method:method??(body===undefined?"GET":"POST"),headers:{apikey:process.env.SUPABASE_SECRET_KEY,...(bearer?{Authorization:`Bearer ${bearer}`}:{}) ,"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),cache:"no-store",signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
 if(!r.ok)throw new AuthRequestError(r.status);
 if(r.status===204)return undefined as T;
 return r.json();
}
export async function saveSession(s:AuthSession,signal?:AbortSignal) {
 const jar=await cookies();
 const phone=jar.get(phoneSessionCookie)?.value;if(phone&&/^[a-f0-9]{64}$/.test(phone))await db('rpc/icash_revoke_phone_session','POST',{p_hash:accessHash(phone)},signal);jar.delete(phoneSessionCookie);
 const options={httpOnly:true,secure:true,sameSite:"lax" as const,path:"/"};
 jar.set("icash_access",s.access_token,{...options,maxAge:Math.min(s.expires_in,3600)});
 jar.set("icash_refresh",s.refresh_token,{...options,maxAge:60*60*24*30});
}
export async function clearSession(signal?:AbortSignal){const jar=await cookies();const phone=jar.get(phoneSessionCookie)?.value;if(phone&&/^[a-f0-9]{64}$/.test(phone))await db('rpc/icash_revoke_phone_session','POST',{p_hash:accessHash(phone)},signal);jar.delete(phoneSessionCookie);jar.delete("icash_access");jar.delete("icash_refresh");jar.set("__Host-icash_dashboard",'',{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:0});}
export async function currentUser(refresh=false,signal?:AbortSignal):Promise<AuthUser|null> {
 const jar=await cookies();const access=jar.get("icash_access")?.value;
 const phone=jar.get(phoneSessionCookie)?.value;
 if(phone&&/^[a-f0-9]{64}$/.test(phone)&&accountMode()==='live'){
  const u=await db<AuthUser|null>('rpc/icash_phone_session_user','POST',{p_hash:accessHash(phone)},signal);if(u?.phone_verified&&u.id)return u;
 }
 if(access) {try{const u=await authRequest<AuthUser>("user",undefined,access,undefined,signal);if(u.email_confirmed_at)return u;}catch(e){if(!(e instanceof AuthRequestError)||![400,401,403].includes(e.status))throw e;}}
 const token=jar.get("icash_refresh")?.value;
 if(refresh&&token){try{const s=await authRequest<AuthSession>("token?grant_type=refresh_token",{refresh_token:token},undefined,undefined,signal);if(!s.user.email_confirmed_at)return null;await saveSession(s,signal);return s.user;}catch(e){if(!(e instanceof AuthRequestError)||![400,401,403].includes(e.status))throw e;await clearSession(signal);}}
 return null;
}
export async function verifyEmail(email:string,token:string) {
 const s=await authRequest<AuthSession>("verify",{email,token,type:"email"});
 if(!s.user.email_confirmed_at)throw new Error("Verify your email first");
 const mode=accountMode();if(!mode)throw new Error("Account mode unavailable");
 // An accepted code is consumed by Auth. Persist its verified session before
 // provisioning, so a recoverable database error never discards a valid sign-in.
 await saveSession(s);
 try{await db("rpc/icash_claim_funding","POST",{p_user:s.user.id,p_mode:mode});return {accessPending:false};}
 catch{return {accessPending:true};}
}
