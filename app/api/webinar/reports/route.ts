import {db} from '@/lib/stripe-test';
import {reportQuery} from '@/lib/webinar-reporting';
import {webinarOwner,webinarHeaders,webinarError,WebinarError} from '@/lib/webinar-server';
export const dynamic='force-dynamic';
export async function GET(req:Request){try{
 await webinarOwner();const input=reportQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
 if(!input.success)throw new WebinarError(400,'Choose Today, Yesterday, 7 or 30 days and a valid timezone.');
 const report=await db('rpc/icash_webinar_daily_report','POST',{p_period:input.data.period,p_timezone:input.data.timezone});
 return Response.json(report,{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
