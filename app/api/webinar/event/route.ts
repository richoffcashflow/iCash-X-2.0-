import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {eventNames} from '@/lib/webinar-policy';
import {webinarBody,webinarError,webinarHeaders,webinarLimit,webinarOrigin,webinarSession} from '@/lib/webinar-server';
export async function POST(req:Request){try{
 webinarOrigin(req);const i=z.object({sessionId:z.string().uuid(),seconds:z.number().int().min(0).max(14400),kind:z.enum(eventNames),key:z.string().max(100).default('once')}).strict().parse(await webinarBody(req,1000));
 const {v}=await webinarSession(i.sessionId);await webinarLimit(req,v.id,'event',80,60);
 await db('rpc/icash_webinar_record','POST',{p_visitor:v.id,p_session:i.sessionId,p_seconds:i.seconds,p_kind:i.kind,p_key:i.key});
 return Response.json({saved:true},{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
