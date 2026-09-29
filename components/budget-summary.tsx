'use client';
import {useEffect,useState} from 'react';
import type {WorkSummary} from '@/lib/work-summary';
type Summary=WorkSummary&{explanation:string;canFund:boolean;packs:{code:string;price_cents:number;enabled:boolean}[]};
export function BudgetSummary({onFund}:{onFund:(code?:string)=>void}){
 const [s,setS]=useState<Summary|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;async function load(){if(document.hidden)return;try{const r=await fetch('/api/work/summary',{cache:'no-store'});if(!r.ok)throw new Error();const d=await r.json();if(active){setS(d);setError('');}}catch{if(active)setError('Summary unavailable. Refresh to retry.');}}void load();const id=setInterval(load,60000);return()=>{active=false;clearInterval(id);};},[]);
 if(!s)return error?<p role="status">{error}</p>:null;
 const exhausted=s.fundedCents>0&&s.balanceCents===0;
 const held=s.fundedCents>0&&s.balanceCents>0&&s.balanceCents<=s.reservedCents;
 const last=s.packs.find(p=>p.code===s.lastPack)??s.packs[0];const smaller=s.packs.filter(p=>p.price_cents<(last?.price_cents??0)).at(-1);const bigger=s.packs.find(p=>p.price_cents>(last?.price_cents??0));
 const options=[last,smaller,bigger].filter((p):p is NonNullable<typeof p>=>!!p);
 return <section className="budget-summary">
 {(exhausted||held)&&<><h3>{exhausted?'Your credits are used up':'Your remaining credits are reserved'}</h3><p>{exhausted?'Add credits to resume paid bot work. Your saved work stays here.':'Already-started work may finish. Final usage is still being confirmed.'}</p></>}
 <details open={exhausted||held}><summary>Your work summary</summary><p>{s.analyzed} properties analyzed · {s.screeningCandidates} properties worth a closer look · {s.activeContracts} signed deals still in progress</p><p>{s.explanation}</p><a className="summary-download" href="/api/work/summary?format=pdf">Download PDF summary</a><small>All recorded account activity. Pending results may change.</small>
 {exhausted&&s.canFund&&<><p>Add credits to resume.</p><div className="summary-refills">{options.map(p=><button key={p.code} disabled={!p.enabled} onClick={()=>onFund(p.code)}>Add ${(p.price_cents/100).toLocaleString()}</button>)}</div><small>More credits fund additional activity. A deal is not guaranteed.</small></>}
 {exhausted&&!s.canFund&&<p>Live funding is unavailable. You can still download and review your work.</p>}
 </details>{error&&<p role="status">{error}</p>}
 </section>;
}
