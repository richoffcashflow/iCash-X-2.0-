'use client';
import {useEffect,useState} from 'react';
import {webinarRequest} from '@/lib/webinar-client';
import {platformLearningReportSchema,sharedEvidenceReady,sharedLearningWinner,type PlatformLearningReport} from '@/lib/shared-learning';
import styles from './platform-learning-report.module.css';
const domains=[['seller_filters','Property sourcing'],['market','Market ranking'],['seller_calls','Seller calls'],['seller_sms','Seller texts'],['seller_recovery','Seller follow-up'],['buyer_search','Buyer discovery']] as const;
const labels:Record<string,string>={cash_interest:'Direct cash interest',flexible_timing:'Price and timing',recent_corporate:'Recent corporate buyers first',corporate_owners:'Corporate owners first',baseline:'Baseline',vacant:'Vacant homes',absentee:'Absentee owners',repairs:'Repair needs',market:'Market outcomes',direct:'Direct question',timing:'Timing question'};
const amount=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
export function PlatformLearningReport({refresh=0}:{refresh?:number}){
 const [report,setReport]=useState<PlatformLearningReport|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();let active=true;
  webinarRequest<{report:unknown}>('/api/admin/learning',{cache:'no-store',signal:controller.signal}).then(r=>{const parsed=platformLearningReportSchema.parse(r.report);if(active){setReport(parsed);setError('');}}).catch(e=>{if(active){if(e?.status===401||e?.status===403){setReport(null);setError('Owner access is required to view platform learning.');}else setError('Learning data could not refresh. Any figures below are the last saved view.');}});
  return()=>{active=false;controller.abort();};
 },[refresh]);
 return <section className={styles.panel} aria-labelledby="platform-learning-heading">
  <div className={styles.heading}><div><span className={styles.eyebrow}>Across iCash X</span><h2 id="platform-learning-heading">Platform learning</h2></div><span className={styles.badge}>Shared evidence · Private accounts</span></div>
  <p>Results from comparable work guide the next approved approach across accounts. Each conversation keeps its assigned approach.</p>
  {error&&<p role="alert">{error}</p>}
  {!report&&!error&&<p role="status">Loading shared results…</p>}
  {report&&<>
   <div className={styles.summary}><div><strong>3 accounts</strong><span>Minimum contributors per approach</span></div><div><strong>40% exploration</strong><span>At least, after shared evidence qualifies</span></div><div><strong>{report.lastRefresh?new Date(report.lastRefresh).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true}):'Collecting'}</strong><span>Latest completed refresh</span></div></div>
   {report.failedAccounts>0&&<p role="status">{report.failedAccounts.toLocaleString()} account refreshes need review. Stale evidence is excluded from decisions.</p>}
   {report.dueAccounts>0&&<p className={styles.muted}>{report.dueAccounts.toLocaleString()} account refreshes queued.</p>}
   <div className={styles.domains}>{domains.map(([key,title])=>{
    const cohorts=report.cohorts.filter(c=>c.domain===key);
    const count=cohorts.reduce((n,c)=>n+c.stats.reduce((sum,s)=>sum+s.attempts,0),0);
    const ready=cohorts.some(c=>key==='market'?c.stats.some(s=>s.contributors>=3&&s.effective_attempts>=60):key==='seller_filters'?c.stats.filter(s=>sharedEvidenceReady(s)&&s.costs_complete&&s.effective_cost_cents>0).length>=2:!!sharedLearningWinner(c.stats,key==='seller_calls'?['cash_interest','flexible_timing']:key==='buyer_search'?['recent_corporate','corporate_owners']:c.stats.map(s=>s.variant),key==='seller_recovery'));
    const disabled=key==='seller_filters'&&!report.filterEnabled||key==='seller_recovery'&&report.recoveryEnabled===0;
    return <details key={key} className={styles.domain}><summary><span><strong>{title}</strong><small>{count.toLocaleString()} recorded observations</small></span><span>{disabled?'Paused by existing controls':ready?'Shared evidence eligible':'Collecting evidence'}</span></summary>
     {!cohorts.length?<p>No eligible observations yet. Existing account rules continue to apply.</p>:cohorts.map(c=><div key={`${c.context}:${c.market}`} className={styles.cohort}><h3>{c.market==='*'?'Across markets':`ZIP ${c.market}`} <span>· {c.context.replaceAll('_',' ').replaceAll(':',' · ')}</span></h3><div className={styles.scroll}><table><caption className={styles.srOnly}>{title} evidence for {c.context}, {c.market}</caption><thead><tr><th scope="col">Approach</th><th scope="col">Accounts</th><th scope="col">Observed / pending</th><th scope="col">Positive</th><th scope="col">Contracts / 30-day cohort</th><th scope="col">Closings / 60-day cohort</th><th scope="col">Opt-outs</th><th scope="col">Settled charges</th></tr></thead><tbody>{c.stats.map(s=><tr key={s.variant}><th scope="row">{labels[s.variant]??s.variant}</th><td>{s.contributors}</td><td>{s.attempts.toLocaleString()} / {s.pending.toLocaleString()}</td><td>{s.positive.toLocaleString()}</td><td>{s.contracts} / {s.contract_trials}</td><td>{s.closings} / {s.closing_trials}</td><td>{s.opted_out}</td><td>{s.costs_complete?amount(s.cost_cents):'Incomplete receipts'}</td></tr>)}</tbody></table></div></div>)}
     <p className={styles.muted}>{key==='seller_sms'?'Positive means a reply, not qualified interest. Ownership and opt-out wording remain required.':key==='buyer_search'?'Positive means a reviewed, ready buyer match. A search result alone does not qualify a buyer.':key==='seller_recovery'?'Replies are observed; only verified contracts or closings can favor a follow-up. Disabled copy stays disabled.':'Positive means recorded seller interest. It is not a signed contract or a completed closing.'}</p>
    </details>;
   })}</div>
   <div className={styles.note}><strong>Conversion learning is shared too.</strong><p>Seller opt-in pages already compare outcomes across visitors. New workspace accounts can use mature, verified funding results; existing accounts keep their assigned view. See the conversion report below.</p></div>
   <details className={styles.method}><summary>How learning stays grounded</summary><p>Shared comparisons require mature samples and at least three contributing accounts. Each account contributes at most 200 weighted observations per approach, so one large account cannot dominate. Calls and messages retain pending response windows; contract and closing comparisons use complete 30- and 60-day windows.</p><p>Contracts require matching live provider signature receipts. Closings also require a confirmed reply from a verified title contact. Settled charges are customer usage charges, not platform profit. A closing does not establish that proceeds arrived.</p><p>Scores choose only approved alternatives. Spending limits, prices, contact permission, account controls and agreement terms remain authoritative. Support conversations need verified resolution feedback before they can establish successful outcomes.</p></details>
   {report.cohortsTruncated&&<p className={styles.muted}>Showing the first 200 cohorts. Totals on this panel are partial.</p>}
  </>}
 </section>;
}
