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
 const unavailable=(reason:string,checkedAt?:string)=>({headline:'Current impact unverified',clear:false,
  context:`Scope: unknown. Current impact: unverified.\nWhole-platform outage: not established by the available evidence.\nWhat needs attention: ${reason}\nWhat works: unverified; a missing check does not prove every service has stopped.\nEvidence checked: ${checkedAt?reliabilityEmailTime(checkedAt)+' (not usable for current impact)':'unavailable'}. Do not infer recovery.`,
  nextAction:'Restore fresh monitoring and inspect the production services before deciding which work is affected.'});
 if(!parsed.success||!parsed.data.snapshot)return unavailable('Monitoring could not supply a valid snapshot.');
 const report=parsed.data,snapshot=report.snapshot!;
 if(!report.fresh||!freshAt(snapshot.checkedAt,now))return unavailable('The available monitoring snapshot is not fresh.',snapshot.checkedAt);
 if(snapshot.issueCount<snapshot.issues.length||snapshot.issueCount===0&&[snapshot.incomingTexts?.warningCount,snapshot.learning?.warningCount,snapshot.researchQuota?.warningCount].some(count=>(count??0)>0))return unavailable('The snapshot contains conflicting workflow counts. Current impact needs verification.',snapshot.checkedAt);
 const progress=snapshot.accountProgress;
 const progressFresh=progress&&freshAt(progress.checkedAt,now)&&
  progress.expiredConfigurations+progress.unexpectedPauses+progress.stalledAccounts+progress.pendingAccounts<=progress.affectedAccounts&&progress.samples.length<=progress.affectedAccounts;
 const impact=progressFresh
  ?`Accounts needing attention: ${progress.affectedAccounts}. Accounts with no recent completed task recorded: ${progress.stalledAccounts}. Accounts with earlier work awaiting confirmation: ${progress.pendingAccounts}. Expired configurations: ${progress.expiredConfigurations}; unexpected pauses: ${progress.unexpectedPauses}. These counts are not a count of confirmed outages or proof that all work in those accounts has stopped.`
  :'Account impact and interrupted work: unverified.';
 const components=(['worker','maintenance'] as const).map(name=>({name,label:name==='worker'?'background worker':'maintenance and recovery',...report.components[name],fresh:freshAt(report.components[name].checkedAt,now)}));
 const failing=components.filter(c=>c.fresh&&(c.status==='degraded'||c.status==='unavailable'));
 const responding=components.filter(c=>c.fresh&&c.status==='ok');
 const accountIssues=Boolean(progressFresh&&progress.affectedAccounts>0)||snapshot.issueCount>0;
 const clear=report.status==='ok'&&!accountIssues&&responding.length===2&&Boolean(progressFresh);
 const headline=failing.length?'Background service checks failing':accountIssues?'Account/workflow issues':clear?'Current checks clear':'Current impact unverified';
 const scope=failing.length?`Background services: ${failing.map(c=>c.label).join(', ')}.`:
  accountIssues?`Account/workflow issues. ${responding.length===2?'Both background checks are responding.':'Background service health is not fully verified.'}`:
  clear?'No active flags in the current check.':'Unknown. The current checks do not establish the cause or affected accounts.';
 const checks=components.map(c=>`${c.label}: ${c.fresh?c.status:'unverified'}${c.checkedAt?` (checked ${reliabilityEmailTime(c.checkedAt)}${c.fresh?'':'; not current'})`:''}`).join('; ');
 const attention=failing.length?'The listed background checks reported a problem. A missing heartbeat does not by itself prove the process stopped.':
  accountIssues?'The monitor found work requiring investigation or original-outcome confirmation. Pending receipts and missing completion records are not confirmed failed sends.':
  clear?'No active workflow flags or background-check failures were found in this snapshot.':'The monitor reports incomplete or unexplained health evidence.';
 const works=responding.length?`${responding.map(c=>c.label).join(' and ')} checks are responding. Heartbeats alone do not prove completed work.`:'No healthy background check was verified in this snapshot.';
 const quota=snapshot.researchQuota;
 const research=quota?.fresh&&freshAt(quota.checkedAt,now)
  ?`\nContact research capacity: ${quota.status.replaceAll('_',' ')}.${quota.nextAvailableAt?` Next capacity check: ${reliabilityEmailTime(quota.nextAvailableAt)}.`:''} Provider limits remain in effect.`:'';
 return {headline,clear,context:`Scope: ${scope}\nWhole-platform outage: not established. This alert does not test website access, sign-in or every call/text provider.\nWhat needs attention: ${attention}\nWhat works: ${works}\nEvidence checked: ${reliabilityEmailTime(snapshot.checkedAt)}. Current aggregate monitor flags: ${snapshot.issueCount}.\nOperational checks: ${checks}.\n${impact}${progressFresh?` Account evidence checked: ${reliabilityEmailTime(progress.checkedAt)}.`:''}${research}\nAmong records created in the past 24 hours: ${snapshot.texts.accepted} texts accepted by the provider, ${snapshot.texts.delivered} delivered; ${snapshot.contracts.completed} contracts completed. Earlier activity does not prove work is healthy now.`,
  nextAction:failing.length?'Check the failing background services and verify resumed task completion. Independent eligible work can continue within its controls.':
   responding.length<2||!clear&&!accountIssues?'Restore fresh background checks and identify the affected work before declaring recovery.':
   accountIssues?'Continue recovery of the affected work and reconcile its original provider receipts. Verify new completed work separately from historical pending receipts.':
   'Continue monitoring for sustained recovery; retain unresolved historical receipts and holds.'};
}
/** Never put account IDs, recipient details or raw provider data in owner email. */
export function reliabilityNotificationContext(value:unknown,now=Date.now()){
 return notificationEvidence(value,now).context;
}
export function reliabilityEmailContent(claim:ReturnType<typeof reliabilityAlertClaimSchema.parse>,value:unknown,now=Date.now()){
 const detected=claim.event==='detected',evidence=notificationEvidence(value,now);
 const labels={worker:'background worker',maintenance:'maintenance',monitor:'monitor freshness',workflows:'workflow recovery'};
 const reasons=claim.reasons.map(reason=>labels[reason]).join(', ')||'workflow checks';
 const priority=reliabilitySeverityLabels[claim.severity];
 const introduction=detected?`${priority} priority — ${evidence.headline}.\nIncident record when this alert was prepared: ${reasons}; ${claim.issueCount} monitor flag${claim.issueCount===1?'':'s'}. Flags are not a count of failed services, affected people or confirmed failed sends. Priority describes urgency, not the extent of an outage.`:
  'A clear recovery window was recorded for this incident. This confirms the monitored alert conditions cleared during that window; it does not confirm every message was delivered or every deal completed. Reviewed historical alerts may still have unresolved provider receipts or blocked work.';
 const recovery=detected?'A verified clear recovery window has not yet been recorded for this alert. Automatic recovery can continue for eligible work. Original uncertain provider outcomes stay held for verification.':
  evidence.clear?'The latest checks are also clear. Historical uncertain outcomes remain held until their original receipts are verified.':'Current health is not verified clear. The recorded recovery window does not override newer or unavailable observations above.';
 return {subject:detected?`iCash X · ${priority} priority — ${evidence.headline}`:`iCash X · Recovery window recorded${evidence.clear?'':' — current health needs verification'}`,
  text:`${introduction}\n\nIncident started: ${reliabilityEmailTime(claim.openedAt)}\n${evidence.context}\n\nRecovery status: ${recovery}\n\nNext action: ${detected&&claim.severity==='critical'?'Immediate investigation required. ':''}${evidence.nextAction}\nCheck original provider receipts before repeating any send or payment.\n\nReview the current state and acknowledged history: https://www.geticashx.com/admin\nIncident reference: ${claim.incidentId}`};
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
