import {reconcileAutoRecharge} from '@/lib/auto-recharge';
import {NextResponse} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
import {db} from '@/lib/stripe-test';
import {fundingMode} from '@/lib/funding-policy';
import {fundingStripe} from '@/lib/funding';
import {stopDaily,reconcileDailyInvoices,reconcileDailyCheckout,type DailyPlan} from '@/lib/daily-billing';
import {stopMembership,type Membership} from '@/lib/membership';
export const dynamic='force-dynamic';
export async function GET(req:Request){const expected=`Bearer ${process.env.CRON_SECRET??''}`,actual=req.headers.get('authorization')??'';if(!process.env.CRON_SECRET||actual.length!==expected.length||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return NextResponse.json({error:'Unauthorized'},{status:401});
 await db('rpc/icash_settle_pending_estimates','POST',{p_account:null,p_limit:100});
 const mode=fundingMode(),deadline=Date.now()+45_000;
 const cancellations=await db<Membership[]>(`icash_memberships?mode=eq.${mode}&state=eq.cancel_requested&order=updated_at.asc&limit=10`);
 let cancellationChecked=0,cancellationFailed=0;
 for(const membership of cancellations){if(Date.now()>=deadline)break;cancellationChecked++;try{await stopMembership(membership);}catch{cancellationFailed++;}}
 // Reserve capacity for active billing while also recovering paid history after Stop.
 const [active,stopped,recent]=await Promise.all([
  db<DailyPlan[]>(`icash_daily_plans?mode=eq.${mode}&state=neq.stopped&order=reconciled_at.asc.nullsfirst&limit=80`),
  db<DailyPlan[]>(`icash_daily_plans?mode=eq.${mode}&state=eq.stopped&stripe_subscription_id=not.is.null&order=reconciled_at.asc.nullsfirst&limit=20`),
  db<{state:string}[]>(`icash_daily_plans?mode=eq.${mode}&reconciled_at=not.is.null&select=state&order=reconciled_at.desc&limit=1`)
 ]);
 // Alternate the leading group after a cutoff, including when one slow plan used the run.
 const [first,second]=recent[0]&&recent[0].state!=='stopped'?[stopped,active]:[active,stopped];
 const plans=first.flatMap((plan,index)=>[plan,...(index<second.length?[second[index]]:[])]).concat(second.slice(first.length));let failed=0,historyPending=0,checked=0;
 for(const original of plans){if(Date.now()>=deadline)break;checked++;let p=original;try{
 if(p.state==='stop_requested'){await stopDaily(p);continue;}
 if(p.state==='pending'){
  p=await reconcileDailyCheckout(p);
  if(p.state==='pending'){
   if(p.stripe_session_id){const session=await fundingStripe().checkout.sessions.retrieve(p.stripe_session_id);if(session.status==='expired')await stopDaily(p);}
   continue;
  }
 }
 if(p.stripe_subscription_id){const result=await reconcileDailyInvoices(p,deadline);if(result.historyPending)historyPending++;}
 }catch{failed++;}finally{await db(`icash_daily_plans?id=eq.${p.id}`,'PATCH',{reconciled_at:new Date().toISOString()});}}

 const autoRecharge=await reconcileAutoRecharge(deadline);
 return NextResponse.json({autoRecharge,checked,failed,historyPending,deferred:plans.length-checked,cancellationChecked,cancellationFailed,cancellationDeferred:cancellations.length-cancellationChecked},{status:failed||cancellationFailed||autoRecharge.failed?503:200});}
