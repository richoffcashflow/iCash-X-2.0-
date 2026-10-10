'use client';
import {useState} from 'react';
import {Check} from 'lucide-react';
import {closingKinds,closingLabels,closingSummary,type ClosingKind,type ClosingUpdate,type ClosingReply} from '@/lib/closing-progress';
import {titleReplySuggestions,type TitleSuggestion} from '@/lib/title-reply-suggestions';
export function ClosingProgress({dealId,updates,replies,onSaved}:{dealId:string;updates:ClosingUpdate[];replies:ClosingReply[];onSaved:()=>void}){
 const [editing,setEditing]=useState(false),[kind,setKind]=useState<ClosingKind>(closingKinds.find(k=>!updates.some(u=>u.kind===k))??'closed');
 const [replyId,setReplyId]=useState(''),[date,setDate]=useState(''),[amount,setAmount]=useState(''),[file,setFile]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const summary=closingSummary(updates),source=replies.find(r=>r.id===replyId),closed=updates.some(u=>u.kind==='funds_disbursed');
 const suggestions=replies.flatMap(titleReplySuggestions).filter(s=>!updates.some(u=>u.kind===s.kind)).slice(0,5);
 function reviewSuggestion(s:TitleSuggestion){setKind(s.kind);setReplyId(s.replyId);setDate(s.effectiveDate??'');setAmount(s.amountCents===null?'':(s.amountCents/100).toFixed(2));setFile(s.fileReference);setConfirmed(false);setError('');setEditing(true);}
 async function save(){
  if(busy||!confirmed||!source)return;
  setBusy(true);setError('');
  try{const r=await fetch('/api/work/closing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dealId,replyId,kind,confirmed,effectiveDate:date||null,amountCents:(kind==='deposit_received'||kind==='funds_disbursed')&&amount!==''?Math.round(Number(amount)*100):null,fileReference:(kind==='title_opened'||kind==='funds_disbursed')?file:''})});const d=await r.json();if(!r.ok)throw Error(d.error);setEditing(false);setConfirmed(false);onSaved();}catch(e){setError(e instanceof Error?e.message:'Could not save. Please retry.');}finally{setBusy(false);}
 }
 return <section className="closing-progress" aria-label="Closing progress"><h4>{summary.label}</h4><p>{summary.next}</p><ol>{closingKinds.map(k=>{const update=updates.find(u=>u.kind===k);return <li key={k} className={update?'complete':''}><span>{update?<Check size={12}/>:null}</span><div>{closingLabels[k]}{update?.effective_date&&<small>{update.effective_date}</small>}{update?.amount_cents!=null&&<small>${(update.amount_cents/100).toLocaleString(undefined,{minimumFractionDigits:2})}</small>}{update?.file_reference&&<small>File {update.file_reference}</small>}</div></li>;})}</ol>
 {!closed&&suggestions.length>0&&<details><summary>Suggested title updates ({suggestions.length})</summary><p>Review the original message and fill any missing facts before confirming.</p>{suggestions.map(s=><article key={s.replyId+s.kind}><strong>{closingLabels[s.kind]}</strong><blockquote>{s.evidence}</blockquote><button type="button" className="demo-button" onClick={()=>reviewSuggestion(s)}>Review suggested update</button></article>)}</details>}
 {!closed&&replies.length>0&&<button className="demo-button" type="button" aria-expanded={editing} onClick={()=>{setEditing(v=>!v);setError('');}}>Record a title update</button>}
 {editing&&<form onSubmit={e=>{e.preventDefault();void save();}}><label>What did title confirm?<select value={kind} onChange={e=>{setKind(e.target.value as ClosingKind);setConfirmed(false);setDate('');setAmount('');setFile('');}}>{closingKinds.map(k=><option key={k} value={k}>{closingLabels[k]}</option>)}</select></label><label>Confirmation from title<select value={replyId} onChange={e=>{setReplyId(e.target.value);setConfirmed(false);}} required><option value="">Choose a received message</option>{replies.map(r=><option key={r.id} value={r.id}>{new Date(r.received_at).toLocaleDateString()} · {r.subject}</option>)}</select></label>
 {source&&<blockquote><strong>{source.sender}</strong><p>{source.body_text}</p></blockquote>}
 {(kind==='title_opened'||kind==='funds_disbursed')&&<label>{kind==='funds_disbursed'?'Payment reference':'File number (optional)'}<input value={file} maxLength={120} onChange={e=>setFile(e.target.value)}/></label>}
 {(kind==='deposit_received'||kind==='funds_disbursed')&&<label>{kind==='funds_disbursed'?'Payment sent by title ($)':'Deposit confirmed by title ($)'}<input type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} required/></label>}
 {(kind==='closing_scheduled'||kind==='closed'||kind==='funds_disbursed')&&<label>{kind==='closing_scheduled'?'Scheduled closing date':'Date completed'}<input type="date" value={date} onChange={e=>setDate(e.target.value)} required/></label>}
 <label className="closing-attestation"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} required/>I checked that the selected title message confirms this update.</label>
 <button className="fund-button" disabled={busy||!source||!confirmed}>{busy?'Saving…':'Save confirmed update'}</button></form>}
 {error&&<p role="alert">{error}</p>}
 <small>Updates link to confirmations from your closing office. iCash X does not receive deposits or move closing funds.</small></section>;
}
