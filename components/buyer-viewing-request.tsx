'use client';
import {useState} from 'react';
import {safeLocalTime} from './workspace-view';
export type BuyerViewingRequest={kind?:'viewing'|'reservation'|'payment_reported'|'title_company'|'buyer_followup';id:string;screening_id:string;address?:string|null;quote:string;title_quote?:string|null;viewing_quote?:string|null;coordination_quote?:string|null;timezone:string;created_at:string;acknowledged_at?:string|null};
export const buyerRequestTitle=(request:BuyerViewingRequest)=>request.kind==='buyer_followup'?'Buyer needs follow-up':request.kind==='title_company'?'Buyer suggested a local title company':request.kind==='payment_reported'?'Buyer reported a deposit payment':request.kind==='reservation'?'Buyer requested the agreement or deposit instructions':'Buyer wants to see the property';
const viewingHelp='If no viewing times are available, contact the seller for availability, then get back to the buyer with options. Keep any buyer preferences and confirm access with the seller or occupant before booking the visit.';
export function BuyerViewingRequestCard({request,onReviewed}:{request:BuyerViewingRequest;onReviewed:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[resolving,setResolving]=useState(false),[note,setNote]=useState('');
 async function review(action:'acknowledge'|'resolve'){
  if(busy)return;setBusy(true);setError('');
  try{const result=await fetch('/api/work/buyer-viewing-requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:request.id,action,note:action==='resolve'?note:''})});if(!result.ok)throw Error();onReviewed();}
  catch{setError('Could not save. Please try again.');}finally{setBusy(false);}
 }
 return <div>
  <p><strong>{buyerRequestTitle(request)}</strong></p>
  <blockquote style={{whiteSpace:'pre-wrap'}}>{request.quote}</blockquote>
  <small>{safeLocalTime(request.created_at,request.timezone)} · {request.timezone}</small>
  {request.kind==='payment_reported'&&<p>Verify the signed buyer agreement and cleared funds in Viewing times &amp; buyer deposit before reserving the property. Acknowledging this request does not confirm a deposit.</p>}
  {request.kind==='reservation'&&<p>Review the buyer&apos;s request, then prepare the assignment and verified payment instructions when appropriate. A visit is optional. The property remains available until the signed agreement and cleared deposit are confirmed.</p>}
  {(request.kind==='viewing'||!request.kind)&&<p>{viewingHelp}</p>}
  {request.viewing_quote&&request.kind!=='viewing'&&<><p><strong>Viewing request · needs confirmation</strong></p><blockquote style={{whiteSpace:'pre-wrap'}}>{request.viewing_quote}</blockquote><p>{viewingHelp}</p></>}
  {request.title_quote&&<><p><strong>Buyer title-company preference · needs confirmation</strong></p>{request.kind!=='title_company'&&<blockquote style={{whiteSpace:'pre-wrap'}}>{request.title_quote}</blockquote>}<p>Confirm their prior wholesale assignment experience, company name and escrow contact. The team can use their local company after confirming it handles assignments and this property. Acknowledging this request does not select a company or open title.</p></>}
  {request.coordination_quote&&<><p><strong>Other buyer requests · team review</strong></p>{request.coordination_quote!==request.quote&&<blockquote style={{whiteSpace:'pre-wrap'}}>{request.coordination_quote}</blockquote>}<p>Review the exact requests and any corrections before replying. An offer, closing change, financing question, refund request or payment report is unverified. Acknowledging this request does not change terms, send files, contact anyone or authorize an outbound AI buyer call.</p></>}
  {error&&<p role="alert">{error}</p>}
  <p>{request.acknowledged_at?'Acknowledged · still needs follow-up':'This request stays open until you record the outcome.'}</p>
  {!request.acknowledged_at&&<button type="button" disabled={busy} onClick={()=>void review('acknowledge')}>Acknowledge</button>}
  <button type="button" disabled={busy} aria-expanded={resolving} onClick={()=>setResolving(v=>!v)}>Resolve request</button>
  {resolving&&<form onSubmit={e=>{e.preventDefault();void review('resolve');}}><label>What was resolved?<textarea required minLength={3} maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label><small>Record the outcome of every request above. This does not book a viewing, confirm funds or change an agreement.</small><button disabled={busy||note.trim().length<3}>{busy?'Saving…':'Save outcome & close request'}</button></form>}
 </div>;
}
