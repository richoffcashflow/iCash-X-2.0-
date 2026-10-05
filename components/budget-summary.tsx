'use client';
import {useEffect,useState} from 'react';
import {activityPeriods,validActivityReport,type ActivityDays,type ActivityReport} from '@/lib/activity-report';
export function BudgetSummary(){
 const [days,setDays]=useState<ActivityDays>(1),[report,setReport]=useState<ActivityReport|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  let active=true,inFlight=false;const controller=new AbortController();const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
  setReport(null);setError('');
  async function load(){
   if(document.hidden||inFlight)return;inFlight=true;
   try{const params=new URLSearchParams({days:String(days),timezone});const r=await fetch(`/api/work/report?${params}`,{cache:'no-store',signal:controller.signal});if(!r.ok)throw Error();const data:unknown=await r.json();if(!validActivityReport(data,days))throw Error();if(active){setReport(data);setError('');}}
   catch{if(active)setError('Could not refresh activity.');}finally{inFlight=false;}
  }
  void load();const timer=setInterval(()=>void load(),60000);const visible=()=>void load();document.addEventListener('visibilitychange',visible);
  return()=>{active=false;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[days,retry]);
 const current=report?.days===days?report:null;
 const metrics=[['leads','Leads','New properties added to your workspace'],['calls','Calls','Bot calls started, including unanswered calls'],['texts','Texts','Texts sent or delivered'],['contracts','Contracts','Seller contracts signed']] as const;
 return <section className="workspace-activity" aria-labelledby="workspace-activity-title">
  <div className="workspace-activity-heading"><h3 id="workspace-activity-title">Activity</h3><div className="activity-periods" role="group" aria-label="Activity period">{activityPeriods.map(period=><button key={period.days} type="button" aria-pressed={days===period.days} onClick={()=>setDays(period.days)}>{period.label}</button>)}</div></div>
  <dl className="activity-metrics" aria-busy={!current&&!error}>{metrics.map(([key,label,meaning])=><div key={key}><dt title={meaning}>{label}</dt><dd>{current?current[key].toLocaleString():'—'}</dd></div>)}</dl>
  <div className="activity-report-status">{!current&&!error&&<span role="status">Loading…</span>}{error&&<span role="status">{error}{current?' Showing last update.':''} <button type="button" onClick={()=>setRetry(v=>v+1)}>Retry</button></span>}</div>
 </section>;
}
