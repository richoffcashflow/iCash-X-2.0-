import {NextResponse} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
import {db} from '@/lib/stripe-test';
import {fundingMode} from '@/lib/funding-policy';
import {fundingStripe} from '@/lib/funding';
import {stopDaily,syncDailySubscription,settleDailyInvoice,reconcileDailyCheckout,type DailyPlan} from '@/lib/daily-billing';
export const dynamic='force-dynamic';
export async function GET(req:Request){const expected=`Bearer ${process.env.CRON_SECRET??''}`,actual=req.headers.get('authorization')??'';if(!process.env.CRON_SECRET||actual.length!==expected.length||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return NextResponse.json({error:'Unauthorized'},{status:401});
 await db('rpc/icash_settle_pending_estimates','POST',{p_account:null,p_limit:100});
 const plans=await db<DailyPlan[]>(`icash_daily_plans?mode=eq.${fundingMode()}&state=neq.stopped&order=reconciled_at.asc.nullsfirst&limit=100`);let failed=0;
 for(const original of plans){let p=original;try{
 if(p.state==='stop_requested'){await stopDaily(p);continue;}
 if(p.state==='pending'){
  p=await reconcileDailyCheckout(p);
  if(p.state==='pending'){
   if(p.stripe_session_id){const session=await fundingStripe().checkout.sessions.retrieve(p.stripe_session_id);if(session.status==='expired')await stopDaily(p);}
   continue;
  }
 }
 if(p.stripe_subscription_id){const stripe=fundingStripe();const sub=await stripe.subscriptions.retrieve(p.stripe_subscription_id);await syncDailySubscription(sub);const inv=typeof sub.latest_invoice==='string'?sub.latest_invoice:sub.latest_invoice?.id;if(inv&&sub.status==='active')await settleDailyInvoice(inv);}
 }catch{failed++;}finally{await db(`icash_daily_plans?id=eq.${p.id}`,'PATCH',{reconciled_at:new Date().toISOString()});}}

 return NextResponse.json({checked:plans.length,failed},{status:failed?503:200});}
