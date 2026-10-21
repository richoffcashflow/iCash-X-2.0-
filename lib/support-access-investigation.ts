import {phoneAccessReady} from './purchase-phone-access.ts';
import {accountMode} from './account-mode.ts';

type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
export type AccessInvestigation={checked:boolean;email:'configured'|'unavailable'|'unknown';phone:'configured'|'unavailable'|'unknown';recovery:'checked'|'unavailable'};
export const unknownAccessInvestigation:AccessInvestigation={checked:false,email:'unknown',phone:'unknown',recovery:'unavailable'};

/** No OTP sends or identity changes. Purchase/delivery details stay in the private audit. */
export async function investigateAccess(db:Database,id:string,key:string,token:string,env:NodeJS.ProcessEnv=process.env):Promise<AccessInvestigation>{
 const binding={p_id:id,p_key:key,p_token:token};
 let recovery:AccessInvestigation['recovery']='unavailable';
 try{await db('rpc/icash_access_help_recover','POST',binding);recovery='checked';}catch{/* A failed check must not become evidence of a repair. */}
 const emailReady=env.ICASH_AUTH_EMAIL_READY==='true'&&!!accountMode(env),phoneReady=phoneAccessReady(env);
 try{
  const result=await db<{checked:boolean;email:string;phone:string}|null>('rpc/icash_access_help_investigate','POST',{...binding,p_email_ready:emailReady,p_phone_ready:phoneReady,p_recovery:recovery});
  if(result?.checked===true&&['configured','unavailable'].includes(result.email)&&['configured','unavailable'].includes(result.phone))return {checked:true,email:result.email as AccessInvestigation['email'],phone:result.phone as AccessInvestigation['phone'],recovery};
 }catch{/* Keep support usable during a check outage; never claim it passed. */}
 return {checked:false,email:emailReady?'unknown':'unavailable',phone:phoneReady?'unknown':'unavailable',recovery};
}
