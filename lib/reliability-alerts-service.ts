import {reliabilityAlertClaimSchema} from './reliability-alerts.ts';
import {reliabilitySeverityLabels,reliabilitySeverityGuidance} from './reliability-priority.ts';
import {ownerInboundTarget} from './owner-inbound-acceptance.ts';
type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Dependencies={db:Database;env?:Record<string,string|undefined>;transport?:typeof fetch;delay?:(ms:number)=>Promise<void>};
const email=/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
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
 if(env.VERCEL_ENV!=='production')return 'skipped';
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
 const labels={worker:'background worker',maintenance:'maintenance',monitor:'monitor freshness',workflows:'stalled work'};
 const summary=claim.reasons.map(reason=>labels[reason]).join(', ')||'workflow checks';
 const message={from:`iCash X <${config.from}>`,to:[recipient],
  subject:detected?`iCash X · ${reliabilitySeverityLabels[claim.severity]} priority`:'iCash X monitoring recovered',
  text:detected?`${reliabilitySeverityLabels[claim.severity]} priority — ${summary}. ${claim.issueCount} workflow item${claim.issueCount===1?'':'s'} flagged.\n\n${reliabilitySeverityGuidance[claim.severity]}\n\nReview the current state: https://www.geticashx.com/admin\n\nCheck original provider receipts before repeating any send or payment. Incident reference: ${claim.incidentId}`:
   `No active workflow alerts or core-service failures were observed during the recovery window for incident ${claim.incidentId}. Reviewed historical alerts may still have unresolved provider receipts or blocked work. This does not confirm every message was delivered or every deal completed.\n\nReview the current state and acknowledged history: https://www.geticashx.com/admin`,
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
