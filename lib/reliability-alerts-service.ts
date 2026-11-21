import {reliabilityAlertClaimSchema} from './reliability-alerts.ts';
import {reliabilitySeverityLabels} from './reliability-priority.ts';
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
function freshAt(value:string|null|undefined,now:number){
 const age=value?now-Date.parse(value):Infinity;
 return age>=-5000&&age<=120000;
}
/** Aggregate observations only; severity never establishes the extent of an outage. */
function notificationEvidence(value:unknown,now:number){
 const parsed=reliabilitySchema.safeParse(value);
 const report=parsed.success?parsed.data:null;
 const snapshot=report?.snapshot;
 const components=(['worker','maintenance'] as const).map(name=>{
  const check=report?.components[name];
  return {label:name==='worker'?'background worker':'maintenance',status:check?.status,checkedAt:check?.checkedAt,fresh:freshAt(check?.checkedAt,now)};
 });
 const checks=components.map(c=>`${c.label}: ${c.fresh?c.status:'unverified'}${c.checkedAt?` (checked ${reliabilityEmailTime(c.checkedAt)}${c.fresh?'':'; not current'})`:''}`).join('; ');
 const failing=components.filter(c=>c.fresh&&(c.status==='degraded'||c.status==='unavailable'));
 const failureList=failing.map(c=>c.label).join(' and ');
 const unavailable=(headline:string,reason:string,nextAction:string)=>({headline,clear:false,
  impact:`Current impact: unverified. ${reason}${failureList?` Failing checks: ${failureList}.`:''}`,details:`Last monitor snapshot: ${snapshot?reliabilityEmailTime(snapshot.checkedAt):'unavailable'}.\nBackground checks: ${checks}.`,
  nextAction});
 const refresh=failureList?`Check ${failureList} and restore monitoring.`:'Restore monitoring and verify affected work.';
 if(!report||!snapshot)return unavailable('Current impact unverified','No valid monitor snapshot was available.',refresh);
 if(!report.fresh||!freshAt(snapshot.checkedAt,now))return unavailable('Monitoring snapshot not current','The last snapshot cannot verify current account impact.',refresh);
 if(snapshot.issueCount<snapshot.issues.length||snapshot.issueCount===0&&[snapshot.incomingTexts?.warningCount,snapshot.learning?.warningCount,snapshot.researchQuota?.warningCount].some(count=>(count??0)>0))return unavailable('Current impact unverified','The snapshot contains conflicting workflow counts.',refresh);
 const progress=snapshot.accountProgress;
 // stalledPendingAccounts is the intersection, not an extra category.
 const overlap=progress?.stalledPendingAccounts??0;
 const categorized=progress?progress.expiredConfigurations+progress.unexpectedPauses+progress.stalledAccounts+progress.pendingAccounts-overlap:0;
 const progressFresh=progress&&freshAt(progress.checkedAt,now)&&
  overlap<=Math.min(progress.stalledAccounts,progress.pendingAccounts)&&
  categorized<=progress.affectedAccounts&&
  progress.samples.length<=progress.affectedAccounts;
 const otherAccounts=progressFresh?progress.affectedAccounts-categorized:0;
 const impact=progressFresh
  ?`Accounts needing attention: ${progress.affectedAccounts}. No recent completed task recorded: ${progress.stalledAccounts}. Earlier work awaiting confirmation: ${progress.pendingAccounts}.${overlap?` ${overlap} are in both groups.`:''}${progress.expiredConfigurations||progress.unexpectedPauses?` Expired configurations: ${progress.expiredConfigurations}; unexpected pauses: ${progress.unexpectedPauses}.`:''}${otherAccounts?` Other account issues (see dashboard): ${otherAccounts}.`:''} These counts do not establish a full outage.`
  :'Account impact and interrupted work: unverified.';
 const responding=components.filter(c=>c.fresh&&c.status==='ok');
 const accountIssues=Boolean(progressFresh&&progress.affectedAccounts>0)||snapshot.issueCount>0;
 const clear=report.status==='ok'&&!accountIssues&&responding.length===2&&Boolean(progressFresh);
 const headline=failing.length?'Background service checks failing':accountIssues?'Account/workflow issues':clear?'Current checks clear':'Current impact unverified';
 const quota=snapshot.researchQuota;
 const research=quota?.fresh&&freshAt(quota.checkedAt,now)&&quota.status!=='available'
  ?`\nContact research capacity: ${quota.status.replaceAll('_',' ')}.${quota.nextAvailableAt?` Next capacity check: ${reliabilityEmailTime(quota.nextAvailableAt)}.`:''}`:'';
 return {headline,clear,impact,details:`Evidence checked: ${reliabilityEmailTime(snapshot.checkedAt)}.\nBackground checks: ${checks}.${progressFresh&&progress.checkedAt!==snapshot.checkedAt?`\nAccount evidence checked: ${reliabilityEmailTime(progress.checkedAt)}.`:''}${research}`,
  nextAction:failing.length?`Check ${failureList} and verify that affected tasks are completing again.`:
   responding.length<2||!clear&&!accountIssues?refresh:
   accountIssues?'Review affected work and verify original outcomes before retrying.':
   'Continue monitoring; do not clear unresolved work from this snapshot alone.'};
}
/** Never put account IDs, recipient details or raw provider data in owner email. */
export function reliabilityNotificationContext(value:unknown,now=Date.now()){
 const {impact,details}=notificationEvidence(value,now);
 return `${impact}\n${details}`;
}
export function reliabilityEmailContent(claim:ReturnType<typeof reliabilityAlertClaimSchema.parse>,value:unknown,now=Date.now()){
 const detected=claim.event==='detected',evidence=notificationEvidence(value,now);
 const priority=reliabilitySeverityLabels[claim.severity];
 const status=detected?'Incident status update. No clear recovery window recorded yet.':
  evidence.clear?'A clear recovery window was recorded. The latest checks are also clear.':
  'A clear recovery window was recorded, but newer or unavailable checks do not verify current health.';
 const subject=detected?`iCash X · ${priority} priority update — ${evidence.headline}`:`iCash X · Recovery window recorded${evidence.clear?'':' — current health needs verification'}`;
 const headline=detected?evidence.headline:'Recovery window recorded';
 const nextAction=`${detected&&claim.severity==='critical'&&!evidence.clear?'Investigate now. ':''}${evidence.nextAction}`;
 const guard='Full outage not established. Check original provider receipts before repeating any send or payment.';
 const dashboard='https://www.geticashx.com/admin';
 const incident=`Incident started: ${reliabilityEmailTime(claim.openedAt)}\nIncident reference: ${claim.incidentId}`;
 const text=`Next action: ${nextAction}\n\n${headline}\n${status}\n${evidence.impact}\n\n${guard}\nReview: ${dashboard}\n\n${evidence.details}\n${incident}`;
 const esc=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
 const detailHtml=esc(`${evidence.details}\n${incident}`).replaceAll('\n','<br>');
 const html=`<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#f1f5f9"><div lang="en" dir="ltr" style="padding:16px">
<div style="max-width:560px;margin:0 auto;padding:20px;background:#ffffff;color:#172033;font-family:Arial,sans-serif;font-size:16px;line-height:1.5;overflow-wrap:anywhere">
<p style="margin:0;color:#475569;font-size:14px;font-weight:bold">iCash X · ${detected?esc(priority)+' priority update':'Recovery update'}</p>
<h1 style="margin:8px 0 12px;font-size:25px;line-height:1.25">${esc(headline)}</h1>
<p style="margin:0 0 12px">${esc(status)}</p>
<h2 style="margin:0 0 4px;font-size:17px">Impact</h2>
<p style="margin:0 0 16px">${esc(evidence.impact)}</p>
<div style="padding:12px;background:#eff6ff;color:#172033">
<h2 style="margin:0 0 4px;font-size:17px">Next action</h2><p style="margin:0">${esc(nextAction)}</p>
</div>
<p style="margin:12px 0">${esc(guard)}</p>
<p style="margin:0 0 16px"><a style="color:#1e40af;font-weight:bold" href="${dashboard}">Open the iCash X workflow dashboard</a></p>
<div style="border-top:1px solid #cbd5e1;padding-top:12px;color:#475569;font-size:14px">
<h2 style="margin:0 0 4px;font-size:15px">Check details</h2><p style="margin:0">${detailHtml}</p>
</div></div></div></body></html>`;
 return {subject,text,html};
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
 // A failed context read must not suppress the already-claimed incident alert.
 const current=await db<unknown>('rpc/icash_reliability_status','POST',{}).catch(()=>null);
 const message={from:`iCash X <${config.from}>`,to:[recipient],...reliabilityEmailContent(claim,current)};
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
