'use client';
import {useState} from 'react';
import {safeLocalTime} from './workspace-view';
export type BuyerViewingRequest={kind?:'viewing'|'reservation'|'payment_reported';id:string;screening_id:string;address?:string|null;quote:string;timezone:string;created_at:string};
export const buyerRequestTitle=(request:BuyerViewingRequest)=>request.kind==='payment_reported'?'Buyer reported a deposit payment':request.kind==='reservation'?'Buyer is ready for the agreement and deposit':'Buyer wants to see the property';
export function BuyerViewingRequestCard({request,onReviewed}:{request:BuyerViewingRequest;onReviewed:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function review(){
  if(busy)return;setBusy(true);setError('');
  try{const result=await fetch('/api/work/buyer-viewing-requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:request.id})});if(!result.ok)throw Error();onReviewed();}
  catch{setError('Could not save. Please try again.');}finally{setBusy(false);}
 }
 return <div><p><strong>{buyerRequestTitle(request)}</strong></p><blockquote style={{whiteSpace:'pre-wrap'}}>{request.quote}</blockquote><small>{safeLocalTime(request.created_at,request.timezone)} · {request.timezone}</small><p>{request.kind==='payment_reported'?'Verify the signed buyer agreement and cleared funds in Viewing times & buyer deposit before reserving the property. Marking this reviewed does not confirm a deposit.':request.kind==='reservation'?'Prepare the buyer assignment and verified payment instructions. A visit is optional. The property remains available until the signed agreement and cleared deposit are confirmed.':'If no viewing times are available, contact the seller for availability, then get back to the buyer with options. Keep any buyer preferences and confirm access with the seller or occupant before booking the visit.'}</p>{error&&<p role="alert">{error}</p>}<button type="button" disabled={busy} onClick={review}>{busy?'Saving…':'Mark reviewed'}</button></div>;
}
