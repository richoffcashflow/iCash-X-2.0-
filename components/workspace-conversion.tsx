'use client';
import {useEffect,useRef,useState} from 'react';
import {Sparkles,X} from 'lucide-react';
import type {WorkspaceConversionOffer} from '@/lib/workspace-conversion';
import './workspace-conversion.css';

type Recommendation = {offer:WorkspaceConversionOffer|null;balanceCents:number;paused:boolean;checkedAt:string};
export function WorkspaceConversion({principal,balanceCents,paused,stale,hidden,busy,onFunding,onResume,onVip}:{
  principal:string;balanceCents?:number;paused?:boolean;stale:boolean;hidden:boolean;busy:boolean;
  onFunding:(amountCents:number,reason:string)=>void;onResume:()=>void;onVip:()=>void;
}) {
  const [data,setData]=useState<Recommendation|null>(null),[dismissed,setDismissed]=useState<string[]>([]);
  const scope=`${principal}:${balanceCents}:${paused}`;
  const generation=useRef(0);
  useEffect(()=>{
    const version=++generation.current,controller=new AbortController();let inFlight=false;
    setData(null);
    if(stale||hidden)return;
    async function load(){
      if(document.hidden||inFlight)return;inFlight=true;
      try{
        const response=await fetch('/api/work/next-action',{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
        if(!response.ok)throw Error();const next:Recommendation=await response.json();
        if(version===generation.current&&!controller.signal.aborted)setData(next);
      }catch{if(version===generation.current&&!controller.signal.aborted)setData(null);}
      finally{inFlight=false;}
    }
    void load();const timer=setInterval(load,45000);document.addEventListener('visibilitychange',load);
    return()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',load);};
  },[scope,stale,hidden]);
  const offer=!stale&&!hidden&&data&&data.balanceCents===balanceCents&&data.paused===paused&&Date.now()-Date.parse(data.checkedAt)<90000?data.offer:null;
  if(!offer)return null;
  const compact=dismissed.includes(offer.key);
  function act(){if(busy||!offer)return;if(offer.action==='funding'&&offer.amountCents)onFunding(offer.amountCents,offer.detail);else if(offer.action==='resume')onResume();else if(offer.action==='vip')onVip();}
  return <section className="workspace-conversion" data-compact={compact} aria-label="Your bot’s next step">
    <Sparkles size={20} aria-hidden="true"/>
    <div className="workspace-conversion-copy"><strong>{compact?offer.compact:offer.title}</strong>{!compact&&<p>{offer.detail}</p>}</div>
    <button type="button" className="workspace-conversion-action" disabled={busy} onClick={act}>{busy?'Updating…':offer.button}</button>
    {!compact&&<button type="button" className="workspace-conversion-dismiss" aria-label="Minimize suggestion" onClick={()=>setDismissed(current=>[...current,offer.key])}><X size={17}/></button>}
  </section>;
}
