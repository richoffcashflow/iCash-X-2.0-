import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {webinarBody,webinarError,webinarHeaders,webinarLimit,webinarOrigin,webinarSession} from '@/lib/webinar-server';
export async function POST(req:Request){try{
 webinarOrigin(req);
 const input=z.object({sessionId:z.string().uuid(),tabId:z.string().uuid(),sequence:z.number().int().min(0).max(2147483647),watching:z.boolean()}).strict().parse(await webinarBody(req,500));
 const {v}=await webinarSession(input.sessionId);await webinarLimit(req,v.id,'audience',40,60);
 const result=await db<{count:number|null}>('rpc/icash_webinar_audience','POST',{p_visitor:v.id,p_session:input.sessionId,p_tab:input.tabId,p_sequence:input.sequence,p_watching:input.watching});
 return Response.json(result,{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
