import {db} from '@/lib/stripe-test';
import {ownerAccountActor,ownerAccountView,OwnerViewError} from '@/lib/owner-account-access';
export type OwnerContact={accountId:string;userId:string;sessionId:string;viewId:string};
export async function ownerContactAccess(viewId:string,requireEnabled=true):Promise<OwnerContact>{
 const {actor,view}=await ownerAccountView(viewId);
 if(requireEnabled&&await db<boolean>('rpc/icash_owner_contact_actions_enabled','POST',{})!==true)throw new OwnerViewError(409,'Contact controls are being updated. Your saved conversations are available.');
 return {accountId:view.account.id,userId:actor.userId,sessionId:actor.sessionId,viewId};
}
export async function ownerContactAction<T>(access:OwnerContact,action:string,request:Record<string,unknown>):Promise<T>{
 return db<T>('rpc/icash_owner_contact_action','POST',{p_actor:access.userId,p_session:access.sessionId,p_view:access.viewId,p_account:access.accountId,p_action:action,p_request:request});
}
export async function ownerContactEndAccess(viewId:string,callId:string):Promise<OwnerContact>{
 const actor=await ownerAccountActor();
 const accountId=await db<string|null>('rpc/icash_owner_contact_end_account','POST',{p_actor:actor.userId,p_session:actor.sessionId,p_view:viewId,p_call:callId});
 if(!accountId)throw new OwnerViewError(403,'This call is not linked to your owner session.');
 return {accountId,userId:actor.userId,sessionId:actor.sessionId,viewId};
}
