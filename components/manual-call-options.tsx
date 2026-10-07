'use client';
import {useEffect,useState,useRef} from 'react';
import {Phone,Copy,ExternalLink} from 'lucide-react';
type Data={contacts:{phone:string;name?:string;available:boolean;reason:string}[];reason?:string};
export function displayContactPhone(phone:string){return phone.replace(/^\+1(\d{3})(\d{3})(\d{4})$/,'($1) $2-$3');}
export function ManualCallOptions({screeningId,onTakeover}:{screeningId:string;onTakeover?:()=>void}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[refresh,setRefresh]=useState(0),[checked,setChecked]=useState(0),[busy,setBusy]=useState(false);
 const lock=useRef(false);
 async function call(phone:string){
  if(lock.current)return;
  if(Date.now()-checked>30000){setRefresh(v=>v+1);setError('Refreshing this contact. Try again once it loads.');return;}
  lock.current=true;setBusy(true);setError('');setNotice('');
  try{
   const r=await fetch('/api/work/manual-call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({screeningId,phone})});const d=await r.json();
   if(!r.ok||d.manual!==true||d.dialUrl!==`tel:${phone}`)throw Error(d.error||'Could not start the call.');
   onTakeover?.();setNotice('Phone app requested. If it does not open, copy the number and dial from your phone.');window.location.assign(d.dialUrl);
  }catch(e){setError(e instanceof Error?e.message:'Could not start the call.');}finally{lock.current=false;setBusy(false);}
 }
 async function copy(phone:string){try{await navigator.clipboard.writeText(phone);setNotice('Number copied.');}catch{setNotice(`Copy this number: ${displayContactPhone(phone)}`);}}
 useEffect(()=>{
  const controller=new AbortController();setError('');
  void fetch(`/api/work/manual-call?screeningId=${encodeURIComponent(screeningId)}`,{cache:'no-store',signal:controller.signal}).then(async r=>{if(!r.ok)throw Error();const next=await r.json() as Data;if(!controller.signal.aborted){setData(next);setChecked(Date.now());}}).catch(()=>{if(!controller.signal.aborted)setError('Could not load contacts.');});
  const timer=setInterval(()=>setRefresh(v=>v+1),30000);return()=>{controller.abort();clearInterval(timer);};
 },[screeningId,refresh]);
 return <section className="manual-call-options" aria-label="Call from your phone">
  <div className="contact-section-title"><span className="contact-section-icon"><Phone size={20}/></span><div><h5>Call the seller</h5><p>Use your phone app to call this saved contact.</p></div></div>
  <p className="contact-help">Opening your phone app pauses the bot on this lead. Your device may ask you to sign in to its calling app.</p>
  {!data&&!error&&<p className="contact-feedback" role="status">Loading saved numbers…</p>}
  {error&&<div className="contact-alert" role="alert"><span>{error}</span><button type="button" onClick={()=>setRefresh(v=>v+1)}>Retry</button></div>}
  {notice&&<p className="contact-feedback" role="status">{notice}</p>}
  {data&&!data.contacts.length&&<p className="contact-feedback">{data.reason??'No phone number available.'}</p>}
  {data?.contacts.filter(c=>c.available).map(c=><div className="seller-contact-card" key={c.phone}>
   <div className="seller-contact-identity"><span className="seller-contact-avatar">{(c.name||'S').slice(0,1).toUpperCase()}</span><div><strong>{c.name||'Saved contact'}</strong><span>{displayContactPhone(c.phone)}</span></div></div>
   <div className="seller-contact-actions"><button type="button" className="contact-primary" disabled={busy} onClick={()=>void call(c.phone)}><ExternalLink size={16}/>{busy?'Opening…':'Open phone app'}</button><button type="button" className="contact-secondary" onClick={()=>void copy(c.phone)}><Copy size={16}/>Copy number</button></div>
  </div>)}
  {!!data?.contacts.some(c=>!c.available)&&<details className="contact-unavailable"><summary>Unavailable numbers</summary>{data.contacts.filter(c=>!c.available).map(c=><div className="seller-contact-card" key={c.phone}><strong>{c.name||'Saved contact'}</strong><span>{displayContactPhone(c.phone)}</span><p>{c.reason}</p></div>)}</details>}
 </section>;
}
