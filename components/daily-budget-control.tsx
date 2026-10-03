'use client';
import {useEffect,useState} from 'react';
import {ArrowUpRight,Wallet} from 'lucide-react';
import {creditAmount} from '@/lib/workspace-progress';

export function DailyBudgetControl({balanceCents,reservedCents,billingActive,refreshKey,onChange}:{balanceCents?:number;reservedCents?:number;billingActive?:boolean;refreshKey:string;onChange:(code?:string)=>void}) {
 const [plan,setPlan]=useState<{state:string;budgetCents:number|null;nextCharge:number|null}|null>(null);
 const [loaded,setLoaded]=useState(false),[failed,setFailed]=useState(false);
 useEffect(()=>{
  const controller=new AbortController();setLoaded(false);setFailed(false);
  fetch('/api/billing/daily',{cache:'no-store',signal:controller.signal}).then(async response=>{if(!response.ok)throw Error();const data=await response.json();if(!controller.signal.aborted){setPlan(data.plan);setLoaded(true);}}).catch(()=>{if(!controller.signal.aborted){setFailed(true);setLoaded(true);}});
  return()=>controller.abort();
 },[refreshKey]);
 const active=plan?.state==='active';
 const amount=active&&typeof plan.budgetCents==='number'?plan.budgetCents:null;
 const target=amount!==null&&amount<5000?'budget_50':amount!==null&&amount<10000?'work':amount!==null&&amount<25000?'grow':undefined;
 return <section className="daily-budget-bar" aria-label="Your daily budget">
  <div className="daily-budget-top"><div><span className="workspace-eyebrow">Daily budget</span><strong>{!loaded?'Checking…':failed?'Check budget':amount!==null?<>{creditAmount(amount)}<small>/day</small></>:billingActive?'Check plan':'Not running'}</strong></div><button id="workspace-funding-toggle" type="button" className="budget-increase" onClick={()=>onChange(target)}>{active?'Increase budget':'Choose budget'}<ArrowUpRight size={17} aria-hidden="true"/></button></div>
  <div className="daily-budget-bottom"><span><Wallet size={15} aria-hidden="true"/>{creditAmount(balanceCents)} available</span><button type="button" onClick={()=>onChange()}>Manage</button></div>
  {!!reservedCents&&<small className="daily-budget-reserved">{creditAmount(reservedCents)} reserved for work already in progress</small>}
  {active&&<small className="daily-budget-renewal">Renews daily. Changes apply at the next renewal.</small>}
 </section>;
}
