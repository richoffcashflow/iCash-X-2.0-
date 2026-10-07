import {db} from '@/lib/stripe-test';
import {webinarToken,webinarLimit,webinarHeaders} from '@/lib/webinar-server';
import {webinarLink} from '@/lib/webinar-links';
import {webinarSite} from '@/lib/webinar-site';
export const dynamic='force-dynamic';
/** Random 122-bit outbox ID is a short resume capability, never account authentication. */
export async function GET(req:Request,{params}:{params:Promise<{token:string}>}){
 const {token}=await params;const destination=new URL(webinarSite.viewerPath,req.url);
 if(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token))try{
  await webinarLimit(req,token,'followup-link',60,60);
  const [job]=await db<{visitor_id:string;session_id:string}[]>(`icash_webinar_outbox?id=eq.${token}&created_at=gte.${encodeURIComponent(new Date(Date.now()-7*86400000).toISOString())}&select=visitor_id,session_id&limit=1`);
  if(job){
   const [session]=await db<{webinar_id:string}[]>(`icash_webinar_sessions?id=eq.${job.session_id}&visitor_id=eq.${job.visitor_id}&is_preview=eq.false&select=webinar_id&limit=1`);
   if(session){const [webinar]=await db<{public_code:number}[]>(`icash_webinars?id=eq.${session.webinar_id}&select=public_code&limit=1`);if(webinar)destination.pathname=webinarLink({publicCode:String(webinar.public_code)});}
   destination.searchParams.set('r',webinarToken(job.visitor_id,'resume',3600));
  }
 }catch{return new Response('Your link could not open. Please refresh to try again.',{status:503,headers:webinarHeaders});}
 return new Response(null,{status:302,headers:{...webinarHeaders,Location:destination.href}});
}
