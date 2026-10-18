import {db} from '@/lib/stripe-test';
import {readCampaignSettings} from '@/lib/messaging-settings';
import {webinarFollowupReadiness} from '@/lib/webinar-email';
import {webinarOwner,webinarHeaders,webinarError} from '@/lib/webinar-server';
import type {ReminderResults} from '@/lib/webinar-reminder-policy';
export const dynamic='force-dynamic';
export async function GET(){try{
 await webinarOwner();
 const [steps,jobs,replies,campaign]=await Promise.all([
  db('rpc/icash_webinar_return_steps','POST',{}),
  db<{id:string}[]>('icash_webinar_outbox?select=id,channel,recipient,step,state,due_at,sent_at,last_error,destination,payload,reply_event_id,departure_id,visitor:icash_webinar_visitors(name,timezone)&order=created_at.desc,id.desc&limit=100'),
  db('icash_webinar_reply_events?select=event_id,channel,recipient,body,outcome,created_at&order=created_at.desc&limit=30'),
  readCampaignSettings(db),
 ]);
 const results=await db<ReminderResults>('rpc/icash_webinar_reminder_results','POST',{p_jobs:jobs.map(j=>j.id)},AbortSignal.timeout(5000)).catch(()=>null);
 return Response.json({steps,jobs,replies,results,readiness:webinarFollowupReadiness(campaign.settings),fromEmail:campaign.settings.fromEmail,postalAddress:campaign.settings.postalAddress},{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
