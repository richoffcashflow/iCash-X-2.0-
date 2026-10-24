import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {webinarBody,webinarError,webinarHeaders,webinarLimit,webinarOrigin,webinarSession} from '@/lib/webinar-server';
export async function POST(req:Request){try{
 webinarOrigin(req);
 // Older open tabs may still submit the removed reminder form. Never enroll it.
 const i=z.object({sessionId:z.guid(),name:z.string().trim().min(1).max(80),onlyName:z.boolean().default(false)}).parse(await webinarBody(req,2000));
 const {v}=await webinarSession(i.sessionId);await webinarLimit(req,v.id,'contact',8,600);
 if(!i.onlyName)return Response.json({error:'Webinar reminders are no longer available.'},{status:410,headers:webinarHeaders});
 await db(`icash_webinar_visitors?id=eq.${v.id}`,'PATCH',{name:i.name});
 return Response.json({saved:true,name:i.name,contactSaved:false},{headers:webinarHeaders});
 }catch(e){if(e instanceof z.ZodError)return Response.json({error:'Check your name, then try again.'},{status:400,headers:webinarHeaders});return webinarError(e);}}
