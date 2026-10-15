'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Check,X} from 'lucide-react';
import type {UsageLoopCard} from '@/lib/usage-loop-policy';
import {trackUsageLoopEvent} from '@/lib/usage-loop-client';
import './workspace-conversion.css';

type Recommendation = {card:UsageLoopCard|null;variant:'control'|'progress';impressionId:string|null;balanceCents:number;paused:boolean;checkedAt:string};
type Dismissal={key:string;expiresAt:number};
const dismissalKey=(card:UsageLoopCard)=>JSON.stringify([card.key,card.action,card.reason,card.title,card.detail,card.progress]);
export function WorkspaceConversion({principal,balanceCents,paused,stale,hidden,busy,attentionPending=false,onFunding,onResume,onVip,onWork}:{
  principal:string;balanceCents?:number;paused?:boolean;stale:boolean;hidden:boolean;busy:boolean;attentionPending?:boolean;
  onFunding:(amountCents:number,reason:string)=>void;onResume:()=>void;onVip:()=>void;onWork:(reason:UsageLoopCard['reason'])=>void;
}) {
  const storageKey=`icash:next-step:${principal}`;
  const [data,setData]=useState<(Recommendation&{scope:string})|null>(null),[dismissed,setDismissed]=useState<Dismissal[]>(()=>{
    try{const saved=JSON.parse(sessionStorage.getItem(storageKey)??'[]');return Array.isArray(saved)?saved.filter((item):item is Dismissal=>item&&typeof item.key==='string'&&typeof item.expiresAt==='number'&&item.expiresAt>Date.now()).slice(-30):[];}catch{return [];}
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
        if(version===generation.current&&!controller.signal.aborted)setData({...next,scope});
      }catch{if(version===generation.current&&!controller.signal.aborted)setData(null);}
      finally{inFlight=false;}
    }
    void load();const timer=setInterval(load,45000);document.addEventListener('visibilitychange',load);
    return()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',load);};
  },[scope,stale,hidden]);
  useEffect(()=>{
    if(!data)return;
    const remaining=Date.parse(data.checkedAt)+90000-Date.now();
    if(!Number.isFinite(remaining)||remaining<=0){setData(null);return;}
    const timer=setTimeout(()=>setData(current=>current===data?null:current),remaining);
    return()=>clearTimeout(timer);
  },[data]);
  const age=data?Date.now()-Date.parse(data.checkedAt):Infinity;
  const card=!stale&&!hidden&&data?.scope===scope&&data.balanceCents===balanceCents&&data.paused===paused&&age>=-5000&&age<90000?data.card:null;
  const key=card?dismissalKey(card):'';
  const commercial=card?.action==='funding'||card?.action==='vip';
  const visible=!!card&&!busy&&!occupied&&!(attentionPending&&commercial)&&!dismissed.some(item=>item.key===key&&item.expiresAt>Date.now());
  const element=useRef<HTMLElement|null>(null),shown=useRef(new Set<string>());
  const impressionId=data?.impressionId??null;
  function track(event:'shown'|'clicked'|'dismissed'){
    if(!card||!impressionId)return;
    try{void trackUsageLoopEvent({event,action:card.action,reason:card.reason,impressionId}).catch(()=>{});}catch{/* Tracking cannot prevent a user's next step. */}
  }
  useEffect(()=>{
    if(!visible||!element.current||!impressionId||shown.current.has(impressionId)||typeof IntersectionObserver==='undefined')return;
    let inView=false;
    const record=()=>{if(!inView||document.hidden||shown.current.has(impressionId))return;shown.current.add(impressionId);track('shown');};
    const observer=new IntersectionObserver(entries=>{inView=entries.some(entry=>entry.isIntersecting&&entry.intersectionRatio>=0.5);record();},{threshold:0.5});
    observer.observe(element.current);document.addEventListener('visibilitychange',record);
    return()=>{observer.disconnect();document.removeEventListener('visibilitychange',record);};
  },[visible,impressionId,key]);
  if(!card||!visible)return null;
  function dismiss(trackEvent=true){
    if(!card)return;if(trackEvent)track('dismissed');
    // Funding/VIP dismissals last for this browser session. Progress returns
    // after a short break or immediately when its actual evidence changes.
    const next=[...dismissed.filter(item=>item.key!==key&&item.expiresAt>Date.now()),{key,expiresAt:commercial?Number.MAX_SAFE_INTEGER:Date.now()+15*60000}].slice(-30);
    setDismissed(next);try{sessionStorage.setItem(storageKey,JSON.stringify(next));}catch{}
  }
  function act(){
    if(busy||!card)return;
    if(card.action==='funding'&&(!Number.isSafeInteger(card.amountCents)||Number(card.amountCents)<=0))return;
    track('clicked');
    if(card.action==='funding'){dismiss(false);onFunding(card.amountCents!,card.detail);}
    else if(card.action==='resume')onResume();
    else if(card.action==='vip'){dismiss(false);onVip();}
    else if(card.action==='work')onWork(card.reason);
  }
  return <section ref={element} className="workspace-conversion" data-action={card.action} aria-label="Your next step">
    <div className="workspace-conversion-copy">{card.progress&&<p className="workspace-conversion-progress"><Check size={14} aria-hidden="true"/>{card.progress}</p>}<strong>{card.title}</strong><p>{card.detail}</p></div>
    {card.button&&card.action!=='none'&&<button type="button" className="workspace-conversion-action" disabled={busy} onClick={act}>{card.button}<ArrowRight size={16} aria-hidden="true"/></button>}
    <button type="button" className="workspace-conversion-dismiss" aria-label="Dismiss suggestion" onClick={()=>dismiss()}><X size={17}/></button>
  </section>;
}
