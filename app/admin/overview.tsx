'use client';
import {useEffect,useState} from 'react';
import {AccountAccess} from '@/components/account-access';
import {webinarRequest as workspaceRequest} from '@/lib/webinar-client';
import {overviewMoney,overviewTime,overviewLeadStatus,validOwnerOverview,type OwnerOverview,type OverviewFilters} from '@/lib/owner-overview';
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
 const [search,setSearch]=useState('');
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
  <header className={styles.heading}><div><h1>Overview</h1><p>Inbound leads, outbound outreach and usage earnings.</p></div>{!denied&&<button className={styles.button} onClick={reload} disabled={busy}>{busy?'Refreshing…':'Refresh'}</button>}</header>
  {denied?<section className={styles.empty}><h2>{denied===401?'Sign in to your owner account':'Owner access only'}</h2><p>{denied===401?'This overview is private.':'Your signed-in account does not have access to this overview.'}</p>{denied===401&&<AccountAccess onSignedIn={()=>{setDenied(null);reload();}}/>}</section>:<>
   <div className={styles.toolbar}>
    <div className={styles.periods} role="group" aria-label="Reporting period">{([1,7,30] as const).map(period=><button key={period} aria-pressed={days===period} onClick={()=>update({days:period})}>{period===1?'Today':`${period} days`}</button>)}</div>
    <label className={styles.checkbox}><input type="checkbox" checked={includeOwner} onChange={e=>update({includeOwner:e.target.checked})}/>Include my account in usage & outreach</label>
   </div>
   <nav className={styles.activityNav} aria-label="Lead activity"><a href="#outbound-leads">Outbound · DealMachine</a><a href="#inbound-leads">Inbound · Seller requests</a></nav>
   <OwnerOutreachView key={`${days}:${includeOwner}`} days={days} includeOwner={includeOwner} refresh={refresh}/>
   <section id="inbound-leads" className={styles.inbound} aria-labelledby="inbound-title" aria-busy={busy}>
    <header className={styles.leadHeading}><div><h2 id="inbound-title">Inbound seller leads</h2><p>Seller requests from Meta forms and your website, including leads still collecting an address.</p></div><span role="status">{report?`${error?'Last successful update':'Updated'} ${overviewTime(report.endAt)} CT`:error?'Inbound activity unavailable':'Loading inbound leads…'}</span></header>
    {error&&<p className={styles.searchNote}>{report?'Refresh failed. Showing the last saved inbound activity.':'Inbound activity could not be loaded.'} <button onClick={reload} disabled={busy}>Retry inbound</button></p>}
    <div className={styles.metrics} aria-label="Inbound lead totals">
     <article><h2>Seller requests</h2><strong>{report?report.leadCount.toLocaleString('en-US'):'—'}</strong><p>Received in the selected period</p></article>
     <article><h2>Assigned</h2><strong>{report?.funnel?report.funnel[1].count.toLocaleString('en-US'):'—'}</strong><p>Requests matched to an account</p></article>
     <article><h2>Needs review</h2><strong>{report?report.reviewCount.toLocaleString('en-US'):'—'}</strong><p>Property or address checks need attention</p></article>
    </div>
    <div className={styles.leads}>
     <div className={styles.leadHeading}><div><h3>Recent inbound leads</h3><p>Newest requests first · Central time</p></div><form className={styles.search} role="search" aria-label="Search inbound leads" onSubmit={e=>{e.preventDefault();update({query:search.trim()});}}><label className={styles.srOnly} htmlFor="inbound-search">Search inbound seller or property</label><input id="inbound-search" type="search" maxLength={100} value={search} placeholder="Seller or property" onChange={e=>setSearch(e.target.value)}/><button className={styles.button} type="submit">Search inbound</button></form></div>
     {query&&<p className={styles.searchNote}>Results for “{query}” <button onClick={()=>{setSearch('');update({query:''});}}>Clear inbound search</button></p>}
     {report&&report.leads.length>0?<table className={styles.table}><caption className={styles.srOnly}>Inbound seller requests, source and assigned account</caption><thead><tr><th scope="col">Seller / property</th><th scope="col">Source</th><th scope="col">Status / account</th><th scope="col">Received · CT</th></tr></thead><tbody>{report.leads.map(lead=><tr key={lead.id}>
      <td><details className={styles.leadDetails}><summary><strong>{lead.name||'Seller request'}</strong><span>{lead.address||'Waiting for property address'}</span></summary><div><p>Phone: {lead.phone}</p>{lead.email&&<p>Email: {lead.email}</p>}{lead.campaign&&<p>Campaign: {lead.campaign}</p>}<p>Lead reference: {lead.id}</p></div></details></td>
      <td className={styles.source}>{lead.source==='meta'?'Meta form':lead.source==='direct'?'Website / direct':lead.source}</td>
      <td><span className={styles.status}>{overviewLeadStatus(lead.state)}</span><p>{lead.assignedTo||'Not assigned yet'}</p></td>
      <td><time dateTime={lead.createdAt}>{overviewTime(lead.createdAt)}</time></td>
     </tr>)}</tbody></table>:<p className={styles.empty} role="status">{report?'No inbound leads match this period and search.':error?'Inbound activity unavailable.':'Loading inbound leads…'}</p>}
     {report&&<div className={styles.pagination}><span>{report.matchedCount===0?'0 leads':report.leads.length===0?`${report.matchedCount.toLocaleString('en-US')} leads total`:`${((page-1)*25+1).toLocaleString('en-US')}–${((page-1)*25+report.leads.length).toLocaleString('en-US')} of ${report.matchedCount.toLocaleString('en-US')} leads`}</span><div><button className={styles.button} disabled={busy||page<=1} onClick={()=>update({page:page-1})}>Previous inbound leads</button><button className={styles.button} disabled={busy||page*25>=report.matchedCount} onClick={()=>update({page:page+1})}>Next inbound leads</button></div></div>}
    </div>
    <p className={styles.inboundNote}>Inbound describes where the seller request started, not the direction of every call or text. These platform-wide requests are separate from DealMachine properties. Search changes this list only; the account switch changes usage and outbound totals. A request or assignment does not mean the seller is interested or a deal is ready.</p>
   </section>
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
