import {currentUser} from '@/lib/account-auth';
import {db} from '@/lib/stripe-test';
import {fundingMode} from '@/lib/funding-policy';
/** Explicit, expiring operator authorization for a one-time live checkout only. */
export async function privatePaymentCheckAllowed(){
 if(fundingMode()!=='live'||!process.env.STRIPE_WEBHOOK_SECRET||process.env.ICASH_AUTH_EMAIL_READY!=='true')return false;
 try{const u=await currentUser();if(!u)return false;
 const rows=await db<{user_id:string}[]>(`icash_payment_test_access?user_id=eq.${u.id}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=user_id&limit=1`);
 return rows.length===1;
 }catch{return false;}
}
