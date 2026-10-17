import type {LeadSupplyPlan} from '@/lib/lead-supply';
import {overviewTime} from '@/lib/owner-overview';
import styles from './lead-supply.module.css';

const n=(value:number)=>value.toLocaleString('en-US');
export function LeadSupply({data,stale=false}:{data:LeadSupplyPlan|null;stale?:boolean}){
 if(!data)return <section className={styles.card} aria-label="Daily lead goal"><h2>Daily lead goal</h2><p>Lead supply could not be loaded. Refresh to try again.</p></section>;
 const labels={idle:'No active demand',short:'More leads needed',delivery_gap:'Users still waiting',healthy:'Healthy'};
 return <section className={styles.card} aria-labelledby="lead-goal-title">
  <div className={styles.heading}><div><h2 id="lead-goal-title">Daily lead goal</h2><p>For {n(data.activeAccounts)} funded, running {data.activeAccounts===1?'user':'users'} · past 24 hours</p></div><span className={styles.badge}>{stale?'Update needed':labels[data.status]}</span></div>
  <div className={styles.primary}><strong>{n(data.gap)}</strong><span>more {data.gap===1?'lead':'leads'} needed</span></div>
  <p className={styles.target}><b>{n(data.qualified24h)}</b> generated · <b>{n(data.healthyDaily)}</b> daily goal</p>
  <p className={styles.muted}>Counts qualified seller leads.</p>
  {data.healthyDaily>0&&<progress className={styles.progress} value={Math.min(data.qualified24h,data.healthyDaily)} max={data.healthyDaily} aria-label="Qualified leads toward the healthy daily goal"/>}
  <p className={styles.coverage}>{data.activeAccounts>0?<><b>{n(data.waitingAccounts)} {data.waitingAccounts===1?'user':'users'} still waiting for a lead.</b> {n(data.coveredAccounts24h)} of {n(data.activeAccounts)} received one in the past 24 hours.</>:<>The goal updates automatically when customers add credits and start their bots.</>}</p>
  {data.gap===0&&data.waitingAccounts>0&&<p className={styles.warning}>Generation target reached. Check lead delivery before increasing ad spend; some funded users still have no lead.</p>}
  <details className={styles.details}><summary>How the goal is calculated</summary>
   {data.pausedAccounts+data.unfundedAccounts+data.setupAccounts>0&&<p>Outside this target: {n(data.pausedAccounts)} paused · {n(data.unfundedAccounts)} without credits · {n(data.setupAccounts)} awaiting setup or review.</p>}
   <p>One inbound lead delivery per funded, running user each day, plus a 20% planning buffer. The current base target is {n(data.minimumDaily)} new qualified leads per day. This is an operating target, not a promised number of deals.</p>
   <p>{data.yieldSource==='observed'?`Using ${data.recipientsPerLead.toFixed(2)} recipients per qualified lead from ${n(data.matureLeads)} completed lead cohorts.`:'Until 10 completed lead cohorts are available, the plan assumes one recipient per new lead.'} Each lead can reach up to three users over time: immediately, after 24 hours, and after 72 hours. Future deliveries do not count as users served today.</p>
   <p>{data.submissionsDaily!==null&&data.qualificationRate!==null?`Estimated form submissions needed: ${n(data.submissionsDaily)} per day at the observed ${(data.qualificationRate*100).toFixed(0)}% qualification rate.`:'A form-submission target appears after at least 20 completed real requests and one qualified request. Only qualified leads fill the goal.'} Duplicate submissions and private demos are excluded. Your owner account and accounts funded only in test mode are excluded from demand.</p>
   <p>The lead gap compares new qualified sellers against the daily goal. Users waiting is a separate delivery check; surplus leads sent to one user cannot hide another user waiting. These numbers always cover the past 24 hours, regardless of the overview period.</p>
  </details>
  <p className={styles.updated}>{stale?'Last successful update':'Updated'} {overviewTime(data.checkedAt)} CT</p>
 </section>;
}
