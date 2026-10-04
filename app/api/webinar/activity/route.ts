import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {activitySchema,recentActivity} from '@/lib/webinar-activity';
import {webinarBody,webinarError,webinarHeaders,webinarLimit,webinarOrigin,webinarSession,WebinarError} from '@/lib/webinar-server';

export async function POST(req:Request){try{
 webinarOrigin(req);
 const parsed=z.object({sessionId:z.string().uuid()}).strict().safeParse(await webinarBody(req,200));
 if(!parsed.success)throw new WebinarError(400,'A valid session is required.');
 const {v,s}=await webinarSession(parsed.data.sessionId);
 await webinarLimit(req,v.id,'activity',12,60);
 const serverNow=Date.now();
 if(s.is_preview||s.superseded_at)return Response.json({events:[],serverNow},{headers:webinarHeaders});
 const rows=await db<unknown[]>('rpc/icash_webinar_recent_activity','POST',{p_visitor:v.id,p_session:s.id});
 const events=recentActivity(z.array(activitySchema).max(12).parse(rows),serverNow);
 return Response.json({events,serverNow},{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
