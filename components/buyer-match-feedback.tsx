'use client';
import {useRef,useState} from 'react';
import {webinarRequest} from '@/lib/webinar-client';
export function BuyerMatchFeedback({matchId,onSaved}:{matchId:string;onSaved:()=>Promise<void>}){
 const [reason,setReason]=useState('price'),[price,setPrice]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const lock=useRef(false),key=useRef<string|null>(null);
 return <details><summary>Suggest a price or explain what needs to change</summary><form onSubmit={e=>{e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setMessage('');key.current??=crypto.randomUUID();
  void webinarRequest('/api/buyer-network',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({matchId,state:reason==='price'?'interested':'passed',key:key.current,reason,...(reason==='price'?{counterofferCents:Number(price)*100}:{})})}).then(async()=>{setMessage('Your feedback is saved for the deal owner. A suggested price is not an accepted agreement.');await onSaved();}).catch(()=>setMessage('Could not save your feedback. Please retry.')).finally(()=>{lock.current=false;setBusy(false);});
 }}><label>What needs to change?<select value={reason} disabled={busy} onChange={e=>{setReason(e.target.value);key.current=null;}}><option value="price">Price</option><option value="repairs">Condition or repairs</option><option value="timing">Timing</option><option value="location">Location</option><option value="capacity">I’m not buying right now</option><option value="other">Another concern</option></select></label>
 {reason==='price'&&<label>My suggested total purchase price ($)<input type="number" min={1000} max={100000000} step={1000} required value={price} disabled={busy} onChange={e=>{setPrice(e.target.value);key.current=null;}}/></label>}
 <button disabled={busy} type="submit">{busy?'Saving…':'Send feedback'}</button>{message&&<p role="status">{message}</p>}</form></details>;
}
