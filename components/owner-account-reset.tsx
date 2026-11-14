'use client';
import {useEffect,useRef,useState} from 'react';
import {checkDemoReadiness} from './demo-readiness';
import styles from './owner-account-reset.module.css';
/** A retry retains its receipt ID: a lost response must not clear a newer demo. */
export function OwnerAccountReset({disabled=false,onReset,onBusyChange}:{disabled?:boolean;onReset:()=>void;onBusyChange?:(busy:boolean)=>void}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[done,setDone]=useState(0);
 const pending=useRef<AbortController|null>(null),requestId=useRef('');
 useEffect(()=>()=>{pending.current?.abort();pending.current=null;},[]);
 useEffect(()=>{if(!done)return;const c=new AbortController();void checkDemoReadiness(c.signal);return()=>c.abort();},[done]);
 async function reset(){
  if(pending.current||disabled)return;
  const c=new AbortController();pending.current=c;
  try{const saved=sessionStorage.getItem('icash-owner-reset-request-v1');if(!requestId.current&&saved&&/^[a-f0-9-]{36}$/i.test(saved))requestId.current=saved;}catch{/* The in-memory receipt still protects this page. */}
  requestId.current||=crypto.randomUUID();
  try{sessionStorage.setItem('icash-owner-reset-request-v1',requestId.current);}catch{/* Storage may be unavailable. */}
  setBusy(true);onBusyChange?.(true);setMessage('Clearing the old demo…');setDone(0);
  const started=Date.now();
  try{
   while(!c.signal.aborted){
    const r=await fetch('/api/demo/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:requestId.current}),signal:AbortSignal.any([c.signal,AbortSignal.timeout(22000)])});
    if(c.signal.aborted)return;
    if(!r.ok)throw Error(r.status===401?'Sign in to the owner workspace again, then retry.':r.status===409?'An earlier property lookup is still awaiting its provider result. Reset is blocked until that result is reconciled. No new purchase was started.':'Couldn’t confirm the reset. Click again to check the same request.');
    let d;try{d=await r.json();}catch{throw Error('Couldn’t verify the reset. Click again to check the same request.');}if(c.signal.aborted)return;
    if(d.status==='waiting'){
     if(Date.now()-started>60000)throw Error('The current call or work is still finishing. Reset again after it ends.');
     setMessage(d.reason==='active_call'?'Waiting for the current call to end. Reset will continue automatically…':'Waiting for current work to finish. Reset will continue automatically…');
     await new Promise<void>(resolve=>{const finish=()=>{clearTimeout(timer);c.signal.removeEventListener('abort',finish);resolve();};const timer=setTimeout(finish,2000);c.signal.addEventListener('abort',finish,{once:true});});continue;
    }
    if(d.status!=='reset'||d.requestId!==requestId.current||d.historyPreserved!==true||d.providerWrites!==false)throw Error('Couldn’t verify the reset. Click again to check the same request.');
    requestId.current='';try{sessionStorage.removeItem('icash-owner-reset-request-v1');}catch{/* Nothing to clear. */}
    onReset();setDone(v=>v+1);setMessage('Owner account reset.');return;
   }
  }catch(e){if(!c.signal.aborted)setMessage(e instanceof Error?e.message:'Couldn’t confirm the reset. Click again to check the same request.');}
  finally{if(pending.current===c){pending.current=null;if(!c.signal.aborted){setBusy(false);onBusyChange?.(false);}}}
 }
 return <section className={styles.reset} aria-label="Owner account reset">
  <button type="button" className="workspace-quiet demo-secondary" disabled={disabled||busy} onClick={()=>void reset()}>{busy?'Resetting owner account…':'Reset owner account'}</button>
  {message&&<p role="status" aria-live="polite">{message}</p>}
 </section>;
}
