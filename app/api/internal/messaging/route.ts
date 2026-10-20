import {timingSafeEqual} from 'node:crypto';
import {db} from '@/lib/stripe-test';
import {processMessaging} from '@/lib/messaging-worker';
import {processWebinarFollowups} from '@/lib/webinar-email';
import {dispatchCustomerUpdate} from '@/lib/customer-updates-service';
import {processCancellationNotices} from '@/lib/cancellation-notice-service';
import {dispatchTextMessage} from '@/lib/text-message-service';
import {dispatchDealEmail} from '@/lib/deal-email-service';
import {dispatchLiveVoice} from '@/lib/live-dispatch-service';
import {processLegacyLaunch} from '@/lib/legacy-launch-worker';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function GET(req:Request){
 const expected=Buffer.from(`Bearer ${process.env.CRON_SECRET||''}`),got=Buffer.from(req.headers.get('authorization')||'');
 if(!process.env.CRON_SECRET||expected.length!==got.length||!timingSafeEqual(Buffer.from(expected),Buffer.from(got)))return new Response(null,{status:401});
 const [result,cancellations,legacyLaunch]=await Promise.allSettled([
  processMessaging({database:db,production:process.env.VERCEL_ENV==='production',followups:()=>processWebinarFollowups(),customerUpdate:account=>dispatchCustomerUpdate(account,{db})}),
  process.env.VERCEL_ENV==='production'?processCancellationNotices({db,text:dispatchTextMessage,email:dispatchDealEmail,voice:dispatchLiveVoice}):Promise.resolve({status:'disabled'}),
  processLegacyLaunch({database:db})
 ]);
 return Response.json({...(result.status==='fulfilled'?result.value:{unavailable:true}),cancellations:cancellations.status==='fulfilled'?cancellations.value:{unavailable:true},legacyLaunch:legacyLaunch.status==='fulfilled'?legacyLaunch.value:{unavailable:true}},{headers:{'Cache-Control':'no-store'}});
}
