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
  const storageKey=`icash:credit-prompts:${principal}`;
  const [data,setData]=useState<Recommendation|null>(null),[dismissed,setDismissed]=useState<string[]>(()=>{
    try{const saved=JSON.parse(sessionStorage.getItem(storageKey)??'[]');return Array.isArray(saved)?saved.filter((key):key is string=>typeof key==='string'):[];}catch{return [];}
  });
  const [occupied,setOccupied]=useState(false);
  useEffect(()=>{
    const check=()=>setOccupied(!!document.querySelector('dialog[open],.workspace-account-menu[open],.live-property[data-expanded="true"],[data-unsaved-draft="true"]')||!!document.activeElement?.matches('input,textarea,select,[contenteditable="true"]'));
    check();
    const observer=new MutationObserver(check);
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open','data-expanded','data-unsaved-draft']});
    document.addEventListener('focusin',check);document.addEventListener('focusout',check);
    return()=>{observer.disconnect();document.removeEventListener('focusin',check);document.removeEventListener('focusout',check);};
  },[]);
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
  // Bot controls own resume; the account menu and locked features own VIP review.
  // Funding stays inline and waits while the user is handling another task.
  if(!offer||offer.action!=='funding'||dismissed.includes(offer.key)||busy||occupied)return null;
  function dismiss(){if(!offer)return;const next=[...new Set([...dismissed,offer.key])];setDismissed(next);try{sessionStorage.setItem(storageKey,JSON.stringify(next));}catch{}}
  function act(){if(busy||!offer)return;if(offer.action==='funding'&&offer.amountCents){dismiss();onFunding(offer.amountCents,offer.detail);}else if(offer.action==='resume')onResume();else if(offer.action==='vip')onVip();}
  return <section className="workspace-conversion" aria-label="Your bot’s next step">
    <Sparkles size={20} aria-hidden="true"/>
    <div className="workspace-conversion-copy"><strong>{offer.title}</strong><p>{offer.detail}</p></div>
    <button type="button" className="workspace-conversion-action" disabled={busy} onClick={act}>{offer.button}</button>
    <button type="button" className="workspace-conversion-dismiss" aria-label="Dismiss suggestion" onClick={dismiss}><X size={17}/></button>
  </section>;
}
