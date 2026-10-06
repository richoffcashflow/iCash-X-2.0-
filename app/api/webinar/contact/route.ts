import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {webinarConsentVersion} from '@/lib/webinar-policy';
import {webinarBody,webinarError,webinarHeaders,webinarLimit,webinarOrigin,webinarSession} from '@/lib/webinar-server';
export async function POST(req:Request){try{
 webinarOrigin(req);const i=z.object({sessionId:z.string().uuid(),name:z.string().trim().min(1).max(80),email:z.string().trim().email().max(254).or(z.literal('')),phone:z.string().regex(/^\+?[\d ()-]{7,25}$/).or(z.literal('')),consent:z.boolean(),version:z.literal(webinarConsentVersion),onlyName:z.boolean().default(false)}).strict().parse(await webinarBody(req,2000));
 const {v,s}=await webinarSession(i.sessionId);await webinarLimit(req,v.id,'contact',8,600);
 if(i.onlyName)await db(`icash_webinar_visitors?id=eq.${v.id}`,'PATCH',{name:i.name});
 else await db('rpc/icash_webinar_contact','POST',{p_visitor:v.id,p_name:i.name,p_email:i.email,p_phone:i.phone,p_consent:i.consent&&!s.is_preview});
 return Response.json({saved:true,name:i.name,contactSaved:!!i.email&&!!i.phone},{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
