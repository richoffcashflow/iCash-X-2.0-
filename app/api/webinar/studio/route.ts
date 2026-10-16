import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {webinarSchema,settingsSchema,webinarFromRow,newVipWebinar,playableWebinarRecordings,webinarEndOffer,webinarPitchAt,type WebinarRow,type WebinarSettings} from '@/lib/webinar-policy';
import {webinarBody,webinarError,webinarHeaders,webinarOrigin,webinarOwner,WebinarError} from '@/lib/webinar-server';
import {checkoutPublishableKey} from '@/lib/embedded-checkout-policy';
import {fundingMode} from '@/lib/funding-policy';
import {webinarFollowupReadiness} from '@/lib/webinar-email';
import {metaReady} from '@/lib/webinar-meta';
export const dynamic='force-dynamic';
function validationMessage(issue:z.ZodIssue){
 const path=[...issue.path],isWebinar=path[0]==='webinar';if(isWebinar)path.shift();
 let scope=isWebinar?'Daytime':'Settings';
 if(path[0]==='nightVersion'){scope='Nighttime';path.shift();}
 if(path[0]==='offers'&&typeof path[1]==='number'){scope+=` offer ${path[1]+1}`;path.splice(0,2);}
 const labels:Record<string,string>={url:'destination URL',title:'headline',ctaLabel:'button text',purchaseNotifications:'purchase activity','purchaseNotifications.startAt':'purchase activity start time',at:'start time',durationSeconds:'duration',expiresAt:'closing date',imageUrl:'image URL'};
 const field=labels[path.join('.')]??path.join(' ').replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase();
 return `${scope}${field?' '+field:''}: ${issue.message}`;
}
export async function GET(){try{
 await webinarOwner();const [webinars,settings,metaHealth,followupStats]=await Promise.all([db<WebinarRow[]>('icash_webinars?select=config,public_code,parent_webinar_id&order=public_code.asc&limit=1000'),db<{config:WebinarSettings}[]>('icash_webinar_settings?id=eq.1&select=config'),db('rpc/icash_webinar_meta_health','POST',{}),db('rpc/icash_webinar_followup_stats','POST',{}).catch(()=>null)]);
 const config=settingsSchema.parse(settings[0].config);config.optimizer.enabled=false;const followupReadiness=webinarFollowupReadiness(config);
 return Response.json({webinars:webinars.map(webinarFromRow),settings:config,followupReadiness,followupStats,metaHealth,metaReady:metaReady(),embeddedCheckoutReady:!!checkoutPublishableKey(fundingMode()),aiReady:!!process.env.OPENAI_API_KEY&&!!(process.env.ICASH_WEBINAR_AI_MODEL||process.env.ICASH_SUPPORT_AI_MODEL),emailReady:followupReadiness.email},{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
export async function POST(req:Request){try{
 webinarOrigin(req);await webinarOwner();const body=await webinarBody(req,800000);
 if(body.action==='settings'){
 const config=settingsSchema.parse(body.settings);config.optimizer.enabled=false;
 await Promise.all([...new Set([config.homepageVipId,config.homepageVipNightId].filter(Boolean))].map(async id=>{const [vip]=await db<WebinarRow[]>(`icash_webinars?id=eq.${id}&parent_webinar_id=not.is.null&select=config,public_code,parent_webinar_id&limit=1`);if(!vip)throw new WebinarError(400,'Choose a saved VIP session for homepage buyers.');}));
 if(config.meta.enabled&&!config.meta.pixelId)throw new WebinarError(400,'Add your Meta Pixel ID before enabling measurement.');
 await db('icash_webinar_settings?id=eq.1','PATCH',{config,updated_at:new Date().toISOString()});return Response.json({saved:true,followupReadiness:webinarFollowupReadiness(config)},{headers:webinarHeaders});}
 if(body.action==='create_vip'){
  const input=z.object({action:z.literal('create_vip'),parentId:z.string().uuid()}).strict().parse(body);
  const [row]=await db<WebinarRow[]>(`icash_webinars?id=eq.${input.parentId}&parent_webinar_id=is.null&select=config,public_code,parent_webinar_id&limit=1`);
  if(!row)throw new WebinarError(404,'Choose a main webinar first.');
  const parent=webinarFromRow(row),pair=await db<WebinarRow[]>('rpc/icash_webinar_create_pair','POST',{p_main:parent,p_vip:newVipWebinar(randomUUID(),parent)});
  return Response.json({webinars:pair.map(webinarFromRow)},{headers:webinarHeaders});
 }
 const input=z.object({action:z.literal('save'),webinar:webinarSchema,isNew:z.boolean()}).strict().parse(body);
 const {publicCode:ignoredCode,parentWebinarId:ignoredParent,adEntryWebinarId:ignoredEntry,...details}=input.webinar;void ignoredCode;void ignoredParent;void ignoredEntry;
 const config={...details,intelligenceEnabled:false,pitchAt:webinarPitchAt(input.webinar),revision:input.isNew?1:input.webinar.revision+1,nightVersion:input.webinar.nightVersion?{...input.webinar.nightVersion,purchaseNotifications:input.webinar.nightVersion.purchaseNotifications??input.webinar.purchaseNotifications,pitchAt:webinarPitchAt(input.webinar.nightVersion)}:null};
 if(config.status==='published')for(const {version,recording} of playableWebinarRecordings({...input.webinar,...config})){
  if(!webinarEndOffer(recording))throw new WebinarError(400,`The ${version==='night'?'Nighttime':'Daytime'} recording needs an available offer before publishing.`);
 }
 const rows=input.isNew?await db<WebinarRow[]>('rpc/icash_webinar_create_pair','POST',{p_main:config,p_vip:newVipWebinar(randomUUID(),input.webinar)}):await db<WebinarRow[]>(`icash_webinars?id=eq.${config.id}&revision=eq.${input.webinar.revision}`,'PATCH',{revision:config.revision,config,updated_at:new Date().toISOString()});
 if(!input.isNew&&!rows.length)throw new WebinarError(409,'This session changed in another tab. Reload before saving.');
 return Response.json({webinar:webinarFromRow(rows.find(r=>r.config.id===config.id)!),webinars:rows.map(webinarFromRow)},{headers:webinarHeaders});
 }catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.slice(0,3).map(validationMessage).join(' ')},{status:400,headers:webinarHeaders});return webinarError(e);}}
