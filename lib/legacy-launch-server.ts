import {cookies} from 'next/headers';
import {db} from '@/lib/stripe-test';
export const legacyLaunchCookie='icash_legacy_launch';
export const launchTokenPattern=/^[a-f0-9]{64}$/;
/** A launch invitation prefills signup only. It never authenticates or grants membership. */
export async function legacyInviteContext(accountEmail?:string) {
 const token=(await cookies()).get(legacyLaunchCookie)?.value;
 if(!token||!launchTokenPattern.test(token))return null;
 const [c]=await db<{id:string;launch_id:string;name:string;email:string|null;phone:string|null;converted_at:string|null;suppressed_reason:string|null}[]>(`icash_legacy_contacts?token=eq.${token}&select=id,launch_id,name,email,phone,converted_at,suppressed_reason&limit=1`);
 if(!c||c.suppressed_reason||c.converted_at||accountEmail&&c.email!==accountEmail.toLowerCase())return null;
 return c;
}
export async function bindLegacyWebinar(visitorId:string,campaignId:string) {
 const c=await legacyInviteContext();if(c?.launch_id!==campaignId)return;
 await db('rpc/icash_legacy_bind','POST',{p_contact:c.id,p_visitor:visitorId});
}

/** Called only after the billing route verified this browser/account owns the checkout. */
export async function bindLegacyMembership(membershipId:string|undefined,accountEmail?:string){
 if(!membershipId||!/^[a-f0-9-]{36}$/i.test(membershipId))return;
 const c=await legacyInviteContext(accountEmail);if(!c)return;
 await db('rpc/icash_legacy_checkout_bind','POST',{p_contact:c.id,p_membership:membershipId});
}
