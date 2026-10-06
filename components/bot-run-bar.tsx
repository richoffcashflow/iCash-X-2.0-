'use client';
import {useEffect,useState} from 'react';
import {Play,Pause,Plus} from 'lucide-react';
import {creditAmount} from '@/lib/workspace-progress';
import type {BotActivity} from '@/lib/bot-activity';
type Props={running:boolean;stopped:boolean;paymentRequired:boolean;busy:boolean;stale:boolean;hasCreditHistory?:boolean;balanceCents?:number;principalKey?:string;canPause?:boolean;onBudget:()=>void;onResume:()=>void;onPause:()=>void};
export function BotRunBar({running,stopped,paymentRequired,busy,stale,balanceCents,hasCreditHistory=false,principalKey,canPause=false,onBudget,onPause,onResume}:Props){
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
 const funded=(balanceCents??0)>0;
 const title=stale?'Checking status':paymentRequired?'Restore access':active?'Bot working':!funded?(balanceCents===undefined?'Ready when you are':hasCreditHistory?'Out of credits':'Add money to start your bot'):stopped?'Bot paused':running?'Bot running':'Bot ready';
 const detail=stale?'Reconnecting…':paymentRequired?'Update your subscription to continue.':active?current!.label:!funded?(hasCreditHistory?'Add money to continue. Your properties and conversations are saved.':'Choose an amount. Your bot starts after payment.'):running?(current?.label??'Checking for the next task…'):stopped?'Your properties and conversations are saved.':'Waiting for eligible work.';
 return <section className={`bot-run-bar bot-run-centered${active?' is-active':''}`} aria-label="Bot controls">
  <div className="bot-run-status"><span className="bot-work-dots" aria-hidden="true"><i/><i/><i/></span><div aria-live="polite" aria-atomic="true"><div className="bot-run-eyebrow">Your AI workspace</div><h2>{title}</h2><p>{detail}</p></div></div>
  <div className="bot-run-actions">
   <button id="workspace-funding-toggle" className="bot-main-action" type="button" aria-haspopup="dialog" disabled={busy||stale} onClick={onBudget}><Plus size={18} aria-hidden="true"/>{busy?'One moment…':paymentRequired?'Restore access':'Add money'}</button>
   {funded&&!paymentRequired&&(canPause||stopped)&&<button className="bot-run-budget" type="button" disabled={busy||stale} onClick={canPause?onPause:onResume}>{canPause?<Pause size={14} aria-hidden="true"/>:<Play size={14} aria-hidden="true"/>}{canPause?'Pause bot':'Run bot'}</button>}

  </div>
  {balanceCents!==undefined&&(hasCreditHistory||funded)&&<div className="bot-credit-caption">{stale?'—':creditAmount(balanceCents)} credits left</div>}
 </section>;
}
