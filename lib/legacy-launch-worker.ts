import {readCampaignSettings,type MessagingDatabase} from './messaging-settings.ts';
import {renderLaunchCopy,launchSender} from './legacy-launch.ts';
type Job={id:string;channel:'email'|'sms';recipient:string;sender:string|null;subject:string;body:string;name:string;token:string};
/** Independent sender: legacy webinar reminders remain permanently disabled. */
export async function processLegacyLaunch({database,env=process.env,transport=fetch}:{database:MessagingDatabase;env?:Record<string,string|undefined>;transport?:typeof fetch}) {
 if(env.VERCEL_ENV!=='production')return {status:'disabled',accepted:0};
 const [active]=await database<{id:string}[]>('icash_legacy_launches?state=eq.active&select=id&limit=1');
 if(!active)return {status:'paused',accepted:0};
 const {settings}=await readCampaignSettings(database);
 const origin=env.ICASH_APP_ORIGIN||'https://www.geticashx.com';
 if(!/^https:\/\/(www\.)?geticashx\.com$/.test(origin))return {status:'configuration_required',accepted:0};
 const emailReady=!!env.RESEND_API_KEY&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.fromEmail)&&settings.postalAddress.trim().length>15;
 const smsReady=!!env.CONTIGUITY_API_KEY;
 await database('rpc/icash_legacy_enqueue','POST',{});
 let accepted=0,held=0;
 for(let attempt=0;attempt<30;attempt++) {
  const id=await database<string|null>('rpc/icash_legacy_claim','POST',{p_email:emailReady,p_sms:smsReady});if(!id)break;
  let transportStarted=false;
  try {
   const job=await database<Job|null>('rpc/icash_legacy_authorize','POST',{p_id:id});if(!job)continue;
   if(job.id!==id||!/^[a-f0-9]{64}$/.test(job.token))throw Error('Invalid launch grant');
   const values={first_name:job.name.trim().split(/\s+/)[0]||'there',join_url:`${origin}/launch/${job.token}/join`,watch_url:`${origin}/launch/${job.token}/watch`};
   const copy=renderLaunchCopy(job,values),unsubscribe=`${origin}/launch/${job.token}/unsubscribe`;
   // Final database grant above rechecks purchase, opt-outs, revision and Pause.
   let response:Response;transportStarted=true;
   if(job.channel==='email') {
    if(!emailReady||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(job.recipient))throw Error('Invalid email');
    response=await transport('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`legacy-launch-${id}`},body:JSON.stringify({from:`${launchSender} <${settings.fromEmail}>`,to:[job.recipient],subject:copy.subject,text:`${copy.body}\n\n${settings.postalAddress}\nUnsubscribe: ${unsubscribe}`,tags:[{name:'icash_legacy_launch_id',value:id}],headers:{'List-Unsubscribe':`<${unsubscribe}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}})});
   }else {
    if(!smsReady||!/^\+[1-9]\d{7,14}$/.test(job.recipient)||!/^\+[1-9]\d{7,14}$/.test(job.sender??''))throw Error('Invalid phone');
    response=await transport('https://api.contiguity.com/send/text',{method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),headers:{Authorization:`Token ${env.CONTIGUITY_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:job.sender,to:job.recipient,message:copy.body,attachments:[],fast_track:false})});
   }
   if(!response.ok)throw Error('Delivery unconfirmed');
   const receipt=await response.json(),provider=job.channel==='email'?receipt?.id:receipt?.data?.message_id;
   if(typeof provider!=='string'||provider.length<1||provider.length>200)throw Error('Missing receipt');
   await database('rpc/icash_legacy_finish','POST',{p_id:id,p_provider:provider});accepted++;
  }catch {
   held++;await database('rpc/icash_legacy_finish','POST',{p_id:id,p_provider:null}).catch(()=>{});
   if(transportStarted)break;
  }
 }
 return {status:'checked',accepted,held};
}
