'use client';
import {useEffect,useState} from 'react';
import {webinarRequest} from '@/lib/webinar-client';
import {validWeeklyValue,valueDollars,type WeeklyWorkValue} from '@/lib/work-value';
import styles from '@/app/admin/overview.module.css';

export function WeeklyWorkValue({includeOwner,refresh}:{includeOwner:boolean;refresh:number}){
 const [open,setOpen]=useState(false);
 const [saved,setSaved]=useState<{scope:string;value:WeeklyWorkValue|null}|null>(null);
 const scope=JSON.stringify([includeOwner,refresh]);
 useEffect(()=>{
  if(!open)return;
  const controller=new AbortController();
  void webinarRequest<{value:unknown}>('/api/admin/usage-loop?measure=work-value&includeOwner='+includeOwner,{cache:'no-store',signal:controller.signal})
   .then(data=>{if(!validWeeklyValue(data.value))throw Error();if(!controller.signal.aborted)setSaved({scope,value:data.value});})
   .catch(()=>{if(!controller.signal.aborted)setSaved({scope,value:null});});
  return()=>controller.abort();
 },[open,scope,includeOwner]);
 const v=saved?.scope===scope?saved.value:null;
 return <details onToggle={event=>{if(event.currentTarget===event.target)setOpen(event.currentTarget.open);}}>
  <summary>Customer value · past 7 days</summary>
  {open&&(v?<div className={styles.metrics}>
   <article><h3>Credits per interested seller</h3><strong>{v.interested?valueDollars(v.spentCents/v.interested):'—'}</strong><p>{valueDollars(v.spentCents)} used · {v.interested} distinct seller contacts across funded accounts</p></article>
   <article><h3>Customers asking about value</h3><strong>{v.funded?new Intl.NumberFormat('en-US',{style:'percent',maximumFractionDigits:1}).format(v.asked/v.funded):'—'}</strong><p>{v.asked} of {v.funded} funded accounts asked what their credits paid for in signed-in support.</p></article>
  </div>:<p role="status">{saved?.scope===scope?'The weekly figures could not be verified.':'Loading weekly figures…'}</p>)}
 </details>;
}
