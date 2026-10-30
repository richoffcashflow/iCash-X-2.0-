'use client';
import {useEffect,useRef,useState} from 'react';
import {webinarPost,webinarRequest} from '@/lib/webinar-client';
import {targetingCapabilityProblem} from '@/lib/dealmachine-targeting';
import {targetingReportSchema,type TargetingReport} from '@/lib/targeting-report';
import styles from './platform-learning-report.module.css';
const labels:Record<string,string>={baseline:'Baseline',vacant:'Vacant',absentee:'Absentee',repairs:'Estimated repairs $25k+',off_market:'Off market',sale_7_10:'Last sale 7–10 years ago',sale_10_plus:'Last sale over 10 years ago',buyer_fit:'Buyer requirements',out_of_state_absentee:'Out-of-state absentee',vacant_absentee:'Vacant + absentee',mobile:'Mobile-only export'};
const money=(value:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
const per100=(value:number|null)=>value===null?'Unavailable':(value*100).toFixed(2);
export function DealMachineTargetingReport({refresh=0}:{refresh?:number}){
 const [report,setReport]=useState<TargetingReport|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 const writing=useRef(false);
 useEffect(()=>{
  const controller=new AbortController();let active=true;
  webinarRequest<{report:unknown}>('/api/admin/targeting',{cache:'no-store',signal:controller.signal}).then(r=>{
   const parsed=targetingReportSchema.parse(r.report);if(active){setReport(parsed);setError('');}
  }).catch(e=>{if(active){if(e?.status===401||e?.status===403)setReport(null);setError('Targeting data could not refresh. Any figures below are a saved view; refresh before changing controls.');}});
  return()=>{active=false;controller.abort();};
 },[refresh,revision]);
 async function save(body:unknown){
  if(writing.current)return;writing.current=true;setBusy(true);
  try{await webinarPost('/api/admin/targeting',body);setRevision(v=>v+1);}
  catch{setError('The change could not be confirmed. Refresh saved settings before trying again.');}
  finally{writing.current=false;setBusy(false);}
 }
 const disabled=busy||!!error;
 return <section className={styles.panel} aria-labelledby="targeting-heading">
  <div className={styles.heading}><div><span className={styles.eyebrow}>DealMachine sourcing</span><h2 id="targeting-heading">Targeting experiments</h2></div><button type="button" disabled={busy} onClick={()=>setRevision(v=>v+1)}>Refresh</button></div>
  <p>Compare seller outcomes and actual costs within the same account and ZIP. New experiments keep half of available sourcing slots for the existing audiences, including a baseline share.</p>
  {error?<p role="alert">{error}</p>:!report?<p role="status">Loading targeting results…</p>:null}
  {report?<>
   <div className={styles.heading}><strong>{report.settings.enabled?'Experiments enabled, subject to readiness checks':'Experiments paused'}</strong><button type="button" disabled={disabled} onClick={()=>void save({action:'set_enabled',enabled:!report.settings.enabled})}>{report.settings.enabled?'Pause experiments':'Enable experiments'}</button></div>
   <p>{report.dedupReadyAccounts} of {report.configuredAccounts} sourcing accounts have current exclusion coverage. {report.dedupPending.toLocaleString()} exclusions await synchronization. Experiments wait for coverage; existing audiences retain their current controls.</p>
   <div className={styles.domains}>{report.experiments.map(e=>{
    const problem=targetingCapabilityProblem(e.definition,report.capabilities),mobilePending=e.definition.segment==='mobile'&&!report.settings.mobile_verified;
    return <div className={styles.domain} key={e.id}><div className={styles.heading}><strong>{labels[e.definition.segment]}</strong><button type="button" disabled={disabled||!e.enabled&&!!(problem||mobilePending)} onClick={()=>void save({action:'set_experiment',enabled:!e.enabled,definition:e.definition})}>{e.enabled?'Pause':'Enable'}</button></div><p>{problem?'Waiting for verified filter access.':mobilePending?'Waiting for an authorized mobile export verification.':e.enabled?'Included when account readiness checks pass.':'Available to enable.'} · Snapshot {e.definition.asOf}</p></div>;
   })}</div>
   <p>Last sale is a proxy for ownership duration. Buyer ranges require dated requirements from an identified buyer in the same account and market. Mobile does not verify ownership or consent; the comparison pool retains eligible landlines.</p>
   {!report.cohorts.length?<p>No attributed results yet. Enabling an experiment does not establish better performance.</p>:<div className={styles.scroll} tabIndex={0} aria-label="Scroll targeting results"><table><caption className={styles.srOnly}>Last 90 days by account, ZIP and targeting definition. Rates are per 100 dollars.</caption><thead><tr><th scope="col">Audience / account / ZIP</th><th scope="col">Properties / attempted / pending</th><th scope="col">Valid contacts</th><th scope="col">Qualified</th><th scope="col">Offers</th><th scope="col">Signed / 30-day samples</th><th scope="col">Research / all provider costs</th><th scope="col">Customer charges</th><th scope="col">Qualified / signed per $100 provider cost</th><th scope="col">Qualified / signed per $100 customer charges</th><th scope="col">Evidence</th></tr></thead><tbody>{report.cohorts.map(c=>{
    const experiment=report.experiments.find(e=>'target_'+e.id===c.strategy),label=labels[experiment?.definition.segment??c.strategy]??c.strategy;
    return <tr key={`${c.accountId}:${c.zip}:${c.strategy}`}><th scope="row">{label}<br/>{c.accountId.slice(0,8)} · {c.zip}{experiment?<><br/>Snapshot {experiment.definition.asOf}</>:null}</th><td>{c.properties} / {c.attempted} / {c.pendingAttempts}</td><td>{c.validContactProperties}</td><td>{c.qualifiedConversations}</td><td>{c.offers}</td><td>{c.signedContracts} / {c.matureContractSamples}</td><td>{c.costsComplete?`${money(c.researchCostMicros/1e6)} / ${money(c.providerCostMicros/1e6)}`:'Incomplete receipts'}</td><td>{c.costsComplete?money(c.costCents/100):'Incomplete receipts'}</td><td>{per100(c.qualifiedPerProviderDollar)} / {per100(c.contractsPerProviderDollar)}</td><td>{per100(c.qualifiedPerCustomerDollar)} / {per100(c.contractsPerCustomerDollar)}</td><td>{c.evidenceStatus==='review_required'?'Ready for review; no winner':c.evidenceStatus==='costs_incomplete'?'Costs incomplete':'Collecting'}</td></tr>;
   })}</tbody></table></div>}
   <p className={styles.muted}>Counts are distinct properties: valid contacts have a saved active, non-DNC likely-owner phone; qualified conversations pass the existing live seller qualification and financial gates. Qualification tracking starts with this release. Offers count saved price quotes returned to live seller calls, not proof they were heard or accepted. Contracts require verified, fully signed live purchase envelopes.</p>
   <p className={styles.muted}>Research costs cover property acquisition; total provider costs also include owner research and attributed outreach. Missing receipts suppress cost comparisons. At least 100 properties aged 30 days, 20 qualified conversations and 5 signed contracts only trigger review. These thresholds are not a significance test, and no winner is automatically promoted.</p>
   {report.cohortsTruncated?<p role="status">Showing the first 100 account and ZIP groups. These totals are partial.</p>:null}
  </>:null}
 </section>;
}
