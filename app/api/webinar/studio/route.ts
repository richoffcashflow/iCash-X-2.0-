import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {webinarSchema,settingsSchema,webinarOffers,webinarPitchAt,type Webinar,type WebinarSettings} from '@/lib/webinar-policy';
import {webinarBody,webinarError,webinarHeaders,webinarOrigin,webinarOwner,WebinarError} from '@/lib/webinar-server';
import {checkoutPublishableKey} from '@/lib/embedded-checkout-policy';
import {fundingMode} from '@/lib/funding-policy';
import {metaReady} from '@/lib/webinar-meta';
export const dynamic='force-dynamic';
export async function GET(){try{
 await webinarOwner();const [webinars,settings,stats,performance,metaHealth]=await Promise.all([db<{config:Webinar}[]>('icash_webinars?select=config&order=updated_at.desc&limit=100'),db<{config:WebinarSettings}[]>('icash_webinar_settings?id=eq.1&select=config'),db('rpc/icash_webinar_stats','POST',{}),db('rpc/icash_webinar_performance','POST',{}),db('rpc/icash_webinar_meta_health','POST',{})]);
 return Response.json({webinars:webinars.map(r=>webinarSchema.parse(r.config)),settings:settingsSchema.parse(settings[0].config),stats,performance,metaHealth,metaReady:metaReady(),embeddedCheckoutReady:!!checkoutPublishableKey(fundingMode()),aiReady:!!process.env.OPENAI_API_KEY&&!!(process.env.ICASH_WEBINAR_AI_MODEL||process.env.ICASH_SUPPORT_AI_MODEL),emailReady:!!process.env.RESEND_API_KEY&&!!process.env.ICASH_APP_ORIGIN&&!!process.env.ICASH_WEBINAR_EMAIL_WEBHOOK_SECRET},{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
export async function POST(req:Request){try{
 webinarOrigin(req);await webinarOwner();const body=await webinarBody(req,800000);
 if(body.action==='settings'){
 const config=settingsSchema.parse(body.settings);if(config.enabled&&(!config.fromEmail||!config.postalAddress.trim()||!process.env.RESEND_API_KEY||!process.env.ICASH_WEBINAR_EMAIL_WEBHOOK_SECRET))throw new WebinarError(400,'Add your verified sender, mailing address and delivery connection before enabling reminders.');
 if(config.meta.enabled&&(!config.meta.pixelId||!metaReady()))throw new WebinarError(400,'Add your Meta Pixel ID and server connection before enabling measurement.');
 await db('icash_webinar_settings?id=eq.1','PATCH',{config,updated_at:new Date().toISOString()});return Response.json({saved:true},{headers:webinarHeaders});}
 const input=z.object({action:z.literal('save'),webinar:webinarSchema,isNew:z.boolean()}).strict().parse(body);
 const config={...input.webinar,pitchAt:webinarPitchAt(input.webinar),revision:input.isNew?1:input.webinar.revision+1};
 if(config.status==='published'&&webinarOffers(config).every(o=>o.expiresAt&&Date.parse(o.expiresAt)<=Date.now()))throw new WebinarError(400,'Every offer has expired. Update a deadline or add an evergreen offer before publishing.');
 const rows=input.isNew?await db('icash_webinars','POST',{id:config.id,revision:config.revision,config}):await db<unknown[]>(`icash_webinars?id=eq.${config.id}&revision=eq.${input.webinar.revision}`,'PATCH',{revision:config.revision,config,updated_at:new Date().toISOString()});
 if(!input.isNew&&!(rows as unknown[]).length)throw new WebinarError(409,'This session changed in another tab. Reload before saving.');
 return Response.json({webinar:config},{headers:webinarHeaders});
 }catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(x=>`${x.path.join('.')}: ${x.message}`).slice(0,3).join(' ')},{status:400,headers:webinarHeaders});return webinarError(e);}}
