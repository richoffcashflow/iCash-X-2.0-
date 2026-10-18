import {after} from 'next/server';
import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {processWebinarFollowups} from '@/lib/webinar-email';
import {webinarBody,webinarError,webinarHeaders,webinarLimit,webinarOrigin,webinarSession} from '@/lib/webinar-server';
export const maxDuration=120;
export async function POST(req:Request){try{
 webinarOrigin(req);
 const i=z.object({sessionId:z.string().uuid(),pageId:z.string().uuid(),sequence:z.number().int().min(1).max(2147483647),state:z.enum(['active','left','checkout'])}).strict().parse(await webinarBody(req,600));
 const {v,s}=await webinarSession(i.sessionId);await webinarLimit(req,v.id,'recovery',40,60);
 if(s.is_preview||s.superseded_at||s.config.parentWebinarId)return Response.json({saved:false},{headers:webinarHeaders});
 const queued=await db<boolean>('rpc/icash_webinar_recovery_signal','POST',{p_visitor:v.id,p_session:s.id,p_page:i.pageId,p_sequence:i.sequence,p_state:i.state});
 if(queued)after(async()=>{
  // The durable queue survives closing the tab. A refresh/quick return can cancel
  // during this short grace; final authorization checks presence again.
  await new Promise(resolve=>setTimeout(resolve,5500));
  try{await processWebinarFollowups();}catch{console.error('Webinar departure dispatch deferred to the durable messaging worker');}
 });
 return Response.json({saved:true},{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
