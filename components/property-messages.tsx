'use client';
import type {AssistantDraft} from '@/lib/workspace-assistant-coach';
import {PrivatePhone} from '@/components/owner-phone-privacy';
import {useEffect,useRef,useState} from 'react';
import {webinarRequest as workspaceRequest} from '@/lib/webinar-client';
import {DealMessages} from './deal-messages';
import {displayContactPhone} from './manual-call-options';
import {MessageCircle} from 'lucide-react';
type Contact={phone:string;name:string;phone_type:string;blocked:boolean};
type SavedContacts={contacts:Contact[];contactsUnavailable?:boolean;dealId?:string|null;threadId?:string|null};
export function PropertyMessages({apiBase='/api/work',markRead=true,draftRequest,screeningId,active,onTakeover,preferredThreadId='',knownDealId='',onRecipientChange}:{apiBase?:string;markRead?:boolean;draftRequest?:AssistantDraft;screeningId:string;active:boolean;preferredThreadId?:string;knownDealId?:string;onRecipientChange?:(phone:string)=>void;onTakeover:()=>void}){
 const [contacts,setContacts]=useState<Contact[]>([]),[dealId,setDealId]=useState(knownDealId),[threadId,setThreadId]=useState(preferredThreadId),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[contactsError,setContactsError]=useState(false),[refresh,setRefresh]=useState(0);
 useEffect(()=>{if(knownDealId)setDealId(knownDealId);},[knownDealId]);
 const lock=useRef(false);
 const opening=useRef<AbortController|null>(null);
 useEffect(()=>()=>{opening.current?.abort();opening.current=null;lock.current=false;},[]);
 useEffect(()=>{if(active)setThreadId(preferredThreadId);},[active,preferredThreadId]);
 async function open(contact:Contact){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  const controller=new AbortController();opening.current=controller;
  try{const d=await workspaceRequest<{dealId?:string;threadId?:string}>(`${apiBase}/text-contact`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({screeningId,phone:contact.phone}),signal:controller.signal});if(controller.signal.aborted)return;if(typeof d.dealId!=='string'||!d.dealId||typeof d.threadId!=='string'||!d.threadId)throw Error('Could not open this conversation.');setDealId(d.dealId);setThreadId(d.threadId);}
  catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not open this conversation.');}finally{if(opening.current===controller){opening.current=null;lock.current=false;if(!controller.signal.aborted)setBusy(false);}}
 }
 useEffect(()=>{
  if(!active||loaded)return;const abort=new AbortController();
  void workspaceRequest<SavedContacts>(`${apiBase}/text-contact?screeningId=${screeningId}`,{cache:'no-store',signal:abort.signal}).then(d=>{if(abort.signal.aborted)return;if(!Array.isArray(d.contacts)||d.contacts.some(c=>!c||typeof c.phone!=='string'||(c.name!==null&&typeof c.name!=='string')||typeof c.phone_type!=='string'||typeof c.blocked!=='boolean')||(d.dealId!=null&&typeof d.dealId!=='string'))throw Error('Could not load contacts.');setContacts(d.contacts);setLoaded(true);setContactsError(d.contactsUnavailable===true);if(d.dealId){setDealId(d.dealId);setError('');}else {const usable=d.contacts.filter((c:Contact)=>!c.blocked&&c.phone_type!=='landline');if(usable.length===1)void open(usable[0]);}}).catch(()=>{if(!abort.signal.aborted)setContactsError(true);});
  return()=>abort.abort();
 // Opening the one available contact creates an empty conversation; it sends nothing.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[apiBase,screeningId,active,loaded,refresh]);
 return <div className="property-messages">{error&&<div className="contact-alert" role="alert"><span>{error}</span><button type="button" onClick={()=>{setLoaded(false);setRefresh(v=>v+1);}}>Retry</button></div>}{!dealId&&!loaded&&!contactsError&&<p role="status">Loading saved numbers…</p>}{busy&&<p role="status">Opening conversation…</p>}{dealId&&<DealMessages onRecipientChange={onRecipientChange} apiBase={apiBase} markRead={markRead} draftRequest={draftRequest} key={dealId} dealId={dealId} initialThreadId={threadId} active={active} onTakeover={onTakeover} contactNames={Object.fromEntries(contacts.map(c=>[c.phone,c.name]))}/>}{contactsError&&<button type="button" className="contact-recovery" onClick={()=>{setContactsError(false);setLoaded(false);setRefresh(v=>v+1);}}>Reload saved contacts</button>}{loaded&&!contactsError&&(!dealId||contacts.length>1)&&<details open={!dealId} className="text-contact-picker"><summary>{dealId?'Other saved contacts':'Choose a contact'}</summary>{contacts.length?contacts.map(c=><div className="seller-contact-card" key={c.phone}><div className="seller-contact-identity"><span className="seller-contact-avatar">{(c.name||'S').slice(0,1).toUpperCase()}</span><div><strong>{c.name||'Saved contact'}</strong><span><PrivatePhone>{displayContactPhone(c.phone)}</PrivatePhone></span></div></div>{c.blocked?<small>Do not contact</small>:c.phone_type==='landline'?<small>Landline · use Call</small>:<button className="contact-primary" data-credit-action type="button" disabled={busy} onClick={()=>void open(c)}><MessageCircle size={16}/>Open text conversation</button>}</div>):<p>No phone number has been saved for this property yet.</p>}</details>}</div>;
}
