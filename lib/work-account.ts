import {currentUser} from '@/lib/account-auth';
import {db} from '@/lib/stripe-test';
import {accountMembership} from '@/lib/membership';
import {membershipAccessible} from '@/lib/membership-policy';
export async function workAccount(options:{allowInactiveMembership?:boolean}={}){
 const user=await currentUser(true);if(!user)throw new Error('SIGN_IN_REQUIRED');
 const accounts=await db<{id:string;billing_model:string}[]>(`icash_accounts?owner_user_id=eq.${user.id}&select=id,billing_model&limit=2`);
 if(accounts.length!==1)throw new Error('ACCOUNT_REQUIRED');
 const account=accounts[0];
 if(!options.allowInactiveMembership&&account.billing_model==='membership_credits'&&!membershipAccessible(await accountMembership(account.id)))throw new Error('SUBSCRIPTION_REQUIRED');
 return {accountId:account.id,userId:user.id};
}
