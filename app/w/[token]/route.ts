import {cookies} from 'next/headers';
import {randomBytes} from 'node:crypto';
import {db,guestHash} from '@/lib/stripe-test';
import {validGuest} from '@/lib/funding';
import {webinarToken,webinarLimit,webinarHeaders,webinarVisitor,webinarPaid} from '@/lib/webinar-server';
import {settingsSchema,type WebinarSettings} from '@/lib/webinar-policy';
import {resolveCampaignTarget} from '@/lib/webinar-campaign-server';
import type {CampaignDestination} from '@/lib/webinar-campaign';
import {webinarLink} from '@/lib/webinar-links';
import {webinarSite} from '@/lib/webinar-site';
export const dynamic='force-dynamic';
/** An unguessable reminder link restores webinar context, never software account access. */
export async function GET(req:Request,{params}:{params:Promise<{token:string}>}){
 const {token}=await params;const destination=new URL(webinarSite.viewerPath,req.url);
 if(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token))try{
  await webinarLimit(req,token,'followup-link',60,60);
  const since=encodeURIComponent(new Date(Date.now()-30*86400000).toISOString());
  const [job]=await db<{visitor_id:string;session_id:string;campaign_id:string|null;destination:CampaignDestination}[]>(`icash_webinar_outbox?id=eq.${token}&or=(sent_at.gte.${since},first_attempt_at.gte.${since})&select=visitor_id,session_id,campaign_id,destination&limit=1`);
  if(job){
   const [session]=await db<{webinar_id:string}[]>(`icash_webinar_sessions?id=eq.${job.session_id}&visitor_id=eq.${job.visitor_id}&is_preview=eq.false&select=webinar_id&limit=1`);
   if(job.campaign_id&&session){
    const v=await webinarVisitor(true,webinarToken(job.visitor_id,'resume',3600));
    if(await webinarPaid(v))destination.pathname=webinarSite.workspacePath;
    else{
     const [row]=await db<{config:WebinarSettings}[]>('icash_webinar_settings?id=eq.1&select=config');
     const target=await resolveCampaignTarget(v.id,session.webinar_id,job.destination,v.timezone,settingsSchema.parse(row.config));
     destination.pathname=target.path;
     if(target.phase==='checkout'){
      // A new device gets a new checkout identity, never another device's payment session.
      const jar=await cookies();let guest=jar.get('icash_funding_guest')?.value;
      if(!validGuest(guest)){guest=randomBytes(32).toString('hex');jar.set('icash_funding_guest',guest,{httpOnly:true,secure:process.env.NODE_ENV!=='development',sameSite:'lax',path:'/',maxAge:86400*30});}
      await db(`icash_webinar_visitors?id=eq.${v.id}`,'PATCH',{funding_guest_hash:guestHash(guest)});
      if(target.sessionId)destination.searchParams.set('webinar_session',target.sessionId);
     }else destination.searchParams.set('r',webinarToken(v.id,'resume',3600));
    }
   }else{
    if(session){const [webinar]=await db<{public_code:number}[]>(`icash_webinars?id=eq.${session.webinar_id}&select=public_code&limit=1`);if(webinar)destination.pathname=webinarLink({publicCode:String(webinar.public_code)});}
    destination.searchParams.set('r',webinarToken(job.visitor_id,'resume',3600));
   }
  }
 }catch{return new Response('Your link could not open. Please refresh to try again.',{status:503,headers:webinarHeaders});}
 return new Response(null,{status:302,headers:{...webinarHeaders,Location:destination.href}});
}
