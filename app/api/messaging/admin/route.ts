import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {campaignSettingsSchema,readCampaignSettings} from '@/lib/messaging-settings';
import {customerUpdateConfiguration} from '@/lib/customer-updates';
import {webinarFollowupReadiness} from '@/lib/webinar-email';
import {webinarOwner,webinarOrigin,webinarBody,webinarHeaders,webinarError,WebinarError} from '@/lib/webinar-server';
export const dynamic='force-dynamic';
export async function GET(){try{
 await webinarOwner();
 const [campaign,customers,stats,customerStats]=await Promise.all([
  readCampaignSettings(db),db<{enabled:boolean}[]>('icash_customer_update_settings?id=eq.1&select=enabled'),
  db('rpc/icash_webinar_followup_stats','POST',{}).catch(()=>null),db('rpc/icash_messaging_customer_stats','POST',{}).catch(()=>null),
 ]);
 const customer=customerUpdateConfiguration(process.env,campaign.settings.fromEmail);
 return Response.json({...campaign,customerUpdatesEnabled:customers[0]?.enabled===true,readiness:webinarFollowupReadiness(campaign.settings),customerReadiness:{email:customer.email,sms:customer.sms},stats,customerStats},{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
export async function POST(req:Request){try{
 webinarOrigin(req);await webinarOwner();
 const input=z.object({settings:campaignSettingsSchema,customerUpdatesEnabled:z.boolean(),revision:z.number().int().positive()}).strict().parse(await webinarBody(req,12000));
 const revision=await db<number|null>('rpc/icash_messaging_save','POST',{p_config:input.settings,p_customer_enabled:input.customerUpdatesEnabled,p_revision:input.revision});
 if(revision===null)throw new WebinarError(409,'Messaging settings changed in another tab. Reload before saving.');
 const customer=customerUpdateConfiguration(process.env,input.settings.fromEmail);
 return Response.json({saved:true,revision,readiness:webinarFollowupReadiness(input.settings),customerReadiness:{email:customer.email,sms:customer.sms}},{headers:webinarHeaders});
 }catch(e){if(e instanceof z.ZodError)return Response.json({error:'Check your sender email and settings.'},{status:400,headers:webinarHeaders});return webinarError(e);}}
