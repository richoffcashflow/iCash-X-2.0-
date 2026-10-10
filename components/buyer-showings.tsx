'use client';
import {useEffect,useState} from 'react';
import {DateTimeInput} from './date-time-input';
import {safeLocalTime} from './workspace-view';
type Showing={id:string;version:number;buyer_name:string;starts_at:string;ends_at:string;timezone:string;state:string;seller_confirmed_at:string|null;buyer_confirmed_at:string|null;seller_note:string|null;buyer_note:string|null;change_note:string|null};
type Data={showings:Showing[];requests:{id:string;quote:string;viewing_quote:string|null}[]};
const zones={'America/Chicago':'Central','America/New_York':'Eastern','America/Denver':'Mountain','America/Los_Angeles':'Pacific','UTC':'UTC'};
export function BuyerShowings({dealId}:{dealId:string}){
 const [open,setOpen]=useState(false),[data,setData]=useState<Data|null>(null),[refresh,setRefresh]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [selected,setSelected]=useState<Showing|null>(null),[action,setAction]=useState('propose'),[requestId,setRequestId]=useState(''),[buyer,setBuyer]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState(''),[timezone,setTimezone]=useState('America/Chicago'),[note,setNote]=useState(''),[attested,setAttested]=useState(false);
 useEffect(()=>{if(!open)return;const abort=new AbortController();void fetch(`/api/work/showings?dealId=${dealId}`,{cache:'no-store',signal:abort.signal}).then(async r=>{const value=await r.json();if(!r.ok)throw Error(value.error);if(!abort.signal.aborted){setData(value);setError('');}}).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Could not load showings.');});return()=>abort.abort();},[dealId,open,refresh]);
 function edit(showing:Showing|null){setSelected(showing);setAction(showing?'confirm_seller':'propose');setNote('');setAttested(false);setStart('');setEnd('');setError('');setMessage('');if(showing)setTimezone(showing.timezone);}
 async function save(){
  if(busy)return;setBusy(true);setError('');setMessage('');
  try{
   const body={dealId,action,...(selected?{id:selected.id,version:selected.version}:{}),data:action==='propose'?{requestId,buyer,start,end,timezone}:action==='reschedule'?{start,end,timezone,note}:{note}};
   const r=await fetch('/api/work/showings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await r.json();if(!r.ok)throw Error(result.error);
   setMessage(result.message);setSelected(null);setAction('propose');setNote('');setAttested(false);setStart('');setEnd('');setRefresh(v=>v+1);
  }catch(e){setError(e instanceof Error?e.message:'Could not save showing.');setRefresh(v=>v+1);}finally{setBusy(false);}
 }
 const needsTime=action==='propose'||action==='reschedule',confirming=action==='confirm_seller'||action==='confirm_buyer';
 const request=data?.requests.find(r=>r.id===requestId);
 return <details onToggle={e=>{if(e.target===e.currentTarget)setOpen(e.currentTarget.open);}}><summary>Buyer visits</summary>{open&&<>
  <p>A visit is confirmed only after both parties agree to the exact time. Reminders appear in your dashboard. Contact the parties for invitations, changes and visit reminders.</p>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}{!data&&!error&&<p>Loading visits…</p>}
  {data?.showings.map(s=><article key={s.id}><p><strong>{s.buyer_name} · {s.state}</strong></p><p>{safeLocalTime(s.starts_at,s.timezone)} to {new Date(s.ends_at).toLocaleTimeString('en-US',{timeZone:s.timezone,hour:'numeric',minute:'2-digit',hour12:true})} · {s.timezone}</p><p>Seller: {s.seller_confirmed_at?'confirmed':'awaiting confirmation'} · Buyer: {s.buyer_confirmed_at?'confirmed':'awaiting confirmation'}</p>{(s.seller_note||s.buyer_note||s.change_note)&&<details><summary>Confirmation record</summary>{s.seller_note&&<p>Seller: {s.seller_note}</p>}{s.buyer_note&&<p>Buyer: {s.buyer_note}</p>}{s.change_note&&<p>Change: {s.change_note}</p>}</details>}{['proposed','confirmed'].includes(s.state)&&<button type="button" disabled={busy} onClick={()=>edit(s)}>Manage visit</button>}</article>)}
  {data&&<form onSubmit={e=>{e.preventDefault();void save();}}>
   {selected?<><h4>{selected.buyer_name}</h4><p>Confirming: {safeLocalTime(selected.starts_at,selected.timezone)} · {selected.timezone}</p><label>Update<select value={action} onChange={e=>{setAction(e.target.value);setAttested(false);setNote('');}}><option value="confirm_seller">Record seller / occupant confirmation</option><option value="confirm_buyer">Record buyer confirmation</option><option value="reschedule">Reschedule and request both confirmations</option><option value="cancel">Cancel this visit</option><option value="complete">Record completed visit</option></select></label><button type="button" disabled={busy} onClick={()=>edit(null)}>Start another visit</button></>:<><h4>Propose a visit</h4><label>Buyer request<select required value={requestId} onChange={e=>setRequestId(e.target.value)}><option value="">Choose an open viewing request</option>{data.requests.map(r=><option key={r.id} value={r.id}>{(r.viewing_quote??r.quote).slice(0,120)}</option>)}</select></label>{request&&<blockquote>{request.viewing_quote??request.quote}</blockquote>}<label>Buyer name<input required maxLength={200} value={buyer} onChange={e=>setBuyer(e.target.value)}/></label>{!data.requests.length&&<p>No open buyer viewing requests. Buyer requests from conversations will appear here.</p>}</>}
   {needsTime&&<><label>Property timezone<select value={timezone} onChange={e=>setTimezone(e.target.value)}>{Object.entries(zones).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><DateTimeInput label="Visit starts" value={start} onChange={e=>setStart(e.target.value)} required/><DateTimeInput label="Visit ends" value={end} onChange={e=>setEnd(e.target.value)} required/></>}
   {selected&&<label>{confirming?'Confirmation source and exact agreement':'Reason / outcome'}<textarea required minLength={3} maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label>}
   {confirming&&<label><input type="checkbox" required checked={attested} onChange={e=>setAttested(e.target.checked)}/>I verified that this party agreed to the displayed visit time.</label>}
   {action==='reschedule'&&<p>Both confirmations will reset. Confirm the new time with the seller and buyer.</p>}
   <button disabled={busy||(confirming&&!attested)||(!selected&&!requestId)}>{busy?'Saving…':selected?'Save visit update':'Save proposed visit'}</button>
  </form>}
 </>}</details>;
}
