/** Replace this file when installing the webinar app in a different company's product. */
import {currentUser} from '@/lib/account-auth';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {db} from '@/lib/stripe-test';
import {webinarSite} from '@/lib/webinar-site';

export async function webinarOwnerIdentity(){
 const ownerId=process.env.WEBINAR_OWNER_USER_ID||(webinarSite.companyKey==='icash-x'?ownerInboundTarget.ownerUserId:null);
 const user=await currentUser(true);return ownerId&&user?.id===ownerId?user:null;
}
export async function webinarCustomerAccount(){
 const user=await currentUser(true);if(!user)return null;
 const [account]=await db<{id:string;bot_paused:boolean;daily_limit_cents:number}[]>(`icash_accounts?owner_user_id=eq.${user.id}&select=id,bot_paused,daily_limit_cents&limit=1`);
 return account?{id:account.id,destination:webinarSite.workspacePath,needsBudget:account.bot_paused||account.daily_limit_cents<=0}:null;
}
export async function webinarCustomerPaid(guest:string){
 const [funding,membership]=await Promise.all([db<unknown[]>(`icash_funding_orders?guest_hash=eq.${guest}&mode=eq.live&state=eq.paid&select=id&limit=1`),db<unknown[]>(`icash_memberships?guest_hash=eq.${guest}&mode=eq.live&paid_through=not.is.null&select=id&limit=1`)]);
 return !!(funding.length||membership.length);
}
