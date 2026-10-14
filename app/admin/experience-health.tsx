'use client';
import {useEffect,useState} from 'react';
import {webinarRequest as workspaceRequest} from '@/lib/webinar-client';
import {overviewTime} from '@/lib/owner-overview';
import {workspaceExperienceSummarySchema,type WorkspaceExperienceSummary} from '@/lib/workspace-experience';
import {reliabilityAlertStatusSchema,type ReliabilityAlertStatus} from '@/lib/reliability-alerts';
import styles from './overview.module.css';

type ExperienceReport={experience:WorkspaceExperienceSummary;alerts:ReliabilityAlertStatus};
const stageLabels={workspace:'Workspace',property:'Property',buyers:'Buyers',buyer_details:'Buyer details',documents:'Documents',closing:'Closing',messages:'Messages',account:'Account'};
const configurationLabels={disabled:'Off',unconfigured:'Setup incomplete',ready:'Configured',recipient_unverified:'Owner email needs verification'};
const reasonLabels={worker:'Background worker',maintenance:'Maintenance',monitor:'Monitoring',workflows:'Stalled work'};

export function ExperienceHealth(){
 const [report,setReport]=useState<ExperienceReport|null>(null),[busy,setBusy]=useState(true);
 const [failed,setFailed]=useState(false),[denied,setDenied]=useState(false),[refresh,setRefresh]=useState(0);
 useEffect(()=>{
  let active=true,inFlight=false,accessDenied=false,controller:AbortController|null=null;
  async function load(){
   if(inFlight||accessDenied)return;
   inFlight=true;controller=new AbortController();setBusy(true);
   try{
    const data=await workspaceRequest<ExperienceReport>('/api/admin/experience',{cache:'no-store',signal:controller.signal});
    if(!active)return;
    const experience=workspaceExperienceSummarySchema.parse(data.experience),alerts=reliabilityAlertStatusSchema.parse(data.alerts);
    setReport({experience,alerts});setFailed(false);setDenied(false);
   }catch(error){
    if(!active)return;
    const status=(error as {status?:number})?.status;
    if(status===401||status===403){accessDenied=true;setReport(null);setDenied(true);setFailed(false);}
    else setFailed(true);
   }finally{inFlight=false;if(active)setBusy(false);}
  }
  void load();
  const visible=()=>{if(document.visibilityState==='visible')void load();};
  const timer=setInterval(visible,60000);
  document.addEventListener('visibilitychange',visible);window.addEventListener('focus',visible);
  return()=>{active=false;controller?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',visible);};
 },[refresh]);
 const counts=report?.experience.counts,total=(event:WorkspaceExperienceSummary['counts'][number]['event'])=>counts?.filter(item=>item.event===event).reduce((sum,item)=>sum+item.count,0)??0;
 const errors=counts?.filter(item=>item.event==='panel_error')??[];
 return <section className={styles.notice} aria-label="Workspace experience" aria-busy={busy}>
  <strong>Workspace experience · Past 7 days</strong>
  {denied?<span>Sign in with the owner account to view these checks.</span>:<>
   {report?<>
    <span>{total('panel_open').toLocaleString('en-US')} panel opens · {total('panel_error').toLocaleString('en-US')} panel errors · {total('panel_retry').toLocaleString('en-US')} retries</span>
    <details><summary>Review experience and alerts</summary>
     <p>These are recorded interface signals, not completed deals or a churn rate. Repeated signals may be grouped.</p>
     {errors.length>0&&<ul>{errors.map(item=><li key={item.stage}>{stageLabels[item.stage]}: {item.count.toLocaleString('en-US')} errors across {item.accounts.toLocaleString('en-US')} accounts</li>)}</ul>}
     <p>{report.experience.lastObservedAt?`Latest signal: ${overviewTime(report.experience.lastObservedAt)} CT`:'No interface signals recorded in this period.'}</p>
     <p><strong>Owner incident emails: {configurationLabels[report.alerts.configuration]}</strong>{report.alerts.checkedAt?` · Checked ${overviewTime(report.alerts.checkedAt)} CT`:' · Status has not been checked yet.'}</p>
     {report.alerts.active?<p>{report.alerts.active.issueCount} items need attention · {report.alerts.active.reasons.map(reason=>reasonLabels[reason]).join(', ')} · Opened {overviewTime(report.alerts.active.openedAt)} CT</p>:<p>{report.alerts.checkedAt?'No incident was open at the last check.':'Incident status is awaiting its first check.'}</p>}
     <p>Notifications: {report.alerts.notifications.pending} pending · {report.alerts.notifications.accepted} accepted by the email provider · {report.alerts.notifications.needsReview} need review. Provider acceptance does not confirm delivery.</p>
     {report.alerts.lastNotificationAt&&<p>Latest notification: {overviewTime(report.alerts.lastNotificationAt)} CT</p>}
    </details>
   </>:!failed&&<span>Loading experience checks…</span>}
   {failed&&<span role="alert">{report?'Refresh failed. Showing the last saved checks.':'Experience checks could not load.'}</span>}
   {failed&&<button type="button" onClick={()=>setRefresh(value=>value+1)} disabled={busy}>Try again</button>}
  </>}
 </section>;
}
