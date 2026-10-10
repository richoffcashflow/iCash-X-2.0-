'use client';
import {useEffect,useRef,useState} from 'react';
import type {CancellationView} from '@/lib/agreement-cancellation-policy';
import {safeLocalTime} from './workspace-view';

export function AgreementCancellationControls({dealId,stage,signingVersion,onUpdated}:{dealId:string;stage:string;signingVersion:string;onUpdated:()=>void}) {
 const [view,setView]=useState<CancellationView|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [kind,setKind]=useState<'purchase'|'assignment'>('purchase'),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [release,setRelease]=useState(''),[resolution,setResolution]=useState(''),[released,setReleased]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null),key=useRef('');
 useEffect(()=>{
  const controller=new AbortController();
  fetch(`/api/work/cancellations?dealId=${dealId}`,{cache:'no-store',signal:controller.signal}).then(async r=>{
   if(!r.ok)throw Error('Could not load cancellation controls.');return r.json() as Promise<CancellationView>;
  }).then(setView).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
  return()=>controller.abort();
 },[dealId,stage,signingVersion]);
 async function reload(){
  const r=await fetch(`/api/work/cancellations?dealId=${dealId}`,{cache:'no-store'});
  if(!r.ok)throw Error('Could not refresh cancellation status.');
  const data=await r.json() as CancellationView;setView(data);return data;
 }
 async function run(body:unknown){
  if(busy)return;setBusy(true);setError('');
  try{
   const r=await fetch('/api/work/cancellations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   const data=await r.json();if(!r.ok)throw Error(data.error||'Could not confirm cancellation.');
   setView(data);dialog.current?.close();setReleased(false);setRelease('');setResolution('');onUpdated();
  }catch(e){
   setError(e instanceof Error?e.message:'Could not confirm cancellation.');
   // A failed response may follow a committed hold. Read it back before allowing another request.
   try{const latest=await reload();if(latest.requests.some(c=>c.state==='pending')||latest.stage==='cancelled'){dialog.current?.close();onUpdated();}}catch{/* Keep the last confirmed view visible. */}
  }finally{setBusy(false);}
 }
 async function open(next:'purchase'|'assignment'){
  setKind(next);setReason('');setConfirmed(false);setError('');key.current=crypto.randomUUID();
  dialog.current?.showModal();setBusy(true);
  try{await reload();}catch(e){setView(null);setError(e instanceof Error?e.message:'Refresh required.');}finally{setBusy(false);}
 }
 const pending=view?.requests.find(c=>c.state==='pending');
 const needsRelease=!!pending&&(pending.requires_release||pending.has_deposit||pending.has_title);
 const history=view?.requests.filter(c=>c.state==='completed')??[];
 return <section className="agreement-cancellation" data-deal-section="cancellation" aria-label="Cancel agreements">
  {pending?<div className="cancellation-pending" role="status">
   <h4>{pending.kind==='purchase'?'Contract':'Assignment'} cancellation pending</h4>
   <p>Automatic work is paused. {pending.kind==='assignment'?'The seller contract stays in place.':''} Signed documents and payment records are saved.</p>
   {!pending.provider_ready&&<><p>Signing status still needs confirmation. Work stays paused until every signing request is checked.</p><button disabled={busy} onClick={()=>void run({action:'check',id:pending.id})}>Check signing status again</button></>}
   {needsRelease&&<div className="cancellation-release">
    <p>Record the completed cancellation or release before finishing. This button does not send legal notice or return a deposit.</p>
    <label>Termination or release reference<textarea maxLength={1000} placeholder="Document name or reference, date, and who confirmed it" value={release} onChange={e=>setRelease(e.target.value)}/></label>
    {(pending.has_deposit||pending.has_title)&&<label>Title and deposit resolution<textarea maxLength={1000} placeholder="Closing contact, confirmation reference, and deposit disposition" value={resolution} onChange={e=>setResolution(e.target.value)}/><small>Keep bank and wire details out of this note.</small></label>}
    <label className="signing-confirm"><input type="checkbox" checked={released} onChange={e=>setReleased(e.target.checked)}/>I have completed the required notices or releases and resolved any title and deposit obligations for this cancellation.</label>
    <button disabled={busy||!pending.provider_ready||!released||release.trim().length<8||((pending.has_deposit||pending.has_title)&&resolution.trim().length<8)} onClick={()=>void run({action:'complete',id:pending.id,confirmed:true,releaseReference:release,resolutionReference:resolution})}>Record cancellation complete</button>
   </div>}
   {pending.provider_ready&&!needsRelease&&<button disabled={busy} onClick={()=>void run({action:'check',id:pending.id})}>Finish cancellation</button>}
  </div>:<div className="cancellation-actions">
   {view?.stage==='cancelled'?<p><strong>Contract cancelled.</strong> Its history is saved below.</p>:<>
    <button disabled={busy||!view||view.blocked} onClick={()=>void open('purchase')}>Cancel contract</button>
    {view?.hasAssignment&&<button disabled={busy||view.blocked} onClick={()=>void open('assignment')}>Cancel assignment</button>}
   </>}
  </div>}
  {history.length>0&&<details><summary>Cancellation history ({history.length})</summary>{history.map(c=><article key={c.id} className="cancellation-history">
   <strong>{c.kind==='purchase'?'Contract':'Assignment'} cancelled</strong><small>{safeLocalTime(c.completed_at??c.created_at)}</small><p>{c.reason}</p>
   {c.release_reference&&<p>Release: {c.release_reference}</p>}{c.resolution_reference&&<p>Title / deposit: {c.resolution_reference}</p>}
   {c.late_activity&&<p role="alert">Late signing activity needs human review. Automatic work remains blocked.</p>}
   {c.kind==='assignment'&&<small>The seller contract is retained. Prepare the next buyer’s agreement and confirm their deposit separately; automatic work remains paused until you return control.</small>}
  </article>)}</details>}
  {error&&<p role="alert">{error} <button disabled={busy} onClick={()=>{setBusy(true);void reload().then(()=>setError('')).catch(()=>setError('Could not refresh. Try again.')).finally(()=>setBusy(false));}}>Refresh</button></p>}
  <dialog ref={dialog} className="cancellation-dialog" aria-labelledby={`cancel-title-${dealId}`} onCancel={event=>{if(busy)event.preventDefault();}}>
   <h3 id={`cancel-title-${dealId}`}>Cancel {kind==='purchase'?'contract':'assignment'}?</h3>
   <p>{kind==='purchase'?'This stops the seller contract workflow and any buyer assignment for this property.':'This releases the current buyer workflow and keeps the seller contract in place.'}</p>
   <p>Automatic work will pause and pending signing links will be disabled. Work already in progress may finish. Signed agreements require a recorded release before cancellation is complete.</p>
   <label>Reason<textarea autoFocus maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} placeholder={kind==='purchase'?'Why is this contract being cancelled?':'Why is this buyer assignment being cancelled?'}/></label>
   <label className="signing-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Pause this property and start this cancellation.</label>
   {error&&<p role="alert">{error}</p>}
   <div className="cancellation-actions"><button disabled={busy} onClick={()=>dialog.current?.close()}>Keep {kind==='purchase'?'contract':'assignment'}</button><button className="cancellation-submit" disabled={busy||!view||view.blocked||!!pending||!confirmed||reason.trim().length<3} onClick={()=>void run({action:'request',dealId,kind,reason,key:key.current,revision:view!.revision,confirmed:true})}>{busy?'Checking…':'Confirm cancellation'}</button></div>
  </dialog>
 </section>;
}
