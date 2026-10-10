'use client';
import {useState} from 'react';
export type BuyerViewingRequest={kind?:'viewing'|'reservation'|'payment_reported'|'title_company'|'buyer_followup';id:string;screening_id:string;address?:string|null;quote:string;title_quote?:string|null;viewing_quote?:string|null;coordination_quote?:string|null;timezone:string;created_at:string;acknowledged_at?:string|null};
export const buyerRequestTitle=(request:BuyerViewingRequest)=>request.kind==='buyer_followup'?'Buyer needs follow-up':request.kind==='title_company'?'Buyer suggested a local title company':request.kind==='payment_reported'?'Buyer reported a deposit payment':request.kind==='reservation'?'Buyer requested the agreement or deposit instructions':'Buyer wants to see the property';
const viewingHelp='Check the seller’s available times and reply with options that fit the buyer’s preferences. If no times are saved, ask the seller first. Confirm access with the seller or occupant before booking.';
function requestTime(request:BuyerViewingRequest){
 const date=new Date(request.created_at);if(!Number.isFinite(date.getTime()))return 'Time unavailable';
 const options:Intl.DateTimeFormatOptions={month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true,timeZoneName:'short'};
 try{return date.toLocaleString('en-US',{...options,timeZone:request.timezone});}catch{return date.toLocaleString('en-US',{...options,timeZone:'UTC'});}
}
export function BuyerViewingRequestCard({request,onReviewed,embedded=false}:{request:BuyerViewingRequest;onReviewed:()=>void;embedded?:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[resolving,setResolving]=useState(false),[note,setNote]=useState('');
 async function review(action:'acknowledge'|'resolve'){
  if(busy)return;setBusy(true);setError('');
  try{const result=await fetch('/api/work/buyer-viewing-requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:request.id,action,note:action==='resolve'?note:''})});if(!result.ok)throw Error();onReviewed();}
  catch{setError('Could not save. Please try again.');}finally{setBusy(false);}
 }
 return <div className="buyer-request-card">
  {!embedded&&<p><strong>{buyerRequestTitle(request)}</strong></p>}
  <blockquote className="review-quote">{request.quote}</blockquote>
  <time className="review-meta" dateTime={request.created_at} title={request.timezone}>{requestTime(request)}</time>
  {request.kind==='payment_reported'&&<p>Verify the signed buyer agreement and cleared funds in Viewing times &amp; buyer deposit before reserving the property. Acknowledging this request does not confirm a deposit.</p>}
  {request.kind==='reservation'&&<p>Review the buyer&apos;s request, then prepare the assignment and verified payment instructions when appropriate. A visit is optional. The property remains available until the signed agreement and cleared deposit are confirmed.</p>}
  {(request.kind==='viewing'||!request.kind)&&<p>{viewingHelp}</p>}
  {request.viewing_quote&&request.kind!=='viewing'&&<><p><strong>Viewing request · needs confirmation</strong></p><blockquote className="review-quote">{request.viewing_quote}</blockquote><p>{viewingHelp}</p></>}
  {request.title_quote&&<><p><strong>Buyer title-company preference · needs confirmation</strong></p>{request.kind!=='title_company'&&<blockquote className="review-quote">{request.title_quote}</blockquote>}<p>Confirm their prior wholesale assignment experience, company name and escrow contact. The team can use their local company after confirming it handles assignments and this property. Acknowledging this request does not select a company or open title.</p></>}
  {request.coordination_quote&&<><p><strong>Other buyer requests · team review</strong></p>{request.coordination_quote!==request.quote&&<blockquote className="review-quote">{request.coordination_quote}</blockquote>}<p>Review the exact requests and any corrections before replying. An offer, closing change, financing question, refund request or payment report is unverified. Acknowledging this request does not change terms, send files, contact anyone or authorize an outbound AI buyer call.</p></>}
  {error&&<p role="alert">{error}</p>}
  <p className="review-meta">{request.acknowledged_at?'Acknowledged · still needs follow-up':'Stays open until you save an outcome.'}</p>
  <div className="review-actions">
   {!request.acknowledged_at&&<button className="review-secondary" type="button" disabled={busy} onClick={()=>void review('acknowledge')}>Acknowledge</button>}
   <button className="review-primary" type="button" disabled={busy} aria-expanded={resolving} aria-controls={`buyer-outcome-${request.id}`} onClick={()=>setResolving(v=>!v)}>{resolving?'Cancel resolution':'Resolve request'}</button>
  </div>
  {resolving&&<form id={`buyer-outcome-${request.id}`} className="review-form" onSubmit={e=>{e.preventDefault();void review('resolve');}}><label htmlFor={`buyer-note-${request.id}`}>What was resolved?</label><textarea id={`buyer-note-${request.id}`} required minLength={3} maxLength={1000} rows={3} disabled={busy} value={note} onChange={e=>setNote(e.target.value)}/><small>Record the outcome of every request above. This does not book a viewing, confirm funds or change an agreement.</small><div className="review-actions"><button className="review-primary" disabled={busy||note.trim().length<3}>{busy?'Saving…':'Save outcome & close request'}</button></div></form>}
 </div>;
}
