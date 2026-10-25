import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {webinarBody,webinarError,webinarHeaders,webinarLimit,webinarOrigin,webinarSession,WebinarError} from '@/lib/webinar-server';
import {webinarChatScope,sharedChatFields,publicChatMessage,type SharedChatRow} from '@/lib/webinar-shared-chat';

export async function POST(req:Request){try{
 webinarOrigin(req);
 const input=z.object({sessionId:z.guid()}).strict().safeParse(await webinarBody(req,200));
 if(!input.success)throw new WebinarError(400,'A valid session is required.');
 const {v,s}=await webinarSession(input.data.sessionId,true);
 await webinarLimit(req,v.id,'chat-feed',30,60);
 if(s.superseded_at)return Response.json({messages:[],statuses:[]},{headers:webinarHeaders});
 const [shared,own]=await Promise.all([
  db<SharedChatRow[]>(`icash_webinar_messages?${webinarChatScope(s)}&public_status=eq.approved&role=eq.user&select=${sharedChatFields}&order=created_at.desc&limit=100`),
  db<{id:string;public_status:string}[]>(`icash_webinar_messages?session_id=eq.${s.id}&role=eq.user&select=id,public_status&order=created_at.desc&limit=100`),
 ]);
 return Response.json({messages:shared.reverse().filter(row=>row.session_id!==s.id).map(publicChatMessage),statuses:own},{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
