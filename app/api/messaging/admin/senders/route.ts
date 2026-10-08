import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {syncCampaignTextNumbers} from '@/lib/webinar-campaign-senders';
import {webinarOwner,webinarOrigin,webinarBody,webinarHeaders,webinarError,WebinarError} from '@/lib/webinar-server';
export const dynamic='force-dynamic';
export async function GET(){try{await webinarOwner();return Response.json({senders:await db('icash_webinar_text_senders?select=phone,enabled,preferred&order=phone')},{headers:webinarHeaders});}catch(e){return webinarError(e);}}
export async function POST(req:Request){try{
 webinarOrigin(req);await webinarOwner();const input=z.discriminatedUnion('action',[z.object({action:z.literal('sync')}),z.object({action:z.literal('prefer'),phone:z.string().regex(/^\+[1-9]\d{7,14}$/)}),z.object({action:z.literal('toggle'),phone:z.string().regex(/^\+[1-9]\d{7,14}$/),enabled:z.boolean()})]).parse(await webinarBody(req,1000));
 if(input.action==='sync')try{return Response.json({senders:(await syncCampaignTextNumbers()).senders},{headers:webinarHeaders});}catch{throw new WebinarError(503,'Could not verify Contiguity numbers. Try again; your existing conversations are saved.');}
 if(input.action==='prefer'){const verified=await syncCampaignTextNumbers();if(!verified.activeNumbers.includes(input.phone))throw new WebinarError(400,'This number is not an active SMS lease.');await db(`icash_webinar_text_senders?phone=eq.${encodeURIComponent(input.phone)}`,'PATCH',{enabled:true});await db('rpc/icash_webinar_prefer_sender','POST',{p_phone:input.phone});return Response.json({senders:await db('icash_webinar_text_senders?select=phone,enabled,preferred&order=phone')},{headers:webinarHeaders});}
 if(input.enabled){const verified=await syncCampaignTextNumbers();if(!verified.activeNumbers.includes(input.phone))throw new WebinarError(400,'This number is not an active SMS lease.');}
 await db(`icash_webinar_text_senders?phone=eq.${encodeURIComponent(input.phone)}`,'PATCH',{enabled:input.enabled});
 return Response.json({senders:await db('icash_webinar_text_senders?select=phone,enabled,preferred&order=phone')},{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
