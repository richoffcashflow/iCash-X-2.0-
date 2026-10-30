'use client';
import {useState} from 'react';
export type SellerRecoveryCase={id:string;screening_id:string;address?:string|null;reason:string;quote:string;updated_at:string;review_reason?:string|null};
const next:Record<string,string>={
 owners:'Confirm every required owner and arrange their participation before preparing the agreement.',
 material_facts:'Verify the changed property or agreement details and record the next supported step.',
 callback:'Confirm the seller’s requested date, AM/PM time and timezone using the callback controls.',
 human:'Open the conversation and arrange a person to help.',
 declined:'Respect the seller’s decision and review whether any further contact is appropriate.',
 delivery_unknown:'Check the existing provider result before trying the action again.',
 viewing:'Confirm availability and the buyer’s preferred window before booking a visit.',
};
export function SellerRecoveryCard({item,onResolved,onOpen}:{item:SellerRecoveryCase;onResolved:()=>void;onOpen?:()=>void}){
 const [resolution,setResolution]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <article data-unsaved-draft={resolution.trim()?'true':undefined}><p>{item.review_reason==='contact_checks_expired'?'This follow-up is blocked because its saved contact checks expired. There is no customer refresh button. Reopening the property, saving a note or choosing Return to bot does not renew these checks.':next[item.reason]??'Review the unanswered question and the seller conversation. Record a resolution only after you have completed the follow-up.'}</p>
 {item.quote&&<blockquote className="reply-quote">{item.quote}</blockquote>}
 {onOpen&&<button type="button" className="attention-open" onClick={onOpen}>Open property</button>}
 <div className="review-form">
 <label htmlFor={`recovery-${item.id}`}>Resolution note (not sent to the seller)</label>
 <textarea id={`recovery-${item.id}`} aria-describedby={`recovery-help-${item.id}`} value={resolution} maxLength={2000} rows={3} onChange={e=>setResolution(e.target.value)} placeholder="Record the answer or completed follow-up."/>
 <div className="review-actions"><button className="review-primary" disabled={busy||resolution.trim().length<10} onClick={async()=>{
  setBusy(true);setError('');try{
   const response=await fetch('/api/work/seller-recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,version:item.updated_at,resolution:resolution.trim()})});
   const body=await response.json();if(!response.ok)throw Error(body.error??'Could not save the resolution.');onResolved();
  }catch(e){setError(e instanceof Error?e.message:'Could not save the resolution.');setBusy(false);}
 }}>Save resolution</button></div><small id={`recovery-help-${item.id}`}>Describe the completed follow-up in at least 10 characters. This saves a note; it does not send a message or restart outreach.</small>
 {error&&<p role="alert">{error}</p>}</div></article>;
}
