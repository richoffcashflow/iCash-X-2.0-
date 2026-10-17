import {z} from 'zod';
import {after} from 'next/server';
import {db} from '@/lib/stripe-test';
import {processWebinarFollowups} from '@/lib/webinar-email';
import {webinarBody,webinarError,webinarHeaders,webinarLimit,webinarOrigin,webinarSession} from '@/lib/webinar-server';
export const maxDuration=120;
export async function POST(req:Request){try{
 webinarOrigin(req);
 const i=z.object({sessionId:z.string().uuid(),pageId:z.string().uuid(),sequence:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),stage:z.enum(['webinar','checkout','vip']),state:z.enum(['active','left','handoff','payment'])}).strict().parse(await webinarBody(req,500));
 const {v,s}=await webinarSession(i.sessionId);await webinarLimit(req,v.id,'presence',60,60);
 if(!s.is_preview){const saved=await db<boolean>('rpc/icash_webinar_record_presence','POST',{p_visitor:v.id,p_session:s.id,p_page:i.pageId,p_sequence:i.sequence,p_stage:i.stage,p_state:i.state});
  if(saved&&i.state==='left')after(async()=>{try{await processWebinarFollowups({visitorId:v.id});}catch{/* Durable queue remains available to the minute worker. */}});
 }
 return Response.json({saved:true},{headers:webinarHeaders});
}catch(e){return webinarError(e);}}
