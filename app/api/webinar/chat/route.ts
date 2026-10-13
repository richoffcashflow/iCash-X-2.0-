import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {webinarBody,webinarError,webinarHeaders,webinarLimit,webinarOrigin,webinarSession,WebinarError} from '@/lib/webinar-server';
export async function POST(req:Request){try{
 webinarOrigin(req);const i=z.object({sessionId:z.string().uuid(),text:z.string().trim().min(1).max(1200)}).strict().parse(await webinarBody(req,2500));
 const {v,s}=await webinarSession(i.sessionId);
 if(!v.name?.trim())throw new WebinarError(400,'Add your name before sending a message.');
 await webinarLimit(req,v.id,'chat',6,60);await webinarLimit(req,v.id,'chat-daily',40,86400);
 const messages=await db<{id:string;role:string;text:string}[]>('icash_webinar_messages','POST',[{session_id:s.id,role:'user',text:i.text}]);
 return Response.json({messages,ai:false},{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
