'use client';
import {useEffect,useState} from 'react';
import type {WorkSummary} from '@/lib/work-summary';
import {creditAmount,recordedProgress} from '@/lib/workspace-progress';
type Summary=WorkSummary&{explanation:string;canFund:boolean;packs:{code:string;price_cents:number;enabled:boolean}[]};
export function BudgetSummary(){
 const [s,setS]=useState<Summary|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true,inFlight=false;const controller=new AbortController();async function load(){if(document.hidden||inFlight)return;inFlight=true;try{const r=await fetch('/api/work/summary',{cache:'no-store',signal:controller.signal});if(!r.ok)throw new Error();const d=await r.json();if(active){setS(d);setError('');}}catch{if(active)setError('Could not refresh progress. Any results shown are from the last update.');}finally{inFlight=false;}}void load();const id=setInterval(load,60000);document.addEventListener('visibilitychange',load);return()=>{active=false;controller.abort();clearInterval(id);document.removeEventListener('visibilitychange',load);};},[]);
 const progress=s?recordedProgress(s):null;
 return <section className="budget-summary workspace-progress" aria-labelledby="workspace-progress-title">
 <div className="workspace-section-heading"><h3 id="workspace-progress-title">What your AI accomplished</h3><small>All-time recorded work</small></div>
 {progress?<>{progress.items.length>0?<ul className="progress-milestones">{progress.items.map(item=><li key={item}>{item}</li>)}</ul>:<p className="progress-empty">{progress.empty}</p>}<p className="progress-note">{progress.note}</p></>:<p role="status">{error?'Progress is unavailable right now. Your saved work is still below.':'Loading recorded progress…'}</p>}
 {s&&<details><summary>Spending & work summary</summary><div className="workspace-recorded-totals" aria-label="Recorded work and spending"><span><strong>{creditAmount(s.spentCents)}</strong> spent to date</span></div><p>{s.explanation}</p><a className="summary-download" href="/api/work/summary?format=pdf">Download PDF summary</a><small>All recorded account activity. Pending results may change.</small></details>}
 {error&&s&&<p role="status">{error}</p>}
 </section>;
}
