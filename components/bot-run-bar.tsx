'use client';
import {useEffect,useState} from 'react';
import {Play,Pause,SlidersHorizontal} from 'lucide-react';
import {creditAmount} from '@/lib/workspace-progress';
import type {BotActivity} from '@/lib/bot-activity';
type Props={running:boolean;stopped:boolean;paymentRequired:boolean;busy:boolean;stale:boolean;balanceCents?:number;principalKey?:string;budgetCents?:number;dailyActive?:boolean;canPause?:boolean;onBudget:()=>void;onPause:()=>void};
export function BotRunBar({running,stopped,paymentRequired,busy,stale,balanceCents,principalKey,budgetCents=1000,dailyActive=false,canPause=false,onBudget,onPause}:Props){
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
 const title=stale?'Checking status':paymentRequired?'Update payment':stopped?'Bot paused':running?'Bot running':dailyActive?'Bot ready':'Ready when you are';
 const detail=stale?'Reconnecting…':paymentRequired?'Update your subscription to continue.':running?(current?.label??'Checking for the next task…'):dailyActive?'Waiting for eligible work.':stopped?'Your properties and conversations are saved.':'Choose a daily budget. Your bot takes it from here.';
 const dollars=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Math.max(1000,budgetCents)/100);
 return <section className={`bot-run-bar bot-run-centered${active?' is-active':''}`} aria-label="Bot controls">
  <div className="bot-run-status"><span className="bot-work-dots" aria-hidden="true"><i/><i/><i/></span><div aria-live="polite" aria-atomic="true"><h2>{title}</h2><p>{detail}</p></div></div>
  <div className="bot-run-actions">
   <button id="workspace-funding-toggle" className="bot-main-action" type="button" aria-haspopup={paymentRequired||canPause?undefined:'dialog'} disabled={busy||stale} onClick={paymentRequired?onBudget:canPause?onPause:onBudget}>{canPause&&!paymentRequired?<Pause size={18} aria-hidden="true"/>:<Play size={18} aria-hidden="true"/>}{busy?'One moment…':paymentRequired?'Update payment':canPause?'Pause bot':'Run bot'}</button>
   <button className="bot-run-budget" type="button" aria-haspopup="dialog" disabled={busy||stale} onClick={onBudget} aria-label={`Change daily budget, ${dollars} per day`}><SlidersHorizontal size={14} aria-hidden="true"/>{stale?'—':dollars}<span>/day</span></button>
  </div>
  {balanceCents!==undefined&&<div className="bot-credit-caption">{stale?'—':creditAmount(balanceCents)} credits left</div>}
 </section>;
}
