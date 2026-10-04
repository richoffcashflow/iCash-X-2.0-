import {cookies} from 'next/headers';
import {db} from '@/lib/stripe-test';
import {readWebinarToken} from '@/lib/webinar-token';
import {normalizeEmail} from '@/lib/funding-policy';
export type CheckoutCustomerContext={name?:string;email?:string;phone?:string};
/** Prefill only this browser's saved webinar details. An email is not authentication. */
export async function checkoutCustomerContext(guest:string|null,accountEmail?:string):Promise<CheckoutCustomerContext>{
 const fallback=accountEmail?{email:accountEmail}:{};
 if(!guest)return fallback;
 try{
  const key=process.env.ICASH_WEBINAR_SECRET||process.env.SUPABASE_SECRET_KEY;if(!key)return fallback;
  const token=(await cookies()).get('icash_webinar')?.value,id=readWebinarToken(token,'visitor',key);if(!id)return fallback;
  const [v]=await db<{name:string|null;email:string|null;phone:string|null}[]>(`icash_webinar_visitors?id=eq.${id}&funding_guest_hash=eq.${guest}&select=name,email,phone&limit=1`);
  if(!v)return fallback;
  const email=normalizeEmail(v.email);if(accountEmail&&email!==accountEmail.toLowerCase())return fallback;
  const name=v.name?.trim().slice(0,80)||undefined,phone=v.phone?.replace(/[ ()-]/g,'');
  return {name,email:accountEmail||email||undefined,phone:phone&&/^\+[1-9]\d{6,14}$/.test(phone)?phone:undefined};
 }catch{return fallback;}
}
