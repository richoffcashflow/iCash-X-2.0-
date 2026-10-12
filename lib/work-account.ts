import {currentUser} from '@/lib/account-auth';
import {db} from '@/lib/stripe-test';
import {accountMembership} from '@/lib/membership';
import {membershipAccessible} from '@/lib/membership-policy';
export async function workAccount(options:{allowInactiveMembership?:boolean;requireVip?:boolean}={}){
 const user=await currentUser(true);if(!user)throw new Error('SIGN_IN_REQUIRED');
 const accounts=await db<{id:string;billing_model:string}[]>(`icash_accounts?owner_user_id=eq.${user.id}&select=id,billing_model&limit=2`);
 if(accounts.length!==1)throw new Error('ACCOUNT_REQUIRED');
 const account=accounts[0];
 const membership=options.requireVip||!options.allowInactiveMembership&&account.billing_model==='membership_credits'?await accountMembership(account.id):null;
 if(!options.allowInactiveMembership&&account.billing_model==='membership_credits'&&!membershipAccessible(membership))throw new Error('SUBSCRIPTION_REQUIRED');
 if(options.requireVip&&await db<boolean>('rpc/icash_vip_features_active','POST',{p_account:account.id})!==true)throw new Error('VIP_REQUIRED');
 return {accountId:account.id,userId:user.id};
}
