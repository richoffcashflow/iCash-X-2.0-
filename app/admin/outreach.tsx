'use client';
import {useEffect,useState} from 'react';
import {webinarRequest as workspaceRequest} from '@/lib/webinar-client';
import {overviewTime} from '@/lib/owner-overview';
import {outreachLeadStatus,validOwnerOutreach,type OwnerOutreach,type OutreachFilters,type OutreachStatus} from '@/lib/owner-outreach';
import styles from './outreach.module.css';
const n=(value:number)=>value.toLocaleString('en-US');
const statusOptions:[OutreachStatus,string][]=[['all','All activity'],['responded','Responded'],['interested','Interested'],['queued','Queued'],['held','On hold']];

export function OwnerOutreachView({days,includeOwner,refresh}:{days:1|7|30;includeOwner:boolean;refresh:number}){
 const [filters,setFilters]=useState({query:'',page:1,status:'all' as OutreachStatus});
 const [search,setSearch]=useState(''),[retry,setRetry]=useState(0);
 const [loaded,setLoaded]=useState<{key:string;report:OwnerOutreach}|null>(null);
 const [failure,setFailure]=useState<{key:string;message:string}|null>(null);
 const [busy,setBusy]=useState(true),[denied,setDenied]=useState(false);
 const {query,page,status}=filters,key=JSON.stringify({days,includeOwner,...filters});
 const report=loaded?.key===key?loaded.report:null,error=failure?.key===key?failure.message:null;
 useEffect(()=>{
  let active=true,inFlight=false,controller:AbortController|null=null,accessDenied=false;
  async function load(){
   if(inFlight||accessDenied)return;
   inFlight=true;controller=new AbortController();setBusy(true);
   try{
    const params=new URLSearchParams({days:String(days),includeOwner:String(includeOwner),q:query,page:String(page),status});
    const data=await workspaceRequest<{report:OwnerOutreach}>(`/api/admin/outreach?${params}`,{cache:'no-store',signal:controller.signal});
    if(!active)return;
    if(!validOwnerOutreach(data.report,{days,includeOwner,query,page,status}))throw Error('Outreach returned incomplete data. Please refresh.');
    setLoaded({key,report:data.report});setFailure(null);setDenied(false);
   }catch(e){
    if(!active)return;
    const code=(e as {status?:number})?.status;
    if(code===401||code===403){accessDenied=true;setLoaded(null);setFailure(null);setDenied(true);}
    else setFailure({key,message:e instanceof Error?e.message:'Could not load outreach activity.'});
   }finally{inFlight=false;if(active)setBusy(false);}
  }
  void load();
  const visible=()=>{if(document.visibilityState==='visible')void load();};
  const timer=setInterval(visible,30000);
  document.addEventListener('visibilitychange',visible);window.addEventListener('focus',visible);
  return()=>{active=false;controller?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',visible);};
 },[days,includeOwner,query,page,status,key,refresh,retry]);
 function update(next:Partial<Pick<OutreachFilters,'query'|'page'|'status'>>){setFilters(current=>({...current,...next,page:next.page??1}));}
 const t=report?.totals;
 return <section className={styles.panel} aria-labelledby="outreach-title" aria-busy={busy}>
  <header className={styles.heading}><div><span className={styles.eyebrow}>DealMachine · {days===1?'Today':`Past ${days} calendar days`}</span><h2 id="outreach-title">Outbound leads & outreach</h2><p>Real properties, calls, texts and seller responses.</p></div><span className={styles.updated} role="status">{denied?'Owner access required':report?`${error?'Last successful update':'Updated'} ${overviewTime(report.endAt)} CT`:'Loading outreach…'}</span></header>
  {denied?<p className={styles.empty}>Sign in with the owner account to view outreach activity.</p>:<>
   {error&&<div className={styles.notice} role="alert"><strong>{report?'Outreach refresh failed. Showing the last saved activity.':'Outreach unavailable.'}</strong><span>{error}</span><button onClick={()=>setRetry(v=>v+1)} disabled={busy}>Retry outreach</button></div>}
   <div className={styles.metrics} aria-label="Outbound activity totals">
    <article><h3>Eligible properties</h3><strong>{t?n(t.eligible):'—'}</strong><p>{t?`Of ${n(t.researched)} researched properties`:'Loading properties…'}</p></article>
    <article><h3>Calls attempted</h3><strong>{t?n(t.calls):'—'}</strong><p>{t?`${n(t.callResponses)} seller responses`:'Loading call receipts…'}</p></article>
    <article><h3>Texts delivered</h3><strong>{t?n(t.textsDelivered):'—'}</strong><p>{t?`${n(t.textReplies)} incoming replies`:'Loading delivery receipts…'}</p></article>
    <article className={styles.responses}><h3>Properties with responses</h3><strong>{t?n(t.respondedProperties):'—'}</strong><p>{t?`${n(t.interestedProperties)} with interested sellers`:'Loading responses…'}</p></article>
   </div>
   {t&&<div className={styles.channels}>
    <article><h3>Calls</h3><p><b>{n(t.conversations)}</b> completed AI calls · <b>{n(t.unanswered)}</b> unanswered · <b>{n(t.busy)}</b> busy · <b>{n(t.failed)}</b> failed / canceled</p><p className={styles.queue}>Currently <b>{n(t.queuedCalls)}</b> queued · <b>{n(t.heldCalls)}</b> on hold</p></article>
    <article><h3>Texts</h3><p><b>{n(t.textsAccepted)}</b> accepted by provider · <b>{n(t.textsDelivered)}</b> delivery confirmations · <b>{n(t.textReplies)}</b> replies</p><p className={styles.queue}>Currently <b>{n(t.queuedTexts)}</b> queued · <b>{n(t.heldTexts)}</b> on hold</p></article>
   </div>}
   <div className={styles.controls}>
    <div><h3>Property activity</h3><p>Interested sellers and responses first.</p></div>
    <form role="search" aria-label="Search outbound properties" onSubmit={e=>{e.preventDefault();update({query:search.trim()});}}><label className={styles.srOnly} htmlFor="outreach-search">Search property or account</label><input id="outreach-search" type="search" value={search} maxLength={100} placeholder="Property or account" onChange={e=>setSearch(e.target.value)}/><button type="submit">Search</button></form>
    <label className={styles.filter}>Show <select value={status} onChange={e=>update({status:e.target.value as OutreachStatus})}>{statusOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
   </div>
   {query&&<p className={styles.searchNote}>Results for “{query}” <button onClick={()=>{setSearch('');update({query:''});}}>Clear outreach search</button></p>}
   {report&&report.leads.length>0?<table className={styles.table}><caption className={styles.srOnly}>DealMachine properties and actual outreach activity in the selected period</caption><thead><tr><th scope="col">Property / account</th><th scope="col">Latest result</th><th scope="col">Calls / texts</th><th scope="col">Last activity · CT</th></tr></thead><tbody>{report.leads.map(lead=><tr key={lead.id}>
    <td><strong>{lead.address}</strong><span>{lead.account}</span><details><summary>Account reference</summary><small>{lead.accountId}</small></details></td>
    <td><b className={styles.badge}>{outreachLeadStatus(lead)}</b>{lead.paused&&<span>Account paused</span>}{lead.optedOut&&lead.responded&&<span>Reply included an opt-out</span>}</td>
    <td><span>{n(lead.calls)} calls · {n(lead.callResponses)} responses</span><span>{n(lead.textsDelivered)} texts delivered · {n(lead.textReplies)} replies</span>{lead.queuedCalls+lead.queuedTexts>0&&<small>{n(lead.queuedCalls)} calls / {n(lead.queuedTexts)} texts queued</small>}{lead.heldCalls+lead.heldTexts>0&&<small>{n(lead.heldCalls)} calls / {n(lead.heldTexts)} texts on hold</small>}</td>
    <td><time dateTime={lead.latestAt}>{overviewTime(lead.latestAt)}</time></td>
   </tr>)}</tbody></table>:<p className={styles.empty} role="status">{report?'No properties match this period and filter.':error?'Activity could not be loaded.':'Loading property activity…'}</p>}
   {report&&<div className={styles.pagination}><span>{report.matchedCount===0?'0 properties':report.leads.length===0?`${n(report.matchedCount)} properties total`:`${n((page-1)*25+1)}–${n((page-1)*25+report.leads.length)} of ${n(report.matchedCount)} properties`}</span><div><button disabled={busy||page<=1} onClick={()=>update({page:page-1})}>Previous properties</button><button disabled={busy||page*25>=report.matchedCount} onClick={()=>update({page:page+1})}>Next properties</button></div></div>}
   <details className={styles.explanation}><summary>What counts as a lead or response?</summary><p>These are DealMachine research properties and their seller outreach. An eligible property passed the single-family financial screen; it is not a confirmed interested seller. Calls need a saved provider attempt, delivered texts need a delivery receipt, and responses need an actual seller conversation or incoming message. A reply may be a refusal or opt-out. Interest requires an explicit positive call result and no recorded opt-out.</p><p>Activity totals use the selected calendar period in Central time. Queued and held counts show current pending work, including older items; those properties remain in the list. Property status reflects its recorded history. Search and status filters change the list, not the totals. Each property is counted within its assigned account. Your account and test-only accounts are excluded unless indicated; the switch includes your account only.</p><p>Provider acceptance does not confirm delivery. Queued work still follows consent, Pause, available credits and working hours. Refreshes every 30 seconds while this page is visible.</p></details>
  </>}
 </section>;
}
