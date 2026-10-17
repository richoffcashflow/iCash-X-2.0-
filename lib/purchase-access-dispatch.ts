import {after} from 'next/server';
import {db} from '@/lib/stripe-test';
import {processPurchaseAccessEmails} from '@/lib/purchase-access-email';
import {processPurchaseAccessFollowups} from '@/lib/purchase-access-followups';
/** Settlement already persisted the email before this immediate wake-up. */
export function schedulePurchaseAccessEmail(membershipId?:string){
 if(process.env.VERCEL_ENV!=='production')return;
 after(async()=>{const results=await Promise.allSettled([processPurchaseAccessEmails({db,membershipId,limit:membershipId?1:5}),processPurchaseAccessFollowups({db,membershipId,limit:membershipId?1:3})]);if(results.some(r=>r.status==='rejected'))console.warn('[purchase-access]',{status:'maintenance_retry_pending'});});
}
