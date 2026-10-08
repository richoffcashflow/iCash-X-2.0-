import {timingSafeEqual} from 'node:crypto';
import {db} from '@/lib/stripe-test';
import {processMessaging} from '@/lib/messaging-worker';
import {processWebinarFollowups} from '@/lib/webinar-email';
import {dispatchCustomerUpdate} from '@/lib/customer-updates-service';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function GET(req:Request){
 const expected=Buffer.from(`Bearer ${process.env.CRON_SECRET||''}`),got=Buffer.from(req.headers.get('authorization')||'');
 if(!process.env.CRON_SECRET||expected.length!==got.length||!timingSafeEqual(Buffer.from(expected),Buffer.from(got)))return new Response(null,{status:401});
 const result=await processMessaging({database:db,production:process.env.VERCEL_ENV==='production',followups:()=>processWebinarFollowups(),customerUpdate:account=>dispatchCustomerUpdate(account,{db})});
 return Response.json(result,{headers:{'Cache-Control':'no-store'}});
}
