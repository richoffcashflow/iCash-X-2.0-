import {createHmac,timingSafeEqual} from 'node:crypto';
import {titleEmailAddress} from './title-inbound-policy.ts';
import {readCampaignSettings} from './messaging-settings.ts';
import type {db} from './stripe-test';
const signature=(id:string,secret:string)=>createHmac('sha256',secret).update('webinar-reply:v1:'+id).digest('hex').slice(0,20);
export function webinarReplyAddress(jobId:string,fromEmail:string,secret:string|undefined){
 const address=titleEmailAddress(fromEmail),id=jobId.replaceAll('-','').toLowerCase();
 if(!secret||!address||!/^[0-9a-f]{32}$/.test(id))return undefined;
 return `wr-${id}-${signature(id,secret)}@${address.split('@')[1]}`;
}
export function webinarReplyReference(recipients:unknown,fromEmail:string,secret:string|undefined){
 if(!secret||!Array.isArray(recipients))return null;
 const domain=titleEmailAddress(fromEmail).split('@')[1];if(!domain)return null;
 const matches=recipients.map(titleEmailAddress).filter(v=>v.endsWith('@'+domain)&&v.startsWith('wr-'));
 if(matches.length!==1)return null;
 const m=/^wr-([0-9a-f]{32})-([0-9a-f]{20})@/.exec(matches[0]);
 if(!m||!timingSafeEqual(Buffer.from(m[2]),Buffer.from(signature(m[1],secret))))return null;
 const h=m[1];return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
/** Signed routing permits only a bounded reply to the original opted-in recipient. */
export async function intakeWebinarReply(id:string,email:Record<string,unknown>,database:typeof db,env:NodeJS.ProcessEnv=process.env){
 if(email.id!==id||!Array.isArray(email.to)||!email.to.some(v=>titleEmailAddress(v).startsWith('wr-')))return false;
 const {settings}=await readCampaignSettings(database);
 const jobId=webinarReplyReference(email.to,settings.fromEmail,env.RESEND_RECEIVING_WEBHOOK_SECRET);
 if(!jobId)return true;
 const sender=titleEmailAddress(email.from);if(!sender)return true;
 const [job]=await database<{recipient:string}[]>(`icash_webinar_outbox?id=eq.${jobId}&channel=eq.email&campaign_id=not.is.null&first_attempt_at=not.is.null&select=recipient&limit=1`);
 if(!job||sender!==job.recipient)return true;
 const body=typeof email.text==='string'?email.text.split(/\n(?:On .+wrote:|>)/)[0].trim().slice(0,4000):'';
 await database('rpc/icash_webinar_queue_return','POST',{p_event:`email:${id}`,p_channel:'email',p_recipient:sender,p_body:body});
 return true;
}
