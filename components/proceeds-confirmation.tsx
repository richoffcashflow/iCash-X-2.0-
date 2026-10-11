'use client';
import {useState} from 'react';
import type {ClosingUpdate} from '@/lib/closing-progress';
import type {ProceedsReceipt} from '@/lib/deal-completion';
import {safeCalendarDate} from './workspace-view';
export function ProceedsConfirmation({dealId,update,receipt,onSaved}:{dealId:string;update:ClosingUpdate;receipt:ProceedsReceipt|null;onSaved:()=>void}){
 const [date,setDate]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const amount=(receipt?.amount_cents??update.amount_cents??0)/100;
 const money=amount.toLocaleString('en-US',{style:'currency',currency:'USD'});
 if(receipt)return <section className="proceeds-confirmation" role="status"><h4>Payment received</h4><p>You confirmed receipt of <strong>{money}</strong> on {safeCalendarDate(receipt.received_date)}.</p></section>;
 return <form className="proceeds-confirmation" onSubmit={async e=>{
  e.preventDefault();if(busy||!confirmed||!date)return;setBusy(true);setError('');
  try{const r=await fetch('/api/work/proceeds',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dealId,updateId:update.id,receivedDate:date,confirmed})});const d=await r.json();if(!r.ok)throw Error(d.error);onSaved();}catch(e){setError(e instanceof Error?e.message:'Could not confirm receipt.');}finally{setBusy(false);}
 }}><h4>Did your payment arrive?</h4><p>Title reported sending <strong>{money}</strong>. Check your bank or cleared check before confirming.</p><label>Date received<input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label><label className="closing-attestation"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I received the full {money} payment shown above.</label><button disabled={busy||!confirmed||!date} className="fund-button">{busy?'Saving…':'Confirm payment received'}</button><small>If the amount is different or still pending, contact your closer before confirming.</small>{error&&<p role="alert">{error}</p>}</form>;
}
