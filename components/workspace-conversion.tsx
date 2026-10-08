'use client';
import {useEffect,useRef,useState} from 'react';
import {Sparkles,X} from 'lucide-react';
import type {WorkspaceConversionOffer} from '@/lib/workspace-conversion';
import {FundingDialog} from './funding-dialog';
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
  const [popupKey,setPopupKey]=useState<string|null>(null);
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
  useEffect(()=>{
    if(!offer||offer.action!=='funding'||dismissed.includes(offer.key)){setPopupKey(null);return;}
    // Do not interrupt a call, a conversation, checkout, or someone typing.
    if(busy||document.hidden||document.querySelector('dialog[open]')||document.activeElement?.matches('input,textarea,[contenteditable="true"]'))return;
    setPopupKey(offer.key);
  },[offer,dismissed,busy]);
  if(!offer)return null;
  const compact=dismissed.includes(offer.key);
  function dismiss(){if(!offer)return;const next=[...new Set([...dismissed,offer.key])];setDismissed(next);try{sessionStorage.setItem(storageKey,JSON.stringify(next));}catch{}setPopupKey(null);}
  function act(){if(busy||!offer)return;if(offer.action==='funding'&&offer.amountCents){dismiss();onFunding(offer.amountCents,offer.detail);}else if(offer.action==='resume')onResume();else if(offer.action==='vip')onVip();}
  if(offer.action==='funding'){
    if(compact||popupKey!==offer.key)return null;
    const empty=balanceCents===0;
    return <FundingDialog title={empty?'Get your bot working':'Keep your bot working'} onClose={dismiss}>
      <div className="credit-refill-prompt">
        <div className="credit-refill-balance"><span>{empty?'Out of credits':'Credits running low'}</span><strong>{new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((balanceCents??0)/100)}</strong><small>credits left</small></div>
        <p>{offer.key.endsWith(':research')?'Your property research is queued. Add credits to keep your bot moving.':'Add credits for property research, calls, texts, and AI follow-ups.'}</p>
        <span className="credit-refill-recommended">Recommended refill</span>
        <button type="button" className="credit-refill-primary" disabled={busy} onClick={act}>{busy?'Updating…':offer.button}</button>
        <button type="button" className="credit-refill-later" onClick={dismiss}>Not now</button>
      </div>
    </FundingDialog>;
  }
  return <section className="workspace-conversion" data-compact={compact} aria-label="Your bot’s next step">
    <Sparkles size={20} aria-hidden="true"/>
    <div className="workspace-conversion-copy"><strong>{compact?offer.compact:offer.title}</strong>{!compact&&<p>{offer.detail}</p>}</div>
    <button type="button" className="workspace-conversion-action" disabled={busy} onClick={act}>{busy?'Updating…':offer.button}</button>
    {!compact&&<button type="button" className="workspace-conversion-dismiss" aria-label="Minimize suggestion" onClick={dismiss}><X size={17}/></button>}
  </section>;
}
