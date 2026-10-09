'use client';
import {useEffect,useRef,useState} from 'react';
import {DateTimeInput} from './date-time-input';
import {analysisMoney} from '@/lib/property-analysis-view';
import {buyerDepositMethods,buyerDepositMethodLabels,sellerViewingSlots,viewingSlotLabel} from '@/lib/buyer-purchase-terms';
import {safeLocalTime} from './workspace-view';
type Data={availability:{quote:string;slots:unknown;state:string;timezone:string;stated_at:string}|null;receipt:{amount_cents:number;method:string;reference:string;created_at:string}|null;assignment:{id:string;buyer:string;depositCents:number|null}|null};
const zones={'America/Chicago':'Central','America/New_York':'Eastern','America/Denver':'Mountain','America/Los_Angeles':'Pacific','UTC':'UTC'};
function windowText(start:string,end:string,timezone:keyof typeof zones){
 const parse=(value:string)=>{const m=value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);if(!m)throw Error('Choose an exact date and time.');const h=Number(m[2]);return {date:m[1],time:`${h%12||12}:${m[3]} ${h<12?'AM':'PM'}`};};
 const a=parse(start),b=end?parse(end):null;if(b&&b.date!==a.date)throw Error('Use a start and end on the same day.');
 return `${a.date} ${a.time}${b?' to '+b.time:''} ${zones[timezone]}`;
}
export function BuyerDealCoordination({dealId}:{dealId:string}){
 const [open,setOpen]=useState(false);
 const [data,setData]=useState<Data|null>(null),[refresh,setRefresh]=useState(0),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [statement,setStatement]=useState(''),[timezone,setTimezone]=useState<keyof typeof zones>('America/Chicago'),[windows,setWindows]=useState([{start:'',end:''}]),[sellerConfirmed,setSellerConfirmed]=useState(false);
 const [method,setMethod]=useState<typeof buyerDepositMethods[number]>('wire'),[reference,setReference]=useState(''),[cleared,setCleared]=useState(false);
 const attempts=useRef<{body:string;key:string}|null>(null);
 useEffect(()=>{if(!open)return;const controller=new AbortController();setError('');void fetch(`/api/work/buyer-coordination?dealId=${dealId}`,{cache:'no-store',signal:controller.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);setData(d);}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not load coordination.');});return()=>controller.abort();},[dealId,refresh,open]);
 async function save(body:Record<string,unknown>){
  if(busy)return;setBusy(true);setError('');setMessage('');
  const serialized=JSON.stringify(body);if(attempts.current?.body!==serialized)attempts.current={body:serialized,key:crypto.randomUUID()};
  try{const r=await fetch('/api/work/buyer-coordination',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,dealId,key:attempts.current.key})});const out=await r.json();if(!r.ok)throw Error(out.error);setMessage(body.action==='deposit'?'Cleared deposit recorded. Property reserved; buyer marketing is held.':'Seller availability saved. Specific buyer visits still need confirmation.');setRefresh(v=>v+1);}
  catch(e){setError(e instanceof Error?e.message:'Could not save.');}finally{setBusy(false);}
 }
 const slots=sellerViewingSlots(data?.availability?.slots),deposit=data?.assignment?.depositCents;
 return <details className="deal-contract-tools" onToggle={e=>setOpen(e.currentTarget.open)}><summary>Viewing times & buyer deposit</summary>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}{!data&&!error&&<p>Loading…</p>}
  {data&&<><button type="button" disabled={busy} onClick={()=>setRefresh(v=>v+1)}>Refresh times & deposit</button><h4>Seller viewing availability</h4>{data.availability?<><blockquote>{data.availability.quote}</blockquote><small>{safeLocalTime(data.availability.stated_at,data.availability.timezone)}</small>{slots.length?<ul>{slots.map(s=><li key={s.startsAt}>{viewingSlotLabel(s)}</li>)}</ul>:<p>{data.availability.state==='withdrawn'?'The previous viewing times were withdrawn.':'Exact future times need confirmation with the seller.'}</p>}</>:<p>No seller times are saved yet. Ask for two or three dates, start/end times and the timezone.</p>}
   <p>Viewing is optional for the buyer. Seller windows are offered as options; a specific visit still needs confirmation.</p>
   <details><summary>Save seller-provided times</summary><label>Seller’s statement<textarea value={statement} onChange={e=>setStatement(e.target.value)} maxLength={4000}/></label><label>Property timezone<select value={timezone} onChange={e=>setTimezone(e.target.value as keyof typeof zones)}>{Object.entries(zones).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    {windows.map((w,i)=><div key={i}><DateTimeInput label={`Viewing option ${i+1} start`} value={w.start} onChange={e=>setWindows(all=>all.map((v,n)=>n===i?{...v,start:e.target.value}:v))}/><DateTimeInput label={`Viewing option ${i+1} end (optional)`} value={w.end} onChange={e=>setWindows(all=>all.map((v,n)=>n===i?{...v,end:e.target.value}:v))}/>{windows.length>1&&<button type="button" onClick={()=>setWindows(all=>all.filter((_,n)=>n!==i))}>Remove option</button>}</div>)}
    <button type="button" disabled={windows.length>=8||busy} onClick={()=>setWindows(all=>[...all,{start:'',end:''}])}>Add viewing option</button>
    <label><input type="checkbox" checked={sellerConfirmed} onChange={e=>setSellerConfirmed(e.target.checked)}/>The seller provided these times.</label>
    <button type="button" disabled={busy||!sellerConfirmed||!statement.trim()} onClick={()=>{try{void save({action:'availability',statement,timezone,windows:windows.map(w=>windowText(w.start,w.end,timezone))});}catch(e){setError(e instanceof Error?e.message:'Check the times.');}}}>Save availability</button>
    <button type="button" disabled={busy||!sellerConfirmed||!statement.trim()} onClick={()=>void save({action:'availability',statement,timezone,windows:[]})}>Withdraw previous times</button>
   </details>
   <h4>Buyer deposit</h4>{data.receipt?<><p><strong>Reserved · {analysisMoney(data.receipt.amount_cents)} confirmed</strong></p><p>{buyerDepositMethodLabels[data.receipt.method as keyof typeof buyerDepositMethodLabels]??'Verified closing contact'} · {data.receipt.reference}</p></>:<><p>Payment choices: check, wire, Cash App or Zelle. Provide receiving details through your verified deal contact. A buyer’s payment claim does not confirm receipt.</p>{data.assignment&&typeof deposit==='number'&&deposit>0&&deposit<=500000?<><p>Signed assignment for {data.assignment.buyer}: {analysisMoney(deposit)} deposit.</p><label>Received by<select value={method} onChange={e=>setMethod(e.target.value as typeof method)}>{buyerDepositMethods.map(m=><option value={m} key={m}>{buyerDepositMethodLabels[m]}</option>)}</select></label><label>Receipt or transaction reference<input value={reference} maxLength={120} onChange={e=>setReference(e.target.value)}/><small>Use a reference only; do not enter account numbers or credentials.</small></label><label><input type="checkbox" checked={cleared} onChange={e=>setCleared(e.target.checked)}/>I verified that {analysisMoney(deposit)} was received and cleared, including any check clearing.</label><button type="button" disabled={busy||!cleared||reference.trim().length<3} onClick={()=>void save({action:'deposit',envelopeId:data.assignment!.id,amountCents:deposit,method,reference,cleared:true})}>Confirm receipt & reserve property</button></>:<p>A current signed buyer assignment with its deposit amount is required before confirming funds.</p>}</>}
  </>}
 </details>;
}
