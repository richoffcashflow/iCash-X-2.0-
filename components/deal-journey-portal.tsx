'use client';
import {useEffect,useState} from 'react';
import {DateTimeInput} from './date-time-input';
import {safeLocalTime} from './workspace-view';
import styles from './deal-journey-portal.module.css';
import {blockerKinds,blockerLabels,type BlockerKind,type JourneyBlocker} from '@/lib/deal-completion';
type Showing={id:string;version:number;start:string;end:string;timezone:string;state:string;sellerConfirmed:boolean;buyerConfirmed:boolean};
type Data={role:'buyer'|'seller';address:string;state:string;wantsAssignment:boolean;wantsViewing:boolean;detailsSubmitted?:boolean;askingPriceCents?:number;depositCents?:number;blocker?:JourneyBlocker|null;packageUrl?:string|null;showing:Showing|null;slots?:{startsAt:string;endsAt:string|null;timezone:string}[]};
const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:n%100?2:0}).format(n/100);
const zones={'America/Chicago':'Central','America/New_York':'Eastern','America/Denver':'Mountain','America/Los_Angeles':'Pacific'};
export function DealJourneyPortal({token}:{token:string}){
 const [data,setData]=useState<Data|null>(null),[refresh,setRefresh]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [legalName,setLegalName]=useState(''),[signerName,setSignerName]=useState(''),[email,setEmail]=useState(''),[titleCompany,setTitleCompany]=useState(''),[funds,setFunds]=useState(false),[authorized,setAuthorized]=useState(false);
 const [start,setStart]=useState(''),[end,setEnd]=useState(''),[zone,setZone]=useState<keyof typeof zones>('America/Chicago');
 const [help,setHelp]=useState(false),[blockerKind,setBlockerKind]=useState<BlockerKind>('access'),[note,setNote]=useState('');
 useEffect(()=>{const abort=new AbortController();void fetch(`/api/next/${token}`,{cache:'no-store',signal:abort.signal}).then(async r=>{const out=await r.json();if(!r.ok)throw Error(out.error);setData(out);}).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Could not load.');});return()=>abort.abort();},[token,refresh]);
 async function save(action:string,payload:unknown){
  if(busy)return;setBusy(true);setError('');setMessage('');
  try{const r=await fetch(`/api/next/${token}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,data:payload})});const out=await r.json();if(!r.ok)throw Error(out.error);
   setMessage(action==='blocker'?'Your request is saved. The team will follow up with the next step.':action==='request_assignment'?'Complete your buyer details below.':action==='request_viewing'?'Choose an available time below.':action==='details'?'Your details are saved. Watch for your assignment signing link.':action==='choose_time'?'Your choice is saved. We are asking the seller to confirm.':action==='availability'?'Your availability is saved. A specific visit still needs confirmation.':action==='cancel'?'Visit cancelled. You can choose a new time.':'Your confirmation is saved.');setHelp(false);setRefresh(v=>v+1);
  }catch(e){setError(e instanceof Error?e.message:'Could not save.');}finally{setBusy(false);}
 }
 function availability(){
  const fmt=(value:string)=>{const [day,time]=value.split('T');const [h,m]=time.split(':').map(Number);return {day,time:`${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}`};};
  if(!start||!end||start>=end||start.split('T')[0]!==end.split('T')[0]){setError('Choose a start and end on the same future date.');return;}
  const a=fmt(start),b=fmt(end);void save('availability',{windows:[`${a.day} ${a.time} to ${b.time} ${zones[zone]}`]});
 }
 const showing=data?.showing,active=showing&&['proposed','confirmed'].includes(showing.state);
 return <main className={styles.page}><article className={styles.card}><a className={styles.brand} href="/">iCash X</a><h1>Your next step</h1>{data&&<p className={styles.address}>{data.address}</p>}
 {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}{!data&&!error&&<p>Loading your next step…</p>}
 {data?.role==='buyer'&&<>
  {data.state!=='human_review'&&<ol className={styles.steps} aria-label="Purchase progress">{[{label:'Buyer details',done:!!data.detailsSubmitted},{label:'Assignment signed',done:['deposit_due','reserved'].includes(data.state)},{label:'Deposit confirmed',done:data.state==='reserved'}].map(s=><li key={s.label} className={s.done?styles.complete:undefined}>{s.done?'✓ ':''}{s.label}</li>)}</ol>}
  {data.packageUrl&&/^https:\/\/homeoffernetwork\.com\/d\/[a-f0-9]{32}$/.test(data.packageUrl)&&<a className={styles.packageLink} href={data.packageUrl}>View property photos & package</a>}
  {typeof data.askingPriceCents==='number'&&<p><strong>{money(data.askingPriceCents)}</strong> · Buyer pays all closing costs. The assignment fee is included in this price.</p>}
  {typeof data.depositCents==='number'&&<p>Non-refundable deposit: <strong>{money(data.depositCents)}</strong>, under the assignment agreement. Get payment details from your verified deal contact. A payment report does not confirm receipt.</p>}
  {!data.blocker&&data.state==='collecting'&&!data.wantsAssignment&&<button disabled={busy} onClick={()=>void save('request_assignment',{})}>I’m ready to buy</button>}
  {!data.wantsViewing&&['collecting','ready','signing','deposit_due','reserved'].includes(data.state)&&<button className={styles.secondary} disabled={busy} onClick={()=>void save('request_viewing',{})}>Schedule a viewing</button>}
  {data.blocker&&<section role="status"><strong>{data.blocker.kind==='access'?'Checking viewing options with the seller':'The team is reviewing your request'}</strong><p>{blockerLabels[data.blocker.kind]}</p>{data.blocker.note&&<p>{data.blocker.note}</p>}</section>}
  {data.wantsAssignment&&!data.detailsSubmitted&&data.state==='collecting'&&(!data.blocker||data.blocker.kind==='access')&&<form onSubmit={e=>{e.preventDefault();void save('details',{legalName,signerName,email,askingPriceCents:data.askingPriceCents,depositCents:data.depositCents,fundsReady:funds,authorized,titleCompany});}}>
   <h2>Prepare your assignment</h2><label>Buyer’s legal name or company<input autoComplete="organization" required minLength={2} maxLength={200} value={legalName} onChange={e=>setLegalName(e.target.value)}/></label>
   <label>Person signing<input autoComplete="name" required minLength={2} maxLength={200} value={signerName} onChange={e=>setSignerName(e.target.value)}/></label>
   <label>Email<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></label>
   <label>Preferred local title company (optional)<input maxLength={200} value={titleCompany} onChange={e=>setTitleCompany(e.target.value)}/></label>
   <label className={styles.check}><input type="checkbox" required checked={funds} onChange={e=>setFunds(e.target.checked)}/>I have funds available for the purchase, deposit and closing costs.</label>
   <label className={styles.check}><input type="checkbox" required checked={authorized} onChange={e=>setAuthorized(e.target.checked)}/>I am authorized to sign for this buyer and request the assignment at the displayed price.</label>
   <button disabled={busy||!funds||!authorized}>{busy?'Saving…':'Prepare my assignment'}</button><small>This request does not sign the agreement or reserve the property.</small>
  </form>}
  {data.detailsSubmitted&&<p>{data.state==='reserved'?'Your signed assignment and deposit receipt are confirmed.':data.state==='deposit_due'?'Your assignment is signed. Arrange your deposit through the verified deal contact.':data.state==='needs_review'?'Your request needs the team’s review. Reply to your deal contact for help.':'Your buyer details are saved. Watch for the assignment signing link.'}</p>}
  {data.wantsViewing&&!active&&<section><h2>Choose a viewing time</h2><p>Viewing is optional. The seller must confirm your specific visit.</p>{data.slots?.length&&data.blocker?.kind!=='access'?data.slots.map(slot=><button key={slot.startsAt} disabled={busy} onClick={()=>void save('choose_time',{startsAt:slot.startsAt})}>{safeLocalTime(slot.startsAt,slot.timezone)} · {slot.timezone}</button>):<p>We’re checking with the seller and will get back to you with available times.</p>}</section>}
  {data.state!=='human_review'&&<section><button className={styles.secondary} disabled={busy} aria-expanded={help} onClick={()=>setHelp(v=>!v)}>{help?'Close help request':data.blocker?'Update my request':'Need something before moving forward?'}</button>{help&&<form onSubmit={e=>{e.preventDefault();void save('blocker',{kind:blockerKind,note});}}><label>What do you need?<select value={blockerKind} onChange={e=>setBlockerKind(e.target.value as BlockerKind)}>{blockerKinds.map(k=><option key={k} value={k}>{blockerLabels[k]}</option>)}</select></label><label>Anything the team should know?<textarea rows={3} maxLength={1000} value={note} onChange={e=>setNote(e.target.value)} placeholder="For example, Saturday afternoon works better for a viewing."/></label><small>Share bank details and financial documents directly with your verified closing contact.</small><button disabled={busy}>Send my request</button></form>}</section>}
 </>}
 {active&&<section><h2>{showing.state==='confirmed'?'Visit confirmed':'Confirm your visit'}</h2><p>{safeLocalTime(showing.start,showing.timezone)} to {new Date(showing.end).toLocaleTimeString('en-US',{timeZone:showing.timezone,hour:'numeric',minute:'2-digit',hour12:true})} · {showing.timezone}</p><p>Seller: {showing.sellerConfirmed?'confirmed':'pending'} · Buyer: {showing.buyerConfirmed?'confirmed':'pending'}</p>
  {!(data?.role==='seller'?showing.sellerConfirmed:showing.buyerConfirmed)&&<button disabled={busy} onClick={()=>void save('confirm',{id:showing.id,version:showing.version})}>This time works for me</button>}
  <button disabled={busy} onClick={()=>void save('cancel',{id:showing.id,version:showing.version})}>Cancel / choose another time</button>
 </section>}
 {data?.role==='seller'&&<form onSubmit={e=>{e.preventDefault();availability();}}><h2>Good times for a viewing</h2><p>Share an available window. We’ll confirm a specific visit with you before anyone comes.</p><label>Timezone<select value={zone} onChange={e=>setZone(e.target.value as keyof typeof zones)}>{Object.entries(zones).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><DateTimeInput label="Available from" value={start} onChange={e=>setStart(e.target.value)} required/><DateTimeInput label="Available until" value={end} onChange={e=>setEnd(e.target.value)} required/><button disabled={busy}>Share availability</button></form>}
 {data&&<small>Need a person or a change to your agreement? Reply to the message that brought you here.</small>}
 </article></main>;
}
