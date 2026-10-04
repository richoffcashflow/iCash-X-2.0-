import {db} from '@/lib/stripe-test';
import {localHour,type WebinarSettings} from '@/lib/webinar-policy';
import {webinarPaid,webinarToken,type Visitor} from '@/lib/webinar-server';
type Job={id:string;visitor_id:string;email:string;step:number;attempts:number;payload:Record<string,unknown>|null};
export function webinarMailTime(timezone:string,now=new Date()){let next=new Date(now);for(let n=0;n<26;n++){const hour=localHour(timezone,next);if(hour>=9&&hour<20)return next;next=new Date(next.getTime()+3600000);}return next;}
export async function processWebinarEmails(){
 const [row]=await db<{config:WebinarSettings}[]>('icash_webinar_settings?id=eq.1&select=config');const settings=row.config;
 if(!settings.enabled)return {paused:true};
 if(process.env.VERCEL_ENV!=='production'||!process.env.RESEND_API_KEY||!process.env.ICASH_WEBINAR_EMAIL_WEBHOOK_SECRET||!settings.fromEmail||!settings.postalAddress||!process.env.ICASH_APP_ORIGIN)return {setupRequired:true};
 const origin=new URL(process.env.ICASH_APP_ORIGIN);if(origin.protocol!=='https:')throw Error('Invalid email origin');
 const jobs=await db<Job[]>('rpc/icash_webinar_claim_emails','POST',{});let sent=0,canceled=0,failed=0;
 for(const job of jobs){
  try{
   const [v]=await db<Visitor[]>(`icash_webinar_visitors?id=eq.${job.visitor_id}&select=*&limit=1`);
   const suppressed=await db<unknown[]>(`icash_webinar_suppressions?email=eq.${encodeURIComponent(job.email)}&select=email&limit=1`);
   if(!v||!v.email_consent_at||v.opted_out_at||v.email!==job.email||suppressed.length||await webinarPaid(v)){
    await db(`icash_webinar_followups?id=eq.${job.id}`,'PATCH',{state:'canceled'});canceled++;continue;
   }
   const now=new Date(),next=webinarMailTime(v.timezone,now);if(next.getTime()>now.getTime()){
    await db(`icash_webinar_followups?id=eq.${job.id}`,'PATCH',{state:'pending',due_at:next.toISOString(),attempts:job.attempts-1,...(!job.payload?{first_attempt_at:null}:{})});continue;
   }
   // Persist the exact request before contacting the provider. Retries reuse it.
   let payload=job.payload;
   if(!payload){const resume=`${origin.origin}/webinar?r=${webinarToken(v.id,'resume',86400*7)}`,unsubscribe=`${origin.origin}/api/webinar/unsubscribe?t=${webinarToken(v.id,'unsubscribe',86400*365)}`;
    payload={from:`iCash X <${settings.fromEmail}>`,to:[job.email],subject:settings.subjects[job.step].replace(/[\r\n]/g,' '),text:`${v.name?`Hi ${v.name},`:'Hi there,'}\n\n${settings.messages[job.step]}\n\nContinue your recorded session: ${resume}\n\nThis is an automated follow-up from iCash X. Paid activity does not guarantee a deal or earnings.\n\n${settings.postalAddress}\n\nUnsubscribe: ${unsubscribe}`,headers:{'List-Unsubscribe':`<${unsubscribe}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'},tags:[{name:'webinar_job',value:job.id}]};
    await db(`icash_webinar_followups?id=eq.${job.id}`,'PATCH',{payload});
   }
   // Recheck suppression and global pause immediately before delivery.
   const [[latest],[control]]=await Promise.all([db<Visitor[]>(`icash_webinar_visitors?id=eq.${v.id}&select=*&limit=1`),db<{config:WebinarSettings}[]>('icash_webinar_settings?id=eq.1&select=config')]);
   if(!control.config.enabled||latest.opted_out_at||!latest.email_consent_at||latest.email!==job.email||await webinarPaid(latest)){await db(`icash_webinar_followups?id=eq.${job.id}`,'PATCH',{state:'canceled'});canceled++;continue;}
   const res=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`webinar-${job.id}`},body:JSON.stringify(payload)});
   if(!res.ok){if(res.status!==429&&res.status<500){await db(`icash_webinar_followups?id=eq.${job.id}`,'PATCH',{state:'failed'});failed++;continue;}throw Error('Provider unavailable');}
   const result=await res.json();if(typeof result.id!=='string')throw Error('Missing delivery receipt');
   await db(`icash_webinar_followups?id=eq.${job.id}`,'PATCH',{state:'sent',provider_id:result.id,sent_at:new Date().toISOString()});sent++;
   const receipts=await db<{kind:string}[]>(`icash_webinar_email_receipts?provider_id=eq.${encodeURIComponent(result.id)}&select=kind&limit=1`);if(receipts.length)await db('rpc/icash_webinar_unsubscribe','POST',{p_visitor:v.id,p_reason:receipts[0].kind});
  }catch{
   await db(`icash_webinar_followups?id=eq.${job.id}`,'PATCH',{state:job.attempts>=4?'failed':'pending',due_at:new Date(Date.now()+Math.min(3600000,60000*2**job.attempts)).toISOString()});failed++;
  }
 }
 return {sent,canceled,failed};
}
