import {db} from '@/lib/stripe-test';
import {fundingMode} from '@/lib/funding-policy';
import {reconcileMembershipCheckout,type Membership} from '@/lib/membership';
/** Fixed, idempotent account repair. No model-selected operations or provider retries. */
export async function recoverSupportAccount(accountId:string,userId:string){
 const mode=fundingMode();if(!mode)return;
 const [owner]=await db<{id:string}[]>(`icash_accounts?id=eq.${accountId}&owner_user_id=eq.${userId}&select=id&limit=1`);
 if(!owner)return;
 const memberships=await db<Membership[]>(`icash_memberships?account_id=eq.${accountId}&mode=eq.${mode}&state=in.(pending,active)&order=created_at.desc&select=*&limit=3`);
 for(const membership of memberships){
  if(membership.stripe_session_id)await reconcileMembershipCheckout(membership).catch(()=>undefined);
 }
 // Only verified, settled purchases can be claimed; credits are idempotent.
 await db('rpc/icash_claim_funding','POST',{p_user:userId,p_mode:mode});
}
