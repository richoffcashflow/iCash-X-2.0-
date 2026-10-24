import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {webinarBody,webinarError,webinarHeaders,webinarOrigin,webinarOwner,WebinarError} from '@/lib/webinar-server';

export async function GET(req:Request){try{
 await webinarOwner();
 const q=Object.fromEntries(new URL(req.url).searchParams);
 const parsed=z.object({webinarId:z.guid(),version:z.enum(['day','night']),status:z.enum(['pending','approved','hidden']),preview:z.enum(['true','false']).default('false'),before:z.string().datetime().optional()}).strict().safeParse(q);
 if(!parsed.success)throw new WebinarError(400,'Choose a webinar and chat filter.');
 const i=parsed.data;
 const messages=await db(`icash_webinar_messages?webinar_id=eq.${i.webinarId}&recording_version=eq.${i.version}&public_status=eq.${i.status}&is_preview=eq.${i.preview}${i.before?`&created_at=lt.${encodeURIComponent(i.before)}`:''}&select=id,text,display_name,playback_seconds,public_status,created_at,webinar_revision&order=created_at.desc,id.desc&limit=50`);
 return Response.json({messages},{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}

export async function PATCH(req:Request){try{
 webinarOrigin(req);await webinarOwner();
 const parsed=z.object({id:z.guid(),action:z.enum(['approve','hide'])}).strict().safeParse(await webinarBody(req,300));
 if(!parsed.success)throw new WebinarError(400,'Choose a message and moderation action.');
 const i=parsed.data;
 const messages=await db<{id:string;public_status:string}[]>(`icash_webinar_messages?id=eq.${i.id}&public_status=in.(pending,approved,hidden)&role=eq.user&select=id,public_status`,'PATCH',{public_status:i.action==='approve'?'approved':'hidden',moderated_at:new Date().toISOString()});
 if(!messages.length)throw new WebinarError(404,'This message cannot be shared.');
 return Response.json({message:messages[0]},{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
