import {currentUser} from '@/lib/account-auth';
import {db} from '@/lib/stripe-test';
import {accountMode} from '@/lib/account-mode';
import {membershipAccessible} from '@/lib/membership-policy';
import {paidVipDestination} from '@/lib/webinar-vip';
import type {Membership} from '@/lib/membership';
const headers={'Cache-Control':'private, no-store'};
export const dynamic='force-dynamic';
export async function GET(req:Request){
 try{
  const params=new URL(req.url).searchParams,purchase=params.get('purchase'),vip=params.get('destination')==='vip';
  if(purchase&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(purchase))return Response.json({error:'This purchase link could not be read. Open /access to sign in.'},{status:400,headers});
  const user=await currentUser(true);
  if(!user)return Response.json({signedIn:false,signInReady:process.env.ICASH_AUTH_EMAIL_READY==='true'},{headers});
  let [account]=await db<{id:string}[]>(`icash_accounts?owner_user_id=eq.${user.id}&select=id&limit=1`);
  if(!account){const mode=accountMode();if(!mode)throw Error('Account mode unavailable');const id=await db<string>('rpc/icash_claim_funding','POST',{p_user:user.id,p_mode:mode});account={id};}
  if(!purchase&&!vip)return Response.json({signedIn:true,destination:'/'},{headers});
  const mode=accountMode();if(!mode)throw Error('Account mode unavailable');
  const rows=await db<Membership[]>(`icash_memberships?account_id=eq.${account.id}&mode=eq.${mode}${purchase?'&id=eq.'+purchase:''}&order=created_at.desc&select=*&limit=10`);
  const membership=purchase?rows[0]:rows.find(m=>membershipAccessible(m));
  if(!membership)return Response.json({signedIn:true,error:'Sign in with the same email you used for this purchase. Your payment is saved; do not pay again.'},{status:403,headers});
  if(vip){
   if(!membershipAccessible(membership))return Response.json({signedIn:true,error:'This session needs active software access. Contact support to check your purchase.'},{status:403,headers});
   const destination=await paidVipDestination(membership);
   if(!destination)return Response.json({signedIn:true,error:'Your VIP session is not available right now. You can still open your workspace.'},{status:409,headers});
   return Response.json({signedIn:true,destination},{headers});
  }
  return Response.json({signedIn:true,destination:'/'},{headers});
 }catch{return Response.json({error:'We could not restore your account right now. Please retry. Your payment is saved.'},{status:503,headers});}
}
