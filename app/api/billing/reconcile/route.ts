import {NextResponse} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
import {db} from '@/lib/stripe-test';
import {fundingMode} from '@/lib/funding-policy';
import {fundingStripe} from '@/lib/funding';
import {stopDaily,syncDailySubscription,settleDailyInvoice,type DailyPlan} from '@/lib/daily-billing';
export const dynamic='force-dynamic';
export async function GET(req:Request){const expected=`Bearer ${process.env.CRON_SECRET??''}`,actual=req.headers.get('authorization')??'';if(!process.env.CRON_SECRET||actual.length!==expected.length||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return NextResponse.json({error:'Unauthorized'},{status:401});
 const plans=await db<DailyPlan[]>(`icash_daily_plans?mode=eq.${fundingMode()}&state=neq.stopped&order=reconciled_at.asc.nullsfirst&limit=100`);let failed=0;
 for(const p of plans){try{if(p.state==='stop_requested'){await stopDaily(p);continue;}if(!p.stripe_subscription_id&&p.stripe_session_id){const stripe=fundingStripe();const session=await stripe.checkout.sessions.retrieve(p.stripe_session_id);const sid=typeof session.subscription==='string'?session.subscription:session.subscription?.id;if(sid)p.stripe_subscription_id=sid;else if(session.status==='expired')await stopDaily(p);}
 if(p.stripe_subscription_id){const stripe=fundingStripe();const sub=await stripe.subscriptions.retrieve(p.stripe_subscription_id);await syncDailySubscription(sub);const inv=typeof sub.latest_invoice==='string'?sub.latest_invoice:sub.latest_invoice?.id;if(inv&&sub.status==='active')await settleDailyInvoice(inv);}}catch{failed++;}finally{await db(`icash_daily_plans?id=eq.${p.id}`,'PATCH',{reconciled_at:new Date().toISOString()});}}
 return NextResponse.json({checked:plans.length,failed},{status:failed?503:200});}
