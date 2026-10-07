'use client';
import {useEffect,useRef,useState} from 'react';
import {DealMessages} from './deal-messages';
import {displayContactPhone} from './manual-call-options';
import {MessageCircle} from 'lucide-react';
type Contact={phone:string;name:string;phone_type:string;blocked:boolean};
export function PropertyMessages({screeningId,active,onTakeover}:{screeningId:string;active:boolean;onTakeover:()=>void}){
 const [contacts,setContacts]=useState<Contact[]>([]),[dealId,setDealId]=useState(''),[threadId,setThreadId]=useState(''),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 const lock=useRef(false);
 async function open(contact:Contact){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{const r=await fetch('/api/work/text-contact',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({screeningId,phone:contact.phone})});const d=await r.json();if(!r.ok||!d.dealId)throw Error(d.error||'Could not open this conversation.');setDealId(d.dealId);setThreadId(d.threadId);}
  catch(e){setError(e instanceof Error?e.message:'Could not open this conversation.');}finally{lock.current=false;setBusy(false);}
 }
 useEffect(()=>{
  if(!active||loaded)return;const abort=new AbortController();
  void fetch(`/api/work/text-contact?screeningId=${screeningId}`,{cache:'no-store',signal:abort.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);if(abort.signal.aborted)return;setContacts(d.contacts);setLoaded(true);setError('');if(d.dealId)setDealId(d.dealId);else {const usable=d.contacts.filter((c:Contact)=>!c.blocked&&c.phone_type!=='landline');if(usable.length===1)void open(usable[0]);}}).catch(()=>{if(!abort.signal.aborted)setError('Could not load saved numbers.');});
  return()=>abort.abort();
 // Opening the one available contact creates an empty conversation; it sends nothing.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[screeningId,active,loaded,refresh]);
 return <div className="property-messages">{error&&<div className="contact-alert" role="alert"><span>{error}</span><button type="button" onClick={()=>{setLoaded(false);setRefresh(v=>v+1);}}>Retry</button></div>}{!loaded&&!error&&<p role="status">Loading saved numbers…</p>}{busy&&<p role="status">Opening conversation…</p>}{dealId&&<DealMessages key={dealId} dealId={dealId} initialThreadId={threadId} active={active} onTakeover={onTakeover} contactNames={Object.fromEntries(contacts.map(c=>[c.phone,c.name]))}/>}{loaded&&(!dealId||contacts.length>1)&&<details open={!dealId} className="text-contact-picker"><summary>{dealId?'Other saved contacts':'Choose a contact'}</summary>{contacts.length?contacts.map(c=><div className="seller-contact-card" key={c.phone}><div className="seller-contact-identity"><span className="seller-contact-avatar">{(c.name||'S').slice(0,1).toUpperCase()}</span><div><strong>{c.name||'Saved contact'}</strong><span>{displayContactPhone(c.phone)}</span></div></div>{c.blocked?<small>Do not contact</small>:c.phone_type==='landline'?<small>Landline · use Call</small>:<button className="contact-primary" type="button" disabled={busy} onClick={()=>void open(c)}><MessageCircle size={16}/>Open text conversation</button>}</div>):<p>No phone number has been saved for this property yet.</p>}</details>}</div>;
}
