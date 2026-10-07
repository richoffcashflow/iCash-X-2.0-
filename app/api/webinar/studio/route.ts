import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {webinarSchema,settingsSchema,webinarFromRow,newVipWebinar,webinarOffers,webinarPitchAt,type WebinarRow,type WebinarSettings} from '@/lib/webinar-policy';
import {webinarBody,webinarError,webinarHeaders,webinarOrigin,webinarOwner,WebinarError} from '@/lib/webinar-server';
import {checkoutPublishableKey} from '@/lib/embedded-checkout-policy';
import {fundingMode} from '@/lib/funding-policy';
import {webinarFollowupReadiness} from '@/lib/webinar-email';
import {metaReady} from '@/lib/webinar-meta';
export const dynamic='force-dynamic';
export async function GET(){try{
 await webinarOwner();const [webinars,settings,metaHealth,followupStats]=await Promise.all([db<WebinarRow[]>('icash_webinars?select=config,public_code,parent_webinar_id&order=public_code.asc&limit=1000'),db<{config:WebinarSettings}[]>('icash_webinar_settings?id=eq.1&select=config'),db('rpc/icash_webinar_meta_health','POST',{}),db('rpc/icash_webinar_followup_stats','POST',{}).catch(()=>null)]);
 const config=settingsSchema.parse(settings[0].config);config.optimizer.enabled=false;const followupReadiness=webinarFollowupReadiness(config);
 return Response.json({webinars:webinars.map(webinarFromRow),settings:config,followupReadiness,followupStats,metaHealth,metaReady:metaReady(),embeddedCheckoutReady:!!checkoutPublishableKey(fundingMode()),aiReady:!!process.env.OPENAI_API_KEY&&!!(process.env.ICASH_WEBINAR_AI_MODEL||process.env.ICASH_SUPPORT_AI_MODEL),emailReady:followupReadiness.email},{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
export async function POST(req:Request){try{
 webinarOrigin(req);await webinarOwner();const body=await webinarBody(req,800000);
 if(body.action==='settings'){
 const config=settingsSchema.parse(body.settings);config.optimizer.enabled=false;
 if(config.homepageVipId){const [vip]=await db<WebinarRow[]>(`icash_webinars?id=eq.${config.homepageVipId}&parent_webinar_id=not.is.null&select=config,public_code,parent_webinar_id&limit=1`);if(!vip)throw new WebinarError(400,'Choose a saved VIP session for homepage buyers.');}
 if(config.meta.enabled&&(!config.meta.pixelId||!metaReady()))throw new WebinarError(400,'Add your Meta Pixel ID and server connection before enabling measurement.');
 await db('icash_webinar_settings?id=eq.1','PATCH',{config,updated_at:new Date().toISOString()});return Response.json({saved:true,followupReadiness:webinarFollowupReadiness(config)},{headers:webinarHeaders});}
 if(body.action==='create_vip'){
  const input=z.object({action:z.literal('create_vip'),parentId:z.string().uuid()}).strict().parse(body);
  const [row]=await db<WebinarRow[]>(`icash_webinars?id=eq.${input.parentId}&parent_webinar_id=is.null&select=config,public_code,parent_webinar_id&limit=1`);
  if(!row)throw new WebinarError(404,'Choose a main webinar first.');
  const parent=webinarFromRow(row),pair=await db<WebinarRow[]>('rpc/icash_webinar_create_pair','POST',{p_main:parent,p_vip:newVipWebinar(randomUUID(),parent)});
  return Response.json({webinars:pair.map(webinarFromRow)},{headers:webinarHeaders});
 }
 const input=z.object({action:z.literal('save'),webinar:webinarSchema,isNew:z.boolean()}).strict().parse(body);
 const {publicCode:ignoredCode,parentWebinarId:ignoredParent,...details}=input.webinar;void ignoredCode;void ignoredParent;
 const config={...details,intelligenceEnabled:false,pitchAt:webinarPitchAt(input.webinar),revision:input.isNew?1:input.webinar.revision+1,nightVersion:input.webinar.nightVersion?{...input.webinar.nightVersion,pitchAt:webinarPitchAt(input.webinar.nightVersion)}:null};
 if(config.status==='published'&&webinarOffers(config).every(o=>o.expiresAt&&Date.parse(o.expiresAt)<=Date.now()))throw new WebinarError(400,'Every offer has expired. Update a deadline or add an evergreen offer before publishing.');
 if(config.status==='published'&&config.nightEnabled&&config.nightVersion&&webinarOffers(config.nightVersion).every(o=>o.expiresAt&&Date.parse(o.expiresAt)<=Date.now()))throw new WebinarError(400,'The night recording needs an available offer.');
 const rows=input.isNew?await db<WebinarRow[]>('rpc/icash_webinar_create_pair','POST',{p_main:config,p_vip:newVipWebinar(randomUUID(),input.webinar)}):await db<WebinarRow[]>(`icash_webinars?id=eq.${config.id}&revision=eq.${input.webinar.revision}`,'PATCH',{revision:config.revision,config,updated_at:new Date().toISOString()});
 if(!input.isNew&&!rows.length)throw new WebinarError(409,'This session changed in another tab. Reload before saving.');
 return Response.json({webinar:webinarFromRow(rows.find(r=>r.config.id===config.id)!),webinars:rows.map(webinarFromRow)},{headers:webinarHeaders});
 }catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(x=>`${x.path.join('.')}: ${x.message}`).slice(0,3).join(' ')},{status:400,headers:webinarHeaders});return webinarError(e);}}
