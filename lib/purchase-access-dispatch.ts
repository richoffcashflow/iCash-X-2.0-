import {after} from 'next/server';
import {db} from '@/lib/stripe-test';
import {processPurchaseAccessEmails} from '@/lib/purchase-access-email';
/** Settlement already persisted the email before this immediate wake-up. */
export function schedulePurchaseAccessEmail(membershipId?:string){
 if(process.env.VERCEL_ENV!=='production')return;
 after(async()=>{try{await processPurchaseAccessEmails({db,membershipId,limit:membershipId?1:5});}catch{console.warn('[purchase-email]',{status:'maintenance_retry_pending'});}});
}
