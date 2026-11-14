import {reliabilityAlertClaimSchema} from './reliability-alerts.ts';
import {reliabilitySeverityLabels,reliabilitySeverityGuidance} from './reliability-priority.ts';
import {ownerInboundTarget} from './owner-inbound-acceptance.ts';
import {reliabilitySchema} from './reliability.ts';
import {externalReliabilityRuntime} from './reliability-monitor-runtime.ts';
type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Dependencies={db:Database;env?:Record<string,string|undefined>;transport?:typeof fetch;delay?:(ms:number)=>Promise<void>};
const email=/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function reliabilityEmailTime(value:string){
 const time=Date.parse(value);
 return Number.isFinite(time)?new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',dateStyle:'medium',timeStyle:'short',hour12:true}).format(time)+' Central':'unverified';
}
/** Aggregate observations only; never put account IDs or raw provider data in email. */
export function reliabilityNotificationContext(value:unknown,now=Date.now()){
 const parsed=reliabilitySchema.safeParse(value);
 if(!parsed.success||!parsed.data.fresh||!parsed.data.snapshot)return 'Current impact: unverified. Monitoring could not supply a fresh valid snapshot; do not infer recovery.';
 const report=parsed.data,snapshot=report.snapshot!,age=now-Date.parse(snapshot.checkedAt);
 if(age< -5000||age>120000)return 'Current impact: unverified. The available snapshot is stale; do not infer recovery.';
 const progress=snapshot.accountProgress;
 const progressAge=progress?now-Date.parse(progress.checkedAt):Infinity;
 const impact=progress&&progressAge>=-5000&&progressAge<=120000
  ?`Accounts needing attention: ${progress.affectedAccounts}. Stalled accounts: ${progress.stalledAccounts}. Accounts with pending work or receipts: ${progress.pendingAccounts}. These counts are not a count of confirmed outages.`
  :'Account impact and interrupted work: unverified.';
 const components=(['worker','maintenance'] as const).map(name=>{
  const c=report.components[name],age=c.checkedAt?now-Date.parse(c.checkedAt):Infinity;
  return `${name}: ${age>=-5000&&age<=120000?c.status:'unverified'}`;
 }).join('; ');
 const quota=snapshot.researchQuota;
 const quotaAge=quota?.checkedAt?now-Date.parse(quota.checkedAt):Infinity;
 const research=quota?.fresh&&quotaAge>=-5000&&quotaAge<=120000
  ?`\nContact research capacity: ${quota.status.replaceAll('_',' ')}.${quota.nextAvailableAt?` Next capacity check: ${reliabilityEmailTime(quota.nextAvailableAt)}.`:''} Provider limits remain in effect.`:'';
 return `Observed at: ${reliabilityEmailTime(snapshot.checkedAt)}\n${impact}\nOperational checks: ${components}. Heartbeats alone do not prove completed work.${research}\nRecorded activity in the monitor window: ${snapshot.texts.accepted} texts accepted, ${snapshot.texts.delivered} delivered; ${snapshot.contracts.completed} contracts completed. Independent eligible workflows can continue within their own controls.`;
}
function configuration(env:Record<string,string|undefined>){
 if(env.ICASH_RELIABILITY_EMAIL_ENABLED!=='true')return {state:'disabled' as const};
 const from=env.ICASH_RELIABILITY_FROM_EMAIL??env.ICASH_ATTENTION_FROM_EMAIL??(env.RESEND_EMAIL_DOMAIN?`noreply@${env.RESEND_EMAIL_DOMAIN}`:'');
 let url:URL;try{url=new URL(env.SUPABASE_URL??'');}catch{return {state:'unconfigured' as const};}
 if(!env.RESEND_API_KEY||!env.SUPABASE_SECRET_KEY||!email.test(from)||from.length>254||url.protocol!=='https:'||!url.hostname.endsWith('.supabase.co')||url.username||url.password||url.pathname!=='/')return {state:'unconfigured' as const};
 return {state:'ready' as const,from,url,key:env.RESEND_API_KEY,dbKey:env.SUPABASE_SECRET_KEY};
}
/** Operational owner alerts only. No customer destinations or paid customer operations. */
export async function dispatchReliabilityAlerts(dependencies:Dependencies){
 const env=dependencies.env??process.env,db=dependencies.db,transport=dependencies.transport??fetch;
 // A preview can share the database; it must never alter production alert configuration or send.
 if(env.VERCEL_ENV!=='production'&&!externalReliabilityRuntime(env))return 'skipped';
 const config=configuration(env);
 const pending=await db<boolean>('rpc/icash_refresh_reliability_incident','POST',{p_configuration:config.state});
 if(config.state!=='ready'||!pending)return config.state==='ready'?'idle':config.state;
 let recipient:string;
 try{
  const response=await transport(new URL(`/auth/v1/admin/users/${ownerInboundTarget.ownerUserId}`,config.url),{headers:{apikey:config.dbKey,Authorization:`Bearer ${config.dbKey}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error('Owner verification unavailable');
  const owner=await response.json();
  if(owner.id!==ownerInboundTarget.ownerUserId||typeof owner.email!=='string'||owner.email.length>254||!email.test(owner.email)||!owner.email_confirmed_at||!Number.isFinite(Date.parse(owner.email_confirmed_at))||owner.deleted_at||owner.banned_until&&Date.parse(owner.banned_until)>Date.now())throw Error('Owner verification unavailable');
  recipient=owner.email;
 }catch{
  await db('rpc/icash_refresh_reliability_incident','POST',{p_configuration:'recipient_unverified'});
  return 'recipient_unverified';
 }
 const raw=await db<unknown>('rpc/icash_claim_reliability_notification_v2','POST',{});
 if(raw===null)return 'idle';
 const claim=reliabilityAlertClaimSchema.parse(raw);
 const detected=claim.event==='detected';
 const labels={worker:'background worker',maintenance:'maintenance',monitor:'monitor freshness',workflows:'workflow recovery'};
 const summary=claim.reasons.map(reason=>labels[reason]).join(', ')||'workflow checks';
 // A failed context read must not suppress the already-claimed incident alert.
 const current=await db<unknown>('rpc/icash_reliability_status','POST',{}).catch(()=>null);
 const context=`Incident started: ${reliabilityEmailTime(claim.openedAt)}\n${reliabilityNotificationContext(current)}\nRecovery status: ${detected?'automatic recovery continues; a verified clear recovery window has not yet been recorded. Original uncertain provider outcomes stay held for verification.':'a clear recovery window was recorded. Review the latest observations above before assuming all work resumed.'}`;
 const message={from:`iCash X <${config.from}>`,to:[recipient],
  subject:detected?`iCash X · ${reliabilitySeverityLabels[claim.severity]} priority`:'iCash X monitoring recovered',
  text:detected?`${reliabilitySeverityLabels[claim.severity]} priority — ${summary}. ${claim.issueCount} monitor flag${claim.issueCount===1?'':'s'}. These are not all confirmed outages or failed sends.\n\n${context}\n\n${reliabilitySeverityGuidance[claim.severity]}\n\nReview the current state: https://www.geticashx.com/admin\n\nCheck original provider receipts before repeating any send or payment. Incident reference: ${claim.incidentId}`:
   `No active workflow alerts or core-service failures were observed during the recovery window for incident ${claim.incidentId}. Reviewed historical alerts may still have unresolved provider receipts or blocked work. This does not confirm every message was delivered or every deal completed.\n\n${context}\n\nReview the current state and acknowledged history: https://www.geticashx.com/admin`,
 };
 let provider:string|null=null;
 try{
  const response=await transport('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${config.key}`,'Content-Type':'application/json','Idempotency-Key':`reliability-${claim.id}`},body:JSON.stringify(message),redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('Notification needs review');
  const receipt=await response.json();if(typeof receipt?.id!=='string'||!uuid.test(receipt.id))throw Error('Notification needs review');
  provider=receipt.id;
 }catch{/* A consumed claim is never automatically resent after an uncertain outcome. */}
 const finish=()=>db('rpc/icash_finish_reliability_notification','POST',{p_id:claim.id,p_provider:provider});
 try{await finish();}catch{
  await (dependencies.delay??(ms=>new Promise(resolve=>setTimeout(resolve,ms))))(200);
  try{await finish();}catch{return 'needs_review';}
 }
 return provider?'accepted':'needs_review';
}
