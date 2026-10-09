'use client';
import {useState} from 'react';
export type SellerRecoveryCase={id:string;screening_id:string;address?:string|null;reason:string;quote:string;updated_at:string};
const next:Record<string,string>={
 owners:'Confirm every required owner and arrange their participation before preparing the agreement.',
 material_facts:'Verify the changed property or agreement details and record the next supported step.',
 callback:'Confirm the seller’s requested date, AM/PM time and timezone using the callback controls.',
 human:'Open the conversation and arrange a person to help.',
 declined:'Respect the seller’s decision and review whether any further contact is appropriate.',
 delivery_unknown:'Check the existing provider result before trying the action again.',
 viewing:'Confirm availability and the buyer’s preferred window before booking a visit.',
};
export function SellerRecoveryCard({item,onResolved}:{item:SellerRecoveryCase;onResolved:()=>void}){
 const [resolution,setResolution]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <article data-unsaved-draft={resolution.trim()?'true':undefined}><p>{next[item.reason]??'Review the unanswered question and provide an accurate answer or a concrete follow-up.'}</p>
 {item.quote&&<blockquote className="reply-quote">{item.quote}</blockquote>}
 <label htmlFor={`recovery-${item.id}`}>What resolved this?</label>
 <textarea id={`recovery-${item.id}`} value={resolution} maxLength={2000} rows={3} onChange={e=>setResolution(e.target.value)} placeholder="Record the answer or completed follow-up."/>
 <button disabled={busy||resolution.trim().length<10} onClick={async()=>{
  setBusy(true);setError('');try{
   const response=await fetch('/api/work/seller-recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,version:item.updated_at,resolution:resolution.trim()})});
   const body=await response.json();if(!response.ok)throw Error(body.error??'Could not save the resolution.');onResolved();
  }catch(e){setError(e instanceof Error?e.message:'Could not save the resolution.');setBusy(false);}
 }}>Save resolution</button><small>This records your follow-up. Use the conversation controls to contact the seller.</small>
 {error&&<p role="alert">{error}</p>}</article>;
}
