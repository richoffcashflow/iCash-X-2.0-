import {db} from '@/lib/stripe-test';
import {localHour,settingsSchema,webinarPitchAt,type WebinarSettings} from '@/lib/webinar-policy';
import {webinarPaid,webinarToken,type Visitor,type WebinarSession} from '@/lib/webinar-server';
import {followupCopy,followupPhase} from '@/lib/webinar-followup-policy';
import {webinarSite} from '@/lib/webinar-site';
type Database=typeof db;
export type FollowupJob={id:string;visitor_id:string;session_id:string;channel:'email'|'sms';recipient:string;step:number;attempts:number;payload:Record<string,unknown>|null;first_attempt_at:string|null};
export function webinarMailTime(timezone:string,now=new Date()){let next=new Date(now);for(let n=0;n<26;n++){const hour=localHour(timezone,next);if(hour>=9&&hour<20)return next;next=new Date(next.getTime()+3600000);}return next;}
export function webinarFollowupReadiness(settings:WebinarSettings,env:Record<string,string|undefined>=process.env){
 const production=env.VERCEL_ENV==='production',origin=env.ICASH_APP_ORIGIN;
 let validOrigin=false;try{const url=new URL(origin||'');validOrigin=url.protocol==='https:'&&!url.username&&!url.password;}catch{}
 const emailConnection=!!env.RESEND_API_KEY&&!!(env.RESEND_RECEIVING_WEBHOOK_SECRET||env.ICASH_WEBINAR_EMAIL_WEBHOOK_SECRET)&&validOrigin;
 const smsConnection=!!env.CONTIGUITY_API_KEY&&!!env.CONTIGUITY_WEBHOOK_SECRET&&/^\+[1-9]\d{7,14}$/.test(env.CONTIGUITY_FROM||'')&&validOrigin;
 return {emailConnection,smsConnection,email:production&&settings.enabled&&emailConnection&&!!settings.fromEmail&&!!settings.postalAddress.trim(),sms:production&&settings.smsEnabled&&smsConnection};
}
export async function processWebinarFollowups({database=db,transport=fetch,env=process.env,clock=()=>new Date()}:{database?:Database;transport?:typeof fetch;env?:Record<string,string|undefined>;clock?:()=>Date}={}){
 const [row]=await database<{config:WebinarSettings}[]>('icash_webinar_settings?id=eq.1&select=config'),settings=settingsSchema.parse(row.config);
 const ready=webinarFollowupReadiness(settings,env);
 if(ready.sms){const senders=await database<unknown[]>(`icash_text_senders?phone=eq.${encodeURIComponent(env.CONTIGUITY_FROM!)}&enabled=eq.true&select=phone&limit=1`);ready.sms=senders.length>0;}
 if(!ready.email&&!ready.sms)return {emailReady:ready.email,textReady:ready.sms,setupRequired:settings.enabled||settings.smsEnabled,sent:0};
 const origin=new URL(env.ICASH_APP_ORIGIN!).origin;
 const jobs=await database<FollowupJob[]>('rpc/icash_webinar_claim_followups','POST',{p_email_ready:ready.email,p_sms_ready:ready.sms});
 let sent=0,canceled=0,failed=0,emailTurn=Promise.resolve();
 async function deliver(job:FollowupJob){let dispatched=false,providerAccepted=false;
  try{
   const [v]=await database<Visitor[]>(`icash_webinar_visitors?id=eq.${job.visitor_id}&select=*&limit=1`);
   if(!v||await webinarPaid(v)){await database(`icash_webinar_outbox?id=eq.${job.id}&state=eq.claimed`,'PATCH',{state:'canceled'});canceled++;return;}
   const now=clock(),next=webinarMailTime(v.timezone,now);
   if(next.getTime()>now.getTime()){await database(`icash_webinar_outbox?id=eq.${job.id}&state=eq.claimed`,'PATCH',{state:'pending',due_at:next.toISOString(),attempts:Math.max(0,job.attempts-1)});return;}
   let payload=job.payload;
   if(!payload){
    const [sessions,events]=await Promise.all([database<WebinarSession[]>(`icash_webinar_sessions?visitor_id=eq.${v.id}&is_preview=eq.false&select=*&order=created_at.desc&limit=30`),database<{session_id:string;created_at:string}[]>(`icash_webinar_events?visitor_id=eq.${v.id}&kind=eq.pitch_shown&event_key=eq.once&select=session_id,created_at&order=created_at.desc&limit=30`)]);
    const latest=sessions[0];if(!latest){await database(`icash_webinar_outbox?id=eq.${job.id}`,'PATCH',{state:'canceled'});canceled++;return;}
    const history=sessions.map(s=>({...s,config:{...s.config,pitchAt:webinarPitchAt(s.config)},offer_seen_at:events.find(e=>e.session_id===s.id)?.created_at??null}));
    const phase=followupPhase(history,v.timezone,settings.routing.checkoutWindowHours,now),emailStep=job.step===0?0:job.step===2?1:2;
    const copy=followupCopy({name:v.name??'',title:latest.config.title,seconds:latest.progress_seconds,phase,step:job.step,brand:webinarSite.brandName,host:webinarSite.hostName,smart:settings.smartFollowups,subject:settings.subjects[emailStep],message:settings.messages[emailStep]});
    const link=`${origin}/w/${job.id}`;
    if(job.channel==='sms')payload={from:env.CONTIGUITY_FROM,to:job.recipient,message:`${copy.sms} ${link} Reply STOP to opt out.`,attachments:[],fast_track:false};
    else {const unsubscribe=`${origin}/api/webinar/unsubscribe?t=${webinarToken(v.id,'unsubscribe',86400*365)}`;
     payload={from:`${webinarSite.hostName} at ${webinarSite.brandName} <${settings.fromEmail}>`,to:[job.recipient],subject:copy.subject,text:`${copy.body}\n${link}\n\n${copy.signature}\n\n${webinarSite.brandName} session reminders and offers\n${settings.postalAddress}\nUnsubscribe: ${unsubscribe}`,headers:{'List-Unsubscribe':`<${unsubscribe}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'},tags:[{name:'webinar_job',value:job.id}]};
    }
   }
   // Durable one-use authorization rechecks purchase, consent, pause, contact,
   // activity and cross-channel frequency immediately before the provider call.
   // Pace email requests; transient provider limits still retry safely.
   if(job.channel==='email'){const turn=emailTurn.then(()=>new Promise<void>(resolve=>setTimeout(resolve,600)));emailTurn=turn;await turn;}
   const approved=await database<FollowupJob|null>('rpc/icash_webinar_authorize_followup','POST',{p_id:job.id,p_payload:payload});
   if(!approved?.id){canceled++;return;}dispatched=true;
   const email=job.channel==='email';
   const response=await transport(email?'https://api.resend.com/emails':'https://api.contiguity.com/send/text',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:email?`Bearer ${env.RESEND_API_KEY}`:`Token ${env.CONTIGUITY_API_KEY}`,'Content-Type':'application/json',...(email?{'Idempotency-Key':`webinar-followup-${job.id}`}:{})},body:JSON.stringify(approved.payload)});
   if(!response.ok){if(!email||response.status!==429&&response.status<500){await database(`icash_webinar_outbox?id=eq.${job.id}&state=eq.sending`,'PATCH',{state:'failed',last_error:'Provider declined delivery'});failed++;return;}throw Error('Email retry');}
   const result=await response.json(),provider=email?result.id:result.data?.message_id;
   if(typeof provider!=='string'||!provider||provider.length>200)throw Error('Missing receipt');providerAccepted=true;
   await database('rpc/icash_webinar_finish_followup','POST',{p_id:job.id,p_provider:provider});sent++;
  }catch{
   failed++;
   // An SMS timeout can mean accepted. Never retry an ambiguous send. Email
   // retries keep the original payload/key and stop inside the 24-hour window.
   if(providerAccepted)return;
   await database(`icash_webinar_outbox?id=eq.${job.id}&state=in.(claimed,sending)`,'PATCH',{state:dispatched&&job.channel==='sms'?'unknown':job.attempts>=4?'failed':'pending',due_at:new Date(clock().getTime()+60000*2**job.attempts).toISOString(),last_error:dispatched&&job.channel==='sms'?'Delivery unconfirmed; not retried':'Delivery will retry'}).catch(()=>undefined); // The durable lease recovers if this status write also fails.
  }
 }
 let cursor=0;const stopAt=Date.now()+90000;
 await Promise.all(Array.from({length:Math.min(5,jobs.length)},async()=>{while(cursor<jobs.length&&Date.now()<stopAt){const job=jobs[cursor++];await deliver(job);}}));
 // Unstarted leases expire safely; a slow dependency cannot create unbounded work.
 return {sent,canceled,failed,emailReady:ready.email,textReady:ready.sms};
}
