'use client';
import {useEffect,useRef,useState} from 'react';
import type {DemoReadiness} from '@/lib/demo-readiness';

export function DemoReadinessPanel({onChange}:{onChange:(ready:boolean)=>void}){
 const [result,setResult]=useState<DemoReadiness|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=useRef<AbortController|null>(null);
 async function check(){
  if(pending.current)return;const controller=new AbortController();pending.current=controller;
  onChange(false);setBusy(true);setResult(null);setError('');
  try{
   const r=await fetch('/api/demo/readiness',{method:'GET',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(35000)])});
   if(!r.ok)throw Error();const d=await r.json() as DemoReadiness;
   if(controller.signal.aborted)return;
   if(d.mode!=='read_only'||!Array.isArray(d.checks)||d.checks.length!==5||typeof d.checkedAt!=='string'||typeof d.setupChecksPass!=='boolean')throw Error();
   setResult(d);onChange(d.setupChecksPass&&d.checks.every(c=>c.status==='passed'));
  }catch{if(!controller.signal.aborted)setError('Couldn’t finish the setup check. Check again before starting.');}
  finally{if(pending.current===controller){pending.current=null;if(!controller.signal.aborted)setBusy(false);}}
 }
 useEffect(()=>{void check();return()=>{pending.current?.abort();pending.current=null;};},[]);
 return <div aria-label="Demo setup check">
  <button type="button" className="demo-secondary" disabled={busy} onClick={()=>void check()}>{busy?'Checking before your call…':'Check setup again'}</button>
  <div role="status" aria-live="polite">
   {result&&<><p className="demo-credit-note">{result.setupChecksPass?'Setup checks passed.':'Resolve the checks below before starting.'} No call or text was sent.</p>
    <ul>{result.checks.map(check=><li key={check.id}><strong>{check.label}: {check.status==='passed'?'passed':check.status==='blocked'?'needs attention':'not verified'}</strong><br/>{check.detail}</li>)}</ul>
    <p className="demo-credit-note">Checked at {new Date(result.checkedAt).toLocaleTimeString()}. This checks setup, not phone ringing or delivery. The property, offer, seller consent, and final send checks still run during the demo.</p></>}
   {error&&<p className="demo-notice">{error}</p>}
  </div>
 </div>;
}
