'use client';
import {useEffect,useState} from 'react';
import type {UsageLoopReport as Report} from '@/lib/usage-loop-tracking';
import {webinarRequest} from '@/lib/webinar-client';
import styles from '@/app/admin/overview.module.css';

export function UsageLoopReport({includeOwner,refresh=0}:{includeOwner:boolean;refresh?:number}){
 const [loaded,setLoaded]=useState<{includeOwner:boolean;report:Report}|null>(null),[failed,setFailed]=useState(false);
 const report=loaded?.includeOwner===includeOwner?loaded.report:null;
 useEffect(()=>{
  const controller=new AbortController();let active=true;
  void webinarRequest<{report:Report}>(`/api/admin/usage-loop?includeOwner=${includeOwner}`,{cache:'no-store',signal:controller.signal})
   .then(data=>{if(active){setLoaded({includeOwner,report:data.report});setFailed(false);}})
   .catch(()=>{if(active)setFailed(true);});
  return()=>{active=false;controller.abort();};
 },[includeOwner,refresh]);
 const count=(n:number|undefined)=>n===undefined?'—':n.toLocaleString('en-US');
 const rate=(n:number,d:number)=>d?`${Math.round(n/d*100)}%`:'—';
 return <section className={styles.leads} aria-labelledby="usage-loop-title">
  <div className={styles.leadHeading}><div><h2 id="usage-loop-title">Funding & progress</h2><p>What happens after customers add work credits.</p></div></div>
  {failed&&<p role="status">{report?'Refresh unavailable. Showing the last report.':'Progress measurement is temporarily unavailable.'}</p>}
  <div className={styles.metrics} aria-label="First seven days after funding">
   <article><h3>First funding</h3><strong>{count(report?.cohort.firstFunded)}</strong><p>Accounts with a full 7 days to observe</p></article>
   <article><h3>First property result</h3><strong>{count(report?.cohort.firstResult)}</strong><p>Completed property analysis within 7 days</p></article>
   <article><h3>Second manual refill</h3><strong>{count(report?.cohort.secondManualRefill)}</strong><p>Another paid credit purchase within 7 days</p></article>
   <article><h3>Repeat usage</h3><strong>{count(report?.cohort.repeatUsage)}</strong><p>Usage charged on at least 2 days</p></article>
  </div>
  <p className={styles.searchNote}>First funding 30–7 days ago. Each account gets the same 7-day window. Milestones overlap; they are not necessarily completed in this order.</p>
  <details className={styles.explanation}><summary>Prompt engagement & message comparison</summary><div>
   <p>Past 7 days: {count(report?.recent.shownAccounts)} accounts saw a prompt · {count(report?.recent.clickedAccounts)} clicked · {count(report?.recent.dismissedAccounts)} dismissed.</p>
   <div style={{overflowX:'auto'}}><table className={styles.table}><caption>Funding prompts with a complete 7-day follow-through window</caption><thead><tr><th>Message</th><th>Accounts shown</th><th>Clicked</th><th>Paid manual funding</th></tr></thead><tbody>
    {(report?.variants??[]).map(v=><tr key={v.variant}><th scope="row">{v.variant==='control'?'Standard wording':'Progress wording'}</th><td>{count(v.observedAccounts)}</td><td>{count(v.clickedAccounts)}</td><td>{count(v.fundedAccounts)} · {rate(v.fundedAccounts,v.observedAccounts)}</td></tr>)}
   </tbody></table></div>
   {report?.variants.every(v=>v.observedAccounts===0)&&<p>Still collecting full 7-day observation windows.</p>}
   <p>Message assignment stays fixed per account. These are observed outcomes, not proof that one message caused a purchase. Small samples do not establish a winner.</p>
   <p>Payments require live paid orders matched to posted credit purchases. Manual refills exclude automatic recharge and recurring daily billing. Results require completed property analysis. Repeat usage requires charged work on two Central calendar dates. Test payments and grants do not count as funding. The owner account follows the switch above.</p>
   <p>Prompt events are optional browser measurements, so blocked tracking may leave gaps. Each account counts once per measure. Comparisons use its first visible funding prompt retained in the last 30 days and only subsequent manual purchases within 7 days. Expired prompt records are removed in bounded maintenance batches.</p>
  </div></details>
 </section>;
}
