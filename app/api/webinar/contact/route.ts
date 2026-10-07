import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {webinarConsentVersion,webinarSmsConsentVersion} from '@/lib/webinar-policy';
import {webinarBody,webinarError,webinarHeaders,webinarLimit,webinarOrigin,webinarSession,WebinarError} from '@/lib/webinar-server';
export async function POST(req:Request){try{
 webinarOrigin(req);const i=z.object({sessionId:z.string().uuid(),name:z.string().trim().min(1).max(80),email:z.string().trim().email().max(254).or(z.literal('')),phone:z.string().regex(/^\+?[\d ()-]{7,25}$/).or(z.literal('')),consent:z.boolean(),smsConsent:z.boolean().default(false),smsVersion:z.literal(webinarSmsConsentVersion).optional(),version:z.literal(webinarConsentVersion),onlyName:z.boolean().default(false)}).strict().parse(await webinarBody(req,2000));
 const {v,s}=await webinarSession(i.sessionId);await webinarLimit(req,v.id,'contact',8,600);
 if(i.onlyName)await db(`icash_webinar_visitors?id=eq.${v.id}`,'PATCH',{name:i.name});
 else {if(i.consent&&!i.email)throw new WebinarError(400,'Add your email address to receive emails.');const phone=i.phone.replace(/[ ()-]/g,'');if(phone&&!/^([0-9]{10}|1[0-9]{10}|\+[1-9][0-9]{7,14})$/.test(phone))throw new WebinarError(400,'Use a valid phone number including its country code.');if(i.smsConsent&&!phone)throw new WebinarError(400,'Add your phone number to receive texts.');await db('rpc/icash_webinar_contact_followups','POST',{p_visitor:v.id,p_session:s.id,p_name:i.name,p_email:i.email,p_phone:i.phone,p_email_consent:i.consent&&!s.is_preview,p_sms_consent:i.smsConsent&&i.smsVersion===webinarSmsConsentVersion&&!s.is_preview});}
 return Response.json({saved:true,name:i.name,contactSaved:!!i.email&&!!i.phone},{headers:webinarHeaders});
 }catch(e){if(e instanceof z.ZodError)return Response.json({error:'Check your name, email and phone, then try again.'},{status:400,headers:webinarHeaders});return webinarError(e);}}
