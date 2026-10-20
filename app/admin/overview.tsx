'use client';
import {useEffect,useState} from 'react';
import {AccountAccess} from '@/components/account-access';
import {webinarRequest as workspaceRequest} from '@/lib/webinar-client';
import {overviewMoney,overviewTime,validOwnerOverview,type OwnerOverview,type OverviewFilters} from '@/lib/owner-overview';
import styles from './overview.module.css';
import {ClosingOperationsView} from './closing-operations';
import {reliabilityIssueLabels} from '@/lib/reliability';
import {reliabilityPriority,reliabilityItemPriority,reliabilitySeverityLabels,reliabilitySeverityGuidance} from '@/lib/reliability-priority';
import {ExperienceHealth} from './experience-health';
import {UsageLoopReport} from '@/components/usage-loop-report';
import {OwnerOutreachView} from './outreach';

export function OwnerOverviewView(){
 const [filters,setFilters]=useState<OverviewFilters>({days:30,includeOwner:false,query:'',page:1});
 const [refresh,setRefresh]=useState(0);
 const [loaded,setLoaded]=useState<{key:string;report:OwnerOverview}|null>(null);
 const [failure,setFailure]=useState<{key:string;message:string}|null>(null);
 const [busy,setBusy]=useState(true),[denied,setDenied]=useState<401|403|null>(null);
 const {days,includeOwner,query,page}=filters,key=JSON.stringify(filters);
 const report=loaded?.key===key?loaded.report:null,error=failure?.key===key?failure.message:null;
 useEffect(()=>{
  let active=true,inFlight=false,controller:AbortController|null=null,accessDenied=false;
  async function load(){
   if(inFlight||accessDenied)return;
   inFlight=true;controller=new AbortController();setBusy(true);
   try{
    const params=new URLSearchParams({days:String(days),includeOwner:String(includeOwner),q:query,page:String(page)});
    const data=await workspaceRequest<{report:OwnerOverview}>(`/api/admin/overview?${params}`,{cache:'no-store',signal:controller.signal});
    if(!active)return;
    if(!validOwnerOverview(data.report,{days,includeOwner,query,page})||!data.report.funnel)throw Error('The overview returned incomplete data. Please refresh.');
    setLoaded({key,report:data.report});setFailure(null);setDenied(null);
   }catch(e){
    if(!active)return;
    const status=(e as {status?:number})?.status;
    if(status===401||status===403){accessDenied=true;setLoaded(null);setDenied(status);setFailure(null);}
    else setFailure({key,message:e instanceof Error?e.message:'Could not load the overview.'});
   }finally{inFlight=false;if(active)setBusy(false);}
  }
  void load();
  const visible=()=>{if(document.visibilityState==='visible')void load();};
  const timer=setInterval(visible,60000);
  document.addEventListener('visibilitychange',visible);
  window.addEventListener('focus',visible);
  return()=>{active=false;controller?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',visible);};
 },[days,includeOwner,query,page,key,refresh]);
 const reload=()=>setRefresh(v=>v+1);
 function update(next:Partial<OverviewFilters>){setFilters(current=>({...current,...next,page:next.page??1}));}
 const usage=report?.usage,estimated=!!usage?.estimatedCount;
 const priority=report?reliabilityPriority(report.reliability??null):null;
 return <main className={styles.page}>
  <nav className={styles.nav} aria-label="Admin navigation"><a href="/">← Workspace</a><a href="/admin/launch">Customer launch ↗</a><a href="/admin/disputes">Disputes ↗</a><a href="/seller-operations#lead-costs">Lead costs ↗</a><span>iCash X <b>Owner</b></span></nav>
  <header className={styles.heading}><div><h1>Overview</h1><p>Your outreach, seller responses and usage earnings.</p></div>{!denied&&<button className={styles.button} onClick={reload} disabled={busy}>{busy?'Refreshing…':'Refresh'}</button>}</header>
  {denied?<section className={styles.empty}><h2>{denied===401?'Sign in to your owner account':'Owner access only'}</h2><p>{denied===401?'This overview is private.':'Your signed-in account does not have access to this overview.'}</p>{denied===401&&<AccountAccess onSignedIn={()=>{setDenied(null);reload();}}/>}</section>:<>
   <div className={styles.toolbar}>
    <div className={styles.periods} role="group" aria-label="Reporting period">{([1,7,30] as const).map(period=><button key={period} aria-pressed={days===period} onClick={()=>update({days:period})}>{period===1?'Today':`${period} days`}</button>)}</div>
    <label className={styles.checkbox}><input type="checkbox" checked={includeOwner} onChange={e=>update({includeOwner:e.target.checked})}/>Include my account in usage & outreach</label>
   </div>
   <OwnerOutreachView key={`${days}:${includeOwner}`} days={days} includeOwner={includeOwner} refresh={refresh}/>
   {report&&<section className={styles.notice} aria-label="Workflow reliability" role="status">
    <strong>Workflow reliability · {priority?`${reliabilitySeverityLabels[priority]} priority`:'Checks passing'}</strong>
    {priority&&<span>{reliabilitySeverityGuidance[priority]}</span>}
    {report.reliability?<>
     <span>Background worker: {report.reliability.components.worker.status} · Maintenance: {report.reliability.components.maintenance.status}</span>
     {!report.reliability.fresh&&<span>Monitoring is overdue. The saved results do not confirm current health.</span>}
     {report.reliability.snapshot&&<>
      <span>{report.reliability.snapshot.issueCount} items need review · Checked {overviewTime(report.reliability.snapshot.checkedAt)} CT</span>
      <span>Past 24 hours: {report.reliability.snapshot.texts.accepted} texts accepted, {report.reliability.snapshot.texts.delivered} delivery confirmations · {report.reliability.snapshot.contracts.created} contracts created, {report.reliability.snapshot.contracts.completed} signed.</span>
      {report.reliability.snapshot.issues.length>0&&<details><summary>Review stalled work</summary><ul>{report.reliability.snapshot.issues.map(issue=><li key={`${issue.kind}:${issue.resourceId}`}><strong>{reliabilitySeverityLabels[reliabilityItemPriority(issue)]} · {reliabilityIssueLabels[issue.kind]}</strong> · {overviewTime(issue.since)} CT · Reference {issue.resourceId}<br/>Check the saved provider receipt before repeating any action.</li>)}</ul>{report.reliability.snapshot.issueCount>25&&<p>Showing the 25 oldest items.</p>}</details>}
     </>}
    </>:<span>Monitoring could not be loaded. Refresh to try again.</span>}
   </section>}
   {report&&<div className={styles.notice} role="status">{report.costHealth?<><strong>Platform cost reconciliation</strong><span>{report.costHealth.pendingCount} operations awaiting final costs · {report.costHealth.agedCount} older than 24 hours · {report.costHealth.unreconciledObservations} provider observations awaiting reconciliation.</span>{report.costHealth.oldestAt&&<span>Oldest pending: {overviewTime(report.costHealth.oldestAt)}</span>}</>:<span>Cost reconciliation status is unavailable. Pending costs are not confirmed profit.</span>}</div>}
   {report&&<ExperienceHealth/>}
   {error&&<div className={styles.notice} role="alert"><strong>{report?'Refresh failed. Showing the last saved view.':'Overview unavailable.'}</strong><span>{error}</span><button onClick={reload} disabled={busy}>Try again</button></div>}
   <section className={styles.metrics} aria-label="Overview totals" aria-busy={busy}>
    <article><h2>Usage charged</h2><strong>{usage?overviewMoney(usage.chargedCents,'cents'):'—'}</strong><p>{usage?usage.missingChargeCount?'Charges pending':`${usage.completedCount} completed operations`:'Loading usage…'}</p></article>
    <article><h2>Usage costs{estimated&&<span className={styles.tag}>Estimated</span>}</h2><strong>{usage?overviewMoney(usage.costMicros):'—'}</strong><p>{usage?usage.missingCostCount?`${overviewMoney(usage.knownCostMicros)} recorded · ${usage.missingCostCount} missing`:'Recorded cost of completed usage':'Loading costs…'}</p></article>
    <article className={styles.earnings}><h2>Usage margin{estimated&&<span className={styles.tag}>Estimated</span>}</h2><strong>{usage?overviewMoney(usage.marginMicros):'—'}</strong><p>{usage?usage.marginMicros===null?'Waiting for complete costs and charges':'Usage charged minus usage costs':'Loading margin…'}</p></article>
   </section>
   <div className={styles.meta}><span>{includeOwner?'Customers + your account':'Customer usage only'} · Central time</span><span role="status">{report?`${error?'Last successful update':'Updated'} ${overviewTime(report.endAt)} CT`:error?'No totals available':'Loading overview…'}</span></div>
   {usage&&usage.pendingCount>0&&<p className={styles.pending}>{usage.pendingCount} operations started in this period are still awaiting settlement. They are not included in these totals.</p>}
   {usage&&usage.completedCount===0&&!includeOwner&&<p className={styles.pending}>No customer usage in this period. Turn on “Include my account” to see your own usage.</p>}
   {report?.closing&&<ClosingOperationsView data={report.closing} chargedCents={report.usage.chargedCents}/>}
   {report&&<UsageLoopReport includeOwner={includeOwner} refresh={refresh}/>}
   <details className={styles.explanation}><summary>How these numbers work</summary><div><p>The account switch changes usage and outbound outreach totals.</p><p>Usage charged is whole cents deducted from work credits for completed operations, after subtracting platform-covered overruns. Fractional charges appear when they are posted. Credits can include promotional grants; this is not a cash-receipts report.</p><p>Usage costs include recorded provider costs and allocated overhead. Estimates are labelled. Missing costs or charges leave the margin blank. Credit top-ups, unused credits, subscriptions, standalone advertising spend and assignment proceeds are not usage earnings.</p><p>Your account is excluded unless you turn on the switch. Accounts funded only in payment test mode are excluded. Usage margin is not a withdrawable balance.</p>{usage&&usage.coveredCents>0&&<p>Platform-covered usage in this period: {overviewMoney(usage.coveredCents,'cents')}.</p>}</div></details>
  </>}
 </main>;
}
