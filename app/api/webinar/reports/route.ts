import {db} from '@/lib/stripe-test';
import {reportQuery,validWebinarReport} from '@/lib/webinar-reporting';
import {webinarOwner,webinarHeaders,webinarError,WebinarError} from '@/lib/webinar-server';
export const dynamic='force-dynamic';
export async function GET(req:Request){try{
 await webinarOwner();const input=reportQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
 if(!input.success)throw new WebinarError(400,'Choose Today, Yesterday, 7 or 30 days and a valid timezone.');
 const report=await db<unknown>('rpc/icash_webinar_report_with_funnel','POST',{p_period:input.data.period,p_timezone:input.data.timezone},req.signal);
 if(!validWebinarReport(report,input.data.period,input.data.timezone)||!report.conversionFunnel)throw new WebinarError(503,'Results are temporarily unavailable. Please refresh.');
 return Response.json(report,{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
