'use client';
import {useState} from 'react';
import {DateTimeInput} from './date-time-input';
import {safeLocalTime} from './workspace-view';
export type Handoff={address?:string|null;id:string;screening_id:string;party:string;reason:string;summary:string;next_action:string;state:string;assigned_to?:string|null;due_at?:string;resolution?:string|null};
export function HandoffCard({handoff:h,onChanged}:{handoff:Handoff;onChanged?:()=>void}){
 const [person,setPerson]=useState(h.assigned_to??'Me'),[due,setDue]=useState(''),[note,setNote]=useState(''),[resume,setResume]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function save(action:'assign'|'resolve'){
  if(busy)return;setBusy(true);setError('');
  try{const r=await fetch('/api/work/handoffs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:h.id,action,...(action==='assign'?{assignee:person,dueAt:due?new Date(due).toISOString():new Date(Date.now()+2*3600000).toISOString()}:{resolution:note,resume})})});const out=await r.json();if(!r.ok)throw Error(out.error);onChanged?.();}
  catch(e){setError(e instanceof Error?e.message:'Could not save.');}finally{setBusy(false);}
 }
 return <article className="handoff-card"><strong>{h.party==='buyer'?'Buyer':'Seller'} needs a person</strong><p>{h.reason}</p><p>{h.next_action}</p>{h.assigned_to&&<p>Responsible: {h.assigned_to}</p>}{h.due_at&&<p>{Date.parse(h.due_at)<Date.now()?'Overdue':'Due'} · {safeLocalTime(h.due_at)}</p>}<details><summary>Summary & assignment</summary><p>{h.summary}</p><label>Responsible person<input maxLength={200} value={person} onChange={e=>setPerson(e.target.value)}/></label><DateTimeInput label="Follow up by (your local time)" value={due} onChange={e=>setDue(e.target.value)}/><button disabled={busy||person.trim().length<2} onClick={()=>void save('assign')}>Assign follow-up</button><small>Defaults to two hours from now. Enabled account alerts notify you; this stays visible until resolved.</small></details>
 <details><summary>Resolve this request</summary><label>What was resolved?<textarea value={note} minLength={5} maxLength={2000} onChange={e=>setNote(e.target.value)}/></label><label><input type="checkbox" checked={resume} onChange={e=>setResume(e.target.checked)}/>Return this property to the bot after resolving the request.</label><button disabled={busy||note.trim().length<5} onClick={()=>void save('resolve')}>Save resolution</button></details>{error&&<p role="alert">{error}</p>}</article>;
}
