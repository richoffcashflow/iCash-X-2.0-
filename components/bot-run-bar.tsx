'use client';
import {useEffect,useState} from 'react';
import {Plus} from 'lucide-react';
import {creditAmount} from '@/lib/workspace-progress';
import type {BotActivity} from '@/lib/bot-activity';
type Props={running:boolean;stopped:boolean;paymentRequired:boolean;busy:boolean;stale:boolean;balanceCents?:number;principalKey?:string;onAddCredits:()=>void};
export function BotRunBar({running,stopped,paymentRequired,busy,stale,balanceCents,principalKey,onAddCredits}:Props){
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
 const empty=balanceCents!==undefined&&balanceCents<=0;
 const title=stale?'Checking status':paymentRequired?'Subscription needs attention':empty?'Waiting for credits':stopped?'Bot stopped':running?'Bot running':'Your AI bot';
 return <section className={`bot-run-bar${active?' is-active':''}`} aria-label="Bot controls">
  <div className="bot-run-status"><span className="bot-work-dots" aria-hidden="true"><i/><i/><i/></span><div aria-live="polite" aria-atomic="true"><h2>{title}</h2><p>{stale?'Reconnecting to your workspace':paymentRequired?'Update payment to resume work. Your leads are saved.':empty?'Add credits to continue. Your leads are saved.':running?(current?.label??'Updating status…'):stopped?'Add credits to restart automatically.':'Add credits. Work starts automatically.'}</p></div></div>
  <div className="bot-run-actions">{balanceCents!==undefined&&<div className="bot-credit-balance"><strong>{stale?'—':creditAmount(balanceCents)}</strong><span>credits left</span></div>}
   <button id="workspace-funding-toggle" className="bot-main-action" type="button" aria-haspopup={paymentRequired?undefined:'dialog'} disabled={busy||stale} onClick={onAddCredits}><Plus size={16} aria-hidden="true"/>{paymentRequired?'Update payment':'Add credits'}</button>
  </div>
 </section>;
}
