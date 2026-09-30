import {currentUser} from '@/lib/account-auth';
import {db} from '@/lib/stripe-test';

/** Membership is separately provisioned. Customer metadata and email never grant access. */
export async function requireTrustedOperator(scope:'support'|'authority_review'='support'):Promise<{userId:string}>{
 const user=await currentUser(true);if(!user)throw new Error('SIGN_IN_REQUIRED');
 const [operator]=await db<{expires_at:string;revoked_at:string|null;scopes:string[]}[]>(`icash_trusted_operators?user_id=eq.${encodeURIComponent(user.id)}&select=expires_at,revoked_at,scopes&limit=1`);
 if(!operator||!operator.scopes?.includes(scope)||operator.revoked_at||!(Date.parse(operator.expires_at)>Date.now()))throw new Error('OPERATOR_REQUIRED');
 return {userId:user.id};
}
