'use client';
import {useEffect,useRef,useState} from 'react';
import {emailSendLabel} from '@/lib/deal-email-policy';
type Contact={contact_key:string;email:string;display_name:string;party:string};
type Mail={id:string;direction:string;recipient:string;subject:string;body_text:string;state:string;delivery_state?:string;created_at:string};
type Cursor={before:string;beforeId:string};
type Data={contacts:Contact[];messages:Mail[];configured:boolean;rate:{id:string;charge_cents:number}|null;next:Cursor|null};
export function DealEmail({dealId,active}:{dealId:string;active:boolean}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[page,setPage]=useState<Cursor|null>(null),[refresh,setRefresh]=useState(0);
 const [contact,setContact]=useState(''),[subject,setSubject]=useState(''),[body,setBody]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[held,setHeld]=useState(false);
 const request=useRef<{key:string;fingerprint:string}|null>(null);
 useEffect(()=>{if(!active)return;const controller=new AbortController();let flight=false;
 async function load(){if(document.hidden||flight)return;flight=true;try{
 const q=new URLSearchParams({dealId,...page});const r=await fetch(`/api/work/emails?${q}`,{signal:controller.signal,cache:'no-store'});if(!r.ok)throw Error();const d=await r.json() as Data;
 if(!controller.signal.aborted){setData(d);setContact(v=>v||d.contacts[0]?.contact_key||'');setError('');}
 }catch{if(!controller.signal.aborted)setError('Could not refresh email. Your draft is still here.');}finally{flight=false;}}
 void load();const timer=setInterval(load,30000);document.addEventListener('visibilitychange',load);return()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',load);};},[dealId,active,page,refresh]);
 const selected=data?.contacts.find(c=>c.contact_key===contact);
 return <div className="deal-mailbox" hidden={!active}>
 {error&&<p role="status">{error}</p>}{!data&&!error&&<p role="status">Loading email…</p>}
 {data&&<><div className="message-history" aria-label="Email history">{!data.messages.length?<p>No email yet.</p>:data.messages.slice().reverse().map(m=><details className="email-item" key={m.id}><summary><span>{m.direction==='incoming'?'↙':'↗'} {m.subject.replace(/\[ICX-M:[^\]]+\]\s*/gi,'')}</span><small>{emailSendLabel(m.state,m.delivery_state)}</small></summary><p className="email-address">{m.direction==='incoming'?'From':'To'}: {m.recipient}</p><p className="email-body">{m.body_text}</p><small>{new Date(m.created_at).toLocaleString('en-US',{hour12:true})}</small></details>)}</div>
 <div className="history-pages">{page&&<button onClick={()=>{setPage(null);setData(null);}}>Latest email</button>}{data.next&&<button onClick={()=>{setPage(data.next);setData(null);}}>Older email</button>}</div>
 {data.contacts.length?<form className="message-composer" data-unsaved-draft={subject.trim()||body.trim()?'true':undefined} onSubmit={async e=>{
 e.preventDefault();if(busy||held||!selected||!data.rate||!data.configured)return;setBusy(true);setStatus('');
 const fingerprint=JSON.stringify([contact,subject.trim(),body.trim(),data.rate.id]);if(!request.current||request.current.fingerprint!==fingerprint)request.current={key:crypto.randomUUID(),fingerprint};
 try{const r=await fetch('/api/work/emails',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dealId,contactKey:contact,requestKey:request.current.key,rateId:data.rate.id,subject:subject.trim(),message:body.trim()})});const result=await r.json();
 if(!r.ok)throw Error(result.error||'Send status needs review.');
 if(result.status==='email_accepted'){setStatus('Accepted for delivery. Replies will appear here.');setSubject('');setBody('');request.current=null;setPage(null);}
 else{setHeld(true);setStatus('Email held. Check its status before sending again.');}
 }catch(e){setStatus(e instanceof Error?e.message:'Send status is uncertain. Check history before sending again.');setHeld(true);}finally{setBusy(false);setRefresh(v=>v+1);}
 }}>
 <label>To<select value={contact} onChange={e=>setContact(e.target.value)} disabled={busy||held}>{data.contacts.map(c=><option value={c.contact_key} key={c.contact_key}>{c.display_name||c.party} · {c.email}</option>)}</select></label>
 <label>Subject<input value={subject} onChange={e=>setSubject(e.target.value)} maxLength={180} required disabled={busy||held}/></label>
 <label>Message<textarea value={body} onChange={e=>setBody(e.target.value)} maxLength={10000} rows={4} required disabled={busy||held}/></label>
 <button type="submit" disabled={busy||held||!selected||!subject.trim()||!body.trim()||!data.configured||!data.rate}>{busy?'Sending…':`Send email${data.rate?` · $${(data.rate.charge_cents/100).toFixed(2)}`:''}`}</button>
 {!data.configured||!data.rate?<small>Email setup is not ready. Your draft has not been sent.</small>:<small>Sent with your business name. Uses your available balance.</small>}
 </form>:<p>Email appears here when a seller, buyer or closing contact has a verified address linked to this deal.</p>}
 {held&&<button className="workspace-quiet" type="button" onClick={()=>{setPage(null);setRefresh(v=>v+1);setStatus('Checking the latest email history. Confirm the recorded status before sending again.');}}>Check latest status</button>}</>}{status&&<p role="status">{status}</p>}
 </div>;
}
