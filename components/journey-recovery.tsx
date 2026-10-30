'use client';
import {useState} from 'react';
import {blockerNext,type JourneyBlocker} from '@/lib/deal-completion';
export function JourneyRecovery({journeyId,blocker,onSaved}:{journeyId:string;blocker:JourneyBlocker;onSaved:()=>void}){
 const [resolution,setResolution]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const next=blockerNext[blocker.kind];
 return <section className="journey-recovery"><h4>{next.title}</h4>{blocker.note&&<blockquote>{blocker.note}</blockquote>}<p>{next.detail}</p><details><summary>Record the outcome</summary><form className="review-form" onSubmit={async e=>{e.preventDefault();if(busy||!confirmed)return;setBusy(true);setError('');try{
  const r=await fetch('/api/work/journey-recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({journeyId,revision:blocker.revision,resolution,confirmed})});const d=await r.json();if(!r.ok)throw Error(d.error);onSaved();
 }catch(e){setError(e instanceof Error?e.message:'Could not save the outcome.');}finally{setBusy(false);}}}><label>What was confirmed?<textarea required minLength={5} maxLength={1000} rows={3} value={resolution} onChange={e=>setResolution(e.target.value)}/></label><label className="closing-attestation review-checkbox"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>This request is resolved and the existing agreed terms can continue.</label><div className="review-actions"><button className="review-primary" disabled={busy||!confirmed||resolution.trim().length<5}>Save outcome</button></div><small>Changes to price, deadlines, signatures or payment instructions still follow their normal review.</small>{error&&<p role="alert">{error}</p>}</form></details></section>;
}
