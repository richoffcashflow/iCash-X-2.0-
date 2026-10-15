import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {webinarBody,webinarError,webinarHeaders,webinarLimit,webinarOrigin,webinarSession,WebinarError} from '@/lib/webinar-server';
export async function POST(req:Request){try{
 webinarOrigin(req);const i=z.object({sessionId:z.string().uuid(),text:z.string().trim().min(1).max(1200),seconds:z.number().int().min(0).max(14400).optional(),share:z.boolean().optional()}).strict().parse(await webinarBody(req,2500));
 const {v,s}=await webinarSession(i.sessionId);
 const displayName=v.name?.trim()||(s.config.parentWebinarId?'Member':'');
 if(!displayName)throw new WebinarError(400,'Add your name before sending a message.');
 await webinarLimit(req,v.id,'chat',6,60);await webinarLimit(req,v.id,'chat-daily',40,86400);
 const messages=await db<{id:string;role:string;text:string}[]>('icash_webinar_messages','POST',[{session_id:s.id,role:'user',text:i.text,playback_seconds:Math.min(i.seconds??s.progress_seconds,s.config.durationSeconds),...(i.share?{public_status:'pending',display_name:displayName.slice(0,60),webinar_id:s.webinar_id,webinar_revision:s.revision,recording_version:s.config.recordingVersion==='night'?'night':'day',is_preview:s.is_preview}:{})}]);
 return Response.json({messages,ai:false},{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
