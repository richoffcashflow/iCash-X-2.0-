import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {reminderVisitId} from '@/lib/webinar-reminder-server';
import {webinarBody,webinarError,webinarHeaders,webinarLimit,webinarOrigin,webinarVisitor} from '@/lib/webinar-server';
export const dynamic='force-dynamic';
export async function POST(req:Request){try{
 webinarOrigin(req);
 const input=z.discriminatedUnion('action',[
  z.object({action:z.literal('visit')}).strict(),
  z.object({action:z.literal('watch'),sessionId:z.guid()}).strict(),
 ]).parse(await webinarBody(req,500));
 const visit=await reminderVisitId(req);if(!visit)return new Response(null,{status:204,headers:webinarHeaders});
 const visitor=await webinarVisitor();await webinarLimit(req,visitor.id,'reminder-visit',30,60);
 const saved=await db<boolean>('rpc/icash_webinar_confirm_reminder','POST',{p_visit:visit,p_visitor:visitor.id,p_action:input.action,p_session:input.action==='watch'?input.sessionId:null},AbortSignal.timeout(1500));
 return Response.json({saved},{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
