'use client';
import {useState} from 'react';
import {safeLocalTime} from './workspace-view';
export type BuyerViewingRequest={id:string;screening_id:string;address?:string|null;quote:string;timezone:string;created_at:string};
export function BuyerViewingRequestCard({request,onReviewed}:{request:BuyerViewingRequest;onReviewed:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function review(){
  if(busy)return;setBusy(true);setError('');
  try{const result=await fetch('/api/work/buyer-viewing-requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:request.id})});if(!result.ok)throw Error();onReviewed();}
  catch{setError('Could not save. Please try again.');}finally{setBusy(false);}
 }
 return <div><p><strong>Buyer wants to see the property</strong></p><blockquote style={{whiteSpace:'pre-wrap'}}>{request.quote}</blockquote><small>{safeLocalTime(request.created_at,request.timezone)} · {request.timezone}</small><p>Confirm the requested time and access with the seller or occupant, then reply to the buyer. This visit is not booked yet.</p>{error&&<p role="alert">{error}</p>}<button type="button" disabled={busy} onClick={review}>{busy?'Saving…':'Mark reviewed'}</button></div>;
}
