'use client';
import {useEffect,useState} from 'react';
import {Play,Square,ArrowUpRight} from 'lucide-react';
import type {BotActivity} from '@/lib/bot-activity';
type Props={running:boolean;canStop:boolean;busy:boolean;stale:boolean;daily:boolean;budgetCents?:number;principalKey?:string;onRun:()=>void;onStop:()=>void;onBudget:()=>void};
export function BotRunBar({running,canStop,busy,stale,daily,budgetCents,principalKey,onRun,onStop,onBudget}:Props){
 const [activity,setActivity]=useState<(BotActivity&{principalKey?:string})|null>(null);
 useEffect(()=>{
  if(!running||stale){setActivity(null);return;}
  let disposed=false,inFlight=false;let controller:AbortController|undefined;
  async function refresh(){
   if(disposed||inFlight||document.hidden)return;
   inFlight=true;controller=new AbortController();
   const timeout=setTimeout(()=>controller?.abort(),8000);
   try{
    const response=await fetch('/api/work/bot-status',{cache:'no-store',signal:controller.signal});
    if(!response.ok)throw Error();const value:BotActivity=await response.json();
    if(typeof value.active!=='boolean'||typeof value.label!=='string'||!Number.isFinite(Date.parse(value.checkedAt)))throw Error();
    if(!disposed)setActivity({...value,principalKey});
   }catch{if(!disposed)setActivity(null);}finally{clearTimeout(timeout);inFlight=false;}
  }
  void refresh();const timer=setInterval(()=>void refresh(),10000);
  const visibility=()=>{if(document.hidden){controller?.abort();setActivity(null);}else void refresh();};
  document.addEventListener('visibilitychange',visibility);
  return()=>{disposed=true;clearInterval(timer);controller?.abort();document.removeEventListener('visibilitychange',visibility);};
 },[running,stale,principalKey]);
 const current=activity?.principalKey===principalKey&&activity&&Date.now()-Date.parse(activity.checkedAt)<25000?activity:null;
 const active=running&&!stale&&!busy&&current?.active===true;
 const budget=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Math.max(1000,budgetCents??1000)/100);
 const title=busy?(canStop?'Stopping…':'Starting…'):stale?'Checking status':running?'Bot running':'Run your bot';
 return <section className={`bot-run-bar${active?' is-active':''}`} aria-label="Bot controls">
  <div className="bot-run-status"><span className="bot-work-dots" aria-hidden="true"><i/><i/><i/></span><div aria-live="polite" aria-atomic="true"><h2>{title}</h2><p>{busy?(canStop?'Stopping new work':'Starting your bot'):stale?'Reconnecting to your workspace':running?(current?.label??'Updating status…'):'Set your budget. Start working.'}</p></div></div>
  <div className="bot-run-actions">{daily&&<button id="workspace-funding-toggle" className="bot-run-budget" type="button" aria-haspopup="dialog" aria-label={`Daily budget ${budget}. Change budget`} onClick={onBudget}>{budget}<span>/day</span><ArrowUpRight size={15} aria-hidden="true"/></button>}
   {canStop?<button className="bot-main-action" type="button" disabled={busy} aria-label={daily?'Stop bot and daily billing':'Stop bot'} onClick={onStop}><Square size={13} fill="currentColor" aria-hidden="true"/>{busy?'Stopping…':'Stop bot'}</button>:<button className="bot-main-action" type="button" disabled={busy||stale} onClick={onRun}><Play size={14} fill="currentColor" aria-hidden="true"/>Run bot</button>}
  </div>
 </section>;
}
