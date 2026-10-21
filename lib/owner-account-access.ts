import {cookies} from 'next/headers';
import {dashboardCurrentUser} from '@/lib/dashboard-password';
import {dashboardBinding} from '@/lib/dashboard-password-policy';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {db} from '@/lib/stripe-test';
import {ownerViewSchema} from '@/lib/owner-accounts';
export const ownerViewHeaders={'Cache-Control':'private, no-store','Vary':'Cookie','Referrer-Policy':'no-referrer'};
export class OwnerViewError extends Error{constructor(public status:number,message:string){super(message);}}
export async function ownerAccountActor(){
 const user=await dashboardCurrentUser(true);
 if(!user)throw new OwnerViewError(401,'Sign in to your owner account.');
 if(user.id!==ownerInboundTarget.ownerUserId)throw new OwnerViewError(403,'Owner access only.');
 const binding=dashboardBinding((await cookies()).get('icash_access')?.value);
 if(!binding||binding.sub!==user.id)throw new OwnerViewError(403,'Unlock your admin dashboard again.');
 return {userId:user.id,sessionId:binding.session_id};
}
export async function ownerAccountView(viewId:string){
 const actor=await ownerAccountActor();
 const value=await db<unknown>('rpc/icash_owner_account_view','POST',{p_actor:actor.userId,p_session:actor.sessionId,p_view:viewId});
 if(!value)throw new OwnerViewError(410,'This account view has ended. Open the account again from Accounts.');
 const view=ownerViewSchema.parse(value);
 if(view.id!==viewId||Date.parse(view.expiresAt)<=Date.now())throw new OwnerViewError(410,'This account view has expired. Open it again from Accounts.');
 return {actor,view};
}
export function ownerViewFailure(error:unknown){
 if(error instanceof OwnerViewError)return Response.json({error:error.message},{status:error.status,headers:ownerViewHeaders});
 if(error instanceof Error&&error.message==='DASHBOARD_PASSWORD_REQUIRED')return Response.json({error:'Unlock your admin dashboard to view accounts.'},{status:403,headers:ownerViewHeaders});
 return Response.json({error:'Account information could not load. Refresh and try again.'},{status:503,headers:ownerViewHeaders});
}
