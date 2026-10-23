'use client';
import {useRef,useState} from 'react';
import {webinarRequest} from '@/lib/webinar-client';
import type {DealRecovery} from '@/lib/deal-recovery';
const money=(cents:number)=>(cents/100).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
export function DealRecoveryPanel({dealId,data,onSaved}:{dealId:string;data:DealRecovery;onSaved:()=>void}){
 const [minimum,setMinimum]=useState(data.minimumFeeCents),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const lock=useRef(false),key=useRef<string|null>(null);
 const proposal=data.proposal;
 const available=data.editable&&proposal.ready&&proposal.assignmentFeeCents!==undefined&&proposal.assignmentFeeCents<1000000;
 if(!available&&!data.feedback.length)return null;
 async function save(){
  if(lock.current||!confirmed)return;lock.current=true;setBusy(true);setMessage('');key.current??=crypto.randomUUID();
  try{await webinarRequest('/api/work/deal-recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dealId,key:key.current,termsHash:data.termsHash,minimumFeeCents:minimum,confirmed:true})});setMessage('Your fee approval is saved. Eligible buyer preparation can continue.');setConfirmed(false);onSaved();}
  catch(e){setMessage(e instanceof Error?e.message:'Could not save. Refresh and try again.');}
  finally{lock.current=false;setBusy(false);}
 }
 return <details className="workspace-panel"><summary>Ways to move this deal forward</summary>
  {data.feedback.map(f=><p key={f.id}><strong>Buyer feedback: {f.reason}.</strong> {f.counterofferCents!==null?<>Suggested price {money(f.counterofferCents)}{f.gapCents!==null&&f.gapCents>0?` — ${money(f.gapCents)} below the current buyer price`:''}. This is a request for review.</>:f.reason==='repairs'?'Review the condition information and ask for the missing facts.':f.reason==='timing'?'Review the requested timing before changing an agreed date.':'Review the buyer’s concern before following up.'}</p>)}
  {available&&<form onSubmit={e=>{e.preventDefault();void save();}}>
   <p>The current purchase price and research support a {money(proposal.assignmentFeeCents!)} fee and {money(proposal.askingPriceCents!)} total buyer price. You can approve a lower fee for this property.</p>
   <label>My minimum fee<select value={minimum} disabled={busy} onChange={e=>{setMinimum(Number(e.target.value));setConfirmed(false);key.current=null;}}>{[1000000,900000,800000,700000,600000,500000].map(f=><option key={f} value={f}>{money(f)}</option>)}</select></label>
   <p>Your fee stays private in buyer packages. The original assignment contract shows the fee.</p>
   <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>I approve preparing buyer terms at the supported fee, provided it meets my selected minimum.</label>
   <button type="submit" disabled={busy||!confirmed||minimum>proposal.assignmentFeeCents!}>{busy?'Saving…':'Approve fee for this deal'}</button>
  </form>}
  {!data.editable&&data.feedback.length>0&&<p>Review changes through the deal’s agreement controls. Existing buyer prices and signed terms stay in effect until replacement terms are approved.</p>}
  {message&&<p role="status">{message}</p>}
 </details>;
}
