'use client';
import {useEffect,useState} from 'react';
import {IcashMark} from '@/components/icash-mark';
import {Play,Pause,Plus,Crown,Coins} from 'lucide-react';
import {creditAmount} from '@/lib/workspace-progress';
import type {BotActivity} from '@/lib/bot-activity';
type Props={apiBase?:string;readOnly?:boolean;hasLeads?:boolean;botName?:string;vip?:boolean;enabled?:boolean;running:boolean;stopped:boolean;paymentRequired:boolean;busy:boolean;stale:boolean;hasCreditHistory?:boolean;balanceCents?:number;principalKey?:string;canPause?:boolean;onVip?:()=>void;onBudget:()=>void;onResume:()=>void;onPause:()=>void};
export function BotRunBar({apiBase='/api/work',readOnly=false,hasLeads,botName,vip=false,enabled,running,stopped,paymentRequired,busy,stale,balanceCents,hasCreditHistory=false,principalKey,canPause=false,onVip,onBudget,onPause,onResume}:Props){
 const [activity,setActivity]=useState<(BotActivity&{principalKey?:string})|null>(null);
 // Customer status describes the saved Run/Pause choice, not infrastructure health.
 const modeRunning=enabled??running;
 useEffect(()=>{
  if(!(readOnly?running:modeRunning)||stale){setActivity(null);return;}
  let disposed=false,inFlight=false;let controller:AbortController|undefined;
  async function refresh(){
   if(disposed||inFlight||document.hidden)return;
   inFlight=true;controller=new AbortController();
   const timeout=setTimeout(()=>controller?.abort(),8000);
   try{
    const response=await fetch(`${apiBase}/bot-status`,{cache:'no-store',signal:controller.signal});
    if(!response.ok)throw Error();const value:BotActivity=await response.json();
    if(typeof value.active!=='boolean'||typeof value.label!=='string'||!Number.isFinite(Date.parse(value.checkedAt)))throw Error();
    if(!disposed)setActivity({...value,principalKey});
   }catch{if(!disposed)setActivity(null);}finally{clearTimeout(timeout);inFlight=false;}
  }
  void refresh();const timer=setInterval(()=>void refresh(),10000);
  const visibility=()=>{if(document.hidden){controller?.abort();setActivity(null);}else void refresh();};
  document.addEventListener('visibilitychange',visibility);
  return()=>{disposed=true;clearInterval(timer);controller?.abort();document.removeEventListener('visibilitychange',visibility);};
 },[running,modeRunning,stale,principalKey,apiBase,readOnly]);
 const current=activity?.principalKey===principalKey&&activity&&Date.now()-Date.parse(activity.checkedAt)<25000?activity:null;
 const funded=(balanceCents??0)>0;
 const blocked=current?.blocked===true,healthUnavailable=current?.unavailable===true;
 const observedLive=running&&funded&&!stopped&&!paymentRequired&&!stale&&!busy&&!!current&&current.label!=='Paused'&&!blocked&&!healthUnavailable;
 const active=observedLive&&current?.active===true;
 const runEnabled=modeRunning&&funded&&!stopped&&!paymentRequired;
 const live=readOnly?observedLive:runEnabled;
 const liveLabel=!readOnly?(runEnabled?'Run enabled':stopped?'Paused':'Not running'):blocked?'Work delayed':healthUnavailable||stale||busy||running&&funded&&!paymentRequired&&!stopped&&!current?'Checking status':live?'Live':'Not live';
 const title=readOnly&&(stale||healthUnavailable)?'Checking status':paymentRequired?'Restore access':readOnly&&blocked?'Work delayed':readOnly&&active?'Bot working':!funded?(balanceCents===undefined?'Ready when you are':hasCreditHistory?'Out of credits':'Add money to start your bot'):stopped||readOnly&&current?.label==='Paused'?'Bot paused':(readOnly?running:modeRunning)?(readOnly?'Run enabled':'Bot running'):'Bot ready';
 let detail: string;
 if (readOnly && stale) detail='Reconnecting…';
 else if (paymentRequired) detail='Update your subscription to continue.';
 else if (readOnly && current && (blocked || healthUnavailable)) detail=current.label;
 else if (active && (readOnly || runEnabled)) detail=current!.label;
 else if (!funded) detail=hasCreditHistory?'Add money to continue. Your properties and conversations are saved.':'Choose an amount. Your bot starts after payment.';
 else if (!readOnly && runEnabled) detail='Searching for a deal';
 else if (readOnly && running && !stopped) detail=!busy && current ? (observedLive && hasLeads===false?'Looking for a deal':current.label) : 'Checking for the next task…';
 else detail=stopped?'Your properties and conversations are saved.':'Waiting for eligible work.';
 const displayTitle=botName?.trim()&&title.startsWith('Bot ')?`${botName.trim()} is ${title.slice(4)}`:title;
 return <section id="workspace-tour-controls" className={`bot-run-bar bot-run-centered${active?' is-active':''}`} aria-label="Bot controls">
  <div className="bot-run-status"><IcashMark className="bot-orb"/><div><div className="bot-run-title"><h2>{displayTitle}</h2><span className="bot-live-status" data-live={live} role="status"><i aria-hidden="true"/><span className="sr-only">{liveLabel}</span></span>{vip&&<span className="workspace-vip-badge" aria-label="VIP access"><Crown size={24} strokeWidth={2} aria-hidden="true"/><span>VIP</span></span>}</div>{detail&&<p aria-live="polite">{!readOnly&&runEnabled&&!active&&<span className="sr-only">Goal: </span>}{detail}</p>}</div></div>
  <div className="bot-run-actions">
   {(!funded||paymentRequired)&&<button className="bot-main-action" type="button" aria-haspopup="dialog" disabled={busy||stale||readOnly} onClick={onBudget}><Plus size={18} aria-hidden="true"/>{busy?'One moment…':paymentRequired?'Restore access':'Add money to start'}</button>}
   {funded&&!paymentRequired&&(canPause||stopped)&&<button className="bot-run-budget" type="button" disabled={busy||stale||readOnly} onClick={canPause?onPause:onResume}>{canPause?<Pause size={14} aria-hidden="true"/>:<Play size={14} aria-hidden="true"/>}{canPause?'Pause bot':'Run bot'}</button>}
  </div>
  <div className="bot-wallet"><span className="bot-wallet-icon" aria-hidden="true"><Coins size={23}/></span><div className="bot-wallet-amount"><span>{hasCreditHistory||funded?'Credits left':'Work credits'}</span><strong>{readOnly&&stale||balanceCents===undefined?'—':creditAmount(balanceCents)}</strong></div><button id="workspace-funding-toggle" type="button" aria-haspopup="dialog" disabled={busy||stale||readOnly} onClick={onBudget}>{busy?'One moment…':paymentRequired?'Restore access':'Add money'}</button></div>
  {onVip&&<div className="bot-plan-row">
   {onVip&&<button type="button" className="workspace-vip-switch" aria-haspopup="dialog" disabled={busy||stale||readOnly} onClick={onVip}><Crown size={16} aria-hidden="true"/>{vip?'VIP settings':'Switch to VIP'}</button>}
  </div>}
 </section>;
}
