import {currentUser} from '@/lib/account-auth';
import {db} from '@/lib/stripe-test';
export async function workAccount(){
 const user=await currentUser(true);if(!user)throw new Error('SIGN_IN_REQUIRED');
 const accounts=await db<{id:string}[]>(`icash_accounts?owner_user_id=eq.${user.id}&select=id&limit=2`);
 if(accounts.length!==1)throw new Error('ACCOUNT_REQUIRED');return {accountId:accounts[0].id,userId:user.id};
}
