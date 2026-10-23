import {currentUser} from '@/lib/account-auth';
import {db} from '@/lib/stripe-test';
import {accountMembership} from '@/lib/membership';
import {membershipAccessible} from '@/lib/membership-policy';
import {workspaceAcknowledgmentCurrent,type WorkspaceAcknowledgmentRecord} from './workspace-acknowledgment.ts';
export async function workAccount(options:{allowInactiveMembership?:boolean;requireVip?:boolean;allowUnacknowledged?:boolean;signal?:AbortSignal}={}){
 const user=await currentUser(true,options.signal);if(!user)throw new Error('SIGN_IN_REQUIRED');
 const accounts=await db<({id:string;billing_model:string}&WorkspaceAcknowledgmentRecord)[]>(`icash_accounts?owner_user_id=eq.${user.id}&select=id,billing_model,workspace_ack_version,workspace_ack_user_id,workspace_ack_hash&limit=2`,'GET',undefined,options.signal);
 if(accounts.length!==1)throw new Error('ACCOUNT_REQUIRED');
 const account=accounts[0];
 if(!options.allowUnacknowledged&&!workspaceAcknowledgmentCurrent(account,user.id))throw new Error('WORKSPACE_ACKNOWLEDGMENT_REQUIRED');
 const membership=options.requireVip||!options.allowInactiveMembership&&account.billing_model==='membership_credits'?await accountMembership(account.id,options.signal):null;
 if(!options.allowInactiveMembership&&account.billing_model==='membership_credits'&&!membershipAccessible(membership))throw new Error('SUBSCRIPTION_REQUIRED');
 if(options.requireVip&&await db<boolean>('rpc/icash_vip_features_active','POST',{p_account:account.id},options.signal)!==true)throw new Error('VIP_REQUIRED');
 return {accountId:account.id,userId:user.id};
}
