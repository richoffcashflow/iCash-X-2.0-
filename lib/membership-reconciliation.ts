import {reconcileVipChanges} from '@/lib/vip-membership';
import {db} from '@/lib/stripe-test';
import {fundingStripe} from '@/lib/funding';
import {fundingMode} from '@/lib/funding-policy';
import {reconcileMembershipCheckout,settleMembershipInvoice,syncMembershipSubscription,type Membership} from '@/lib/membership';

/** Recover access after a missed webhook, and finish explicitly requested plan changes.
 * This never creates a new payment, clears review holds, or grants work credits.
 * Existing canonical invoice verification and idempotent settlement remain the
 * only authority for paid-through dates. Older invoice history is not backfilled.
 */
export async function reconcileMemberships(deadline:number){
 const mode=fundingMode();
 if(!mode)return {checked:0,failed:0,deferred:0};
 const rows=await db<Membership[]>(`icash_memberships?mode=eq.${mode}&state=in.(pending,active,payment_failed,needs_review)&or=(stripe_subscription_id.not.is.null,stripe_session_id.not.is.null)&order=updated_at.asc,id.asc&limit=10&select=*`);
 let checked=0,failed=0;
 for(const original of rows){
  if(Date.now()>=deadline)break;
  checked++;
  try{
   let m=original;
   await reconcileVipChanges(m.id);
   if(!m.stripe_subscription_id){m=await reconcileMembershipCheckout(m);}
   if(m.stripe_subscription_id){
    const stripe=fundingStripe();
    const sub=await stripe.subscriptions.retrieve(m.stripe_subscription_id);
    // Verify the subscription's stored binding before considering its invoices.
    if(sub.metadata.icash_membership!==m.id||!await syncMembershipSubscription(sub))throw Error('Membership recovery binding mismatch');
    const paid=await stripe.invoices.list({subscription:sub.id,status:'paid',limit:1});
    if(paid.data[0])await settleMembershipInvoice(paid.data[0].id);
   }
  }catch{failed++;}
  finally{
   // Rotate failed/pending rows too, so one bad record cannot starve customers.
   // Do not write state from the stale snapshot: cancellation wins concurrently.
   try{await db(`icash_memberships?id=eq.${original.id}&mode=eq.${mode}`,'PATCH',{updated_at:new Date().toISOString()});}catch{failed++;}
  }
 }
 return {checked,failed,deferred:rows.length-checked};
}
