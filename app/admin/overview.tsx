'use client';
import {useEffect,useState} from 'react';
import {AccountAccess} from '@/components/account-access';
import {webinarRequest as workspaceRequest} from '@/lib/webinar-client';
import {overviewLeadStatus,overviewMoney,overviewTime,validOwnerOverview,type OwnerOverview,type OverviewFilters} from '@/lib/owner-overview';
import styles from './overview.module.css';

export function OwnerOverviewView(){
 const [filters,setFilters]=useState<OverviewFilters>({days:30,includeOwner:false,query:'',page:1});
 const [search,setSearch]=useState(''),[refresh,setRefresh]=useState(0);
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
    if(!validOwnerOverview(data.report,{days,includeOwner,query,page}))throw Error('The overview returned incomplete data. Please refresh.');
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
 return <main className={styles.page}>
  <nav className={styles.nav} aria-label="Admin navigation"><a href="/">← Workspace</a><span>iCash X <b>Owner</b></span></nav>
  <header className={styles.heading}><div><h1>Overview</h1><p>Your leads and usage earnings, in one place.</p></div>{!denied&&<button className={styles.button} onClick={reload} disabled={busy}>{busy?'Refreshing…':'Refresh'}</button>}</header>
  {denied?<section className={styles.empty}><h2>{denied===401?'Sign in to your owner account':'Owner access only'}</h2><p>{denied===401?'This overview is private.':'Your signed-in account does not have access to this overview.'}</p>{denied===401&&<AccountAccess onSignedIn={()=>{setDenied(null);reload();}}/>}</section>:<>
   <div className={styles.toolbar}>
    <div className={styles.periods} role="group" aria-label="Reporting period">{([1,7,30] as const).map(period=><button key={period} aria-pressed={days===period} onClick={()=>update({days:period})}>{period===1?'Today':`${period} days`}</button>)}</div>
    <label className={styles.checkbox}><input type="checkbox" checked={includeOwner} onChange={e=>update({includeOwner:e.target.checked})}/>Include my account in usage</label>
   </div>
   {error&&<div className={styles.notice} role="alert"><strong>{report?'Refresh failed. Showing the last saved view.':'Overview unavailable.'}</strong><span>{error}</span><button onClick={reload} disabled={busy}>Try again</button></div>}
   <section className={styles.metrics} aria-label="Overview totals" aria-busy={busy}>
    <article><h2>Inbound leads</h2><strong>{report?report.leadCount.toLocaleString('en-US'):'—'}</strong><p>{report?`${report.reviewCount} need review`:'Loading leads…'}</p></article>
    <article><h2>Usage charged</h2><strong>{usage?overviewMoney(usage.chargedCents,'cents'):'—'}</strong><p>{usage?usage.missingChargeCount?'Charges pending':`${usage.completedCount} completed operations`:'Loading usage…'}</p></article>
    <article><h2>Usage costs{estimated&&<span className={styles.tag}>Estimated</span>}</h2><strong>{usage?overviewMoney(usage.costMicros):'—'}</strong><p>{usage?usage.missingCostCount?`${overviewMoney(usage.knownCostMicros)} recorded · ${usage.missingCostCount} missing`:'Recorded cost of completed usage':'Loading costs…'}</p></article>
    <article className={styles.earnings}><h2>Usage margin{estimated&&<span className={styles.tag}>Estimated</span>}</h2><strong>{usage?overviewMoney(usage.marginMicros):'—'}</strong><p>{usage?usage.marginMicros===null?'Waiting for complete costs and charges':'Usage charged minus usage costs':'Loading margin…'}</p></article>
   </section>
   <div className={styles.meta}><span>{includeOwner?'Customers + your account':'Customer usage only'} · Central time</span><span role="status">{report?`${error?'Last successful update':'Updated'} ${overviewTime(report.endAt)} CT`:error?'No totals available':'Loading overview…'}</span></div>
   {usage&&usage.pendingCount>0&&<p className={styles.pending}>{usage.pendingCount} operations started in this period are still awaiting settlement. They are not included in these totals.</p>}
   {usage&&usage.completedCount===0&&!includeOwner&&<p className={styles.pending}>No customer usage in this period. Turn on “Include my account” to see your own usage.</p>}
   <section className={styles.leads} aria-labelledby="inbound-leads-title">
    <div className={styles.leadHeading}><div><h2 id="inbound-leads-title">Inbound seller leads</h2><p>Newest first. Select a property for contact details.</p></div>
     <form className={styles.search} role="search" onSubmit={e=>{e.preventDefault();update({query:search.trim()});}}><label htmlFor="admin-lead-search" className={styles.srOnly}>Search leads by name, property, phone or email</label><input id="admin-lead-search" type="search" value={search} maxLength={100} placeholder="Search leads" onChange={e=>setSearch(e.target.value)}/><button type="submit" className={styles.button}>Search</button></form>
    </div>
    {query&&<p className={styles.searchNote}>Results for “{query}” <button onClick={()=>{setSearch('');update({query:''});}}>Clear search</button><span>Totals above cover the full period.</span></p>}
    {report&&report.leads.length>0?<table className={styles.table}><thead><tr><th scope="col">Seller & property</th><th scope="col">Source</th><th scope="col">Status</th><th scope="col">Received · CT</th></tr></thead><tbody>{report.leads.map(lead=><tr key={lead.id}>
     <td><details className={styles.leadDetails}><summary><strong>{lead.address}</strong><span>{lead.name}</span></summary><div><p>{lead.phone}</p>{lead.email&&<p>{lead.email}</p>}<p>Assigned to: {lead.assignedTo??'Awaiting assignment'}</p>{lead.campaign&&<p>Campaign: {lead.campaign}</p>}</div></details></td>
     <td><span className={styles.source}>{lead.source}</span></td><td><span className={styles.status}>{overviewLeadStatus(lead.state)}</span></td><td><time dateTime={lead.createdAt}>{overviewTime(lead.createdAt)}</time></td>
    </tr>)}</tbody></table>:<div className={styles.empty} role="status">{report?query?'No leads match this search.':page>1?'No more leads on this page.':'No inbound seller leads in this period.':error?'Leads could not be loaded.':'Loading leads…'}</div>}
    {report&&<div className={styles.pagination}><span>{report.matchedCount===0?'0 leads':report.leads.length===0?`${report.matchedCount} leads total`:`${(page-1)*25+1}–${(page-1)*25+report.leads.length} of ${report.matchedCount} leads`}</span><div><button className={styles.button} disabled={busy||page<=1} onClick={()=>update({page:page-1})}>Previous</button><button className={styles.button} disabled={busy||page*25>=report.matchedCount} onClick={()=>update({page:page+1})}>Next</button></div></div>}
   </section>
   <details className={styles.explanation}><summary>How these numbers work</summary><div><p>Leads are unique seller submissions received during the selected period. Repeat submissions are excluded. The account switch changes usage totals only.</p><p>Usage charged is whole cents deducted from work credits for completed operations, after subtracting platform-covered overruns. Fractional charges appear when they are posted. Credits can include promotional grants; this is not a cash-receipts report.</p><p>Usage costs include recorded provider costs and allocated overhead. Estimates are labelled. Missing costs or charges leave the margin blank. Credit top-ups, unused credits, subscriptions, standalone advertising spend and assignment proceeds are not usage earnings.</p><p>Your account is excluded unless you turn on the switch. Accounts funded only in payment test mode are excluded. Usage margin is not a withdrawable balance.</p>{usage&&usage.coveredCents>0&&<p>Platform-covered usage in this period: {overviewMoney(usage.coveredCents,'cents')}.</p>}</div></details>
  </>}
 </main>;
}
