'use client';
import {useEffect,useState,useRef} from 'react';
import {Phone,Copy} from 'lucide-react';
type Data={businessNumber?:string|null;personalCalls?:{id:string;state:string;callback_phone:string;ended_at:string|null}[];attempts?:{id:string;createdAt:string;status:string;costPending:boolean}[];contacts:{phone:string;name?:string;available:boolean;reason:string}[];reason?:string};
export function displayContactPhone(phone:string){return phone.replace(/^\+1(\d{3})(\d{3})(\d{4})$/,'($1) $2-$3');}
export function ManualCallOptions({screeningId,onTakeover}:{screeningId:string;onTakeover?:()=>void}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[refresh,setRefresh]=useState(0),[checked,setChecked]=useState(0),[busy,setBusy]=useState(false);
 const lock=useRef(false),requestKey=useRef<string|null>(null);
 const [callbackPhone,setCallbackPhone]=useState(''),[callId,setCallId]=useState(''),[callStatus,setCallStatus]=useState('');
 useEffect(()=>{if(!callId)return;let stopped=false;async function check(){try{const r=await fetch('/api/work/business-call?id='+callId,{cache:'no-store'});if(!r.ok)return;const d=await r.json();if(!stopped){setCallStatus(d.status);setNotice(d.status==='completed'?'Call completed.':d.status==='failed'?'Call ended without connecting.':d.status==='connecting'?'Connecting you to the seller…':d.status==='ringing'?'Answer your phone, then press 1 to connect.':'Checking the call. Do not start another call yet.');}}catch{}}void check();const timer=setInterval(check,10000);return()=>{stopped=true;clearInterval(timer);};},[callId]);
 async function call(phone:string){
  if(lock.current||callId&&!['completed','failed'].includes(callStatus))return;
  const digits=callbackPhone.replace(/\D/g,'');const callback=digits.length===10?'+1'+digits:'+'+digits;
  if(!/^\+1[2-9]\d{9}$/.test(callback)||callback===phone){setError('Enter your own phone number, different from the seller’s number.');return;}
  if(Date.now()-checked>30000){setRefresh(v=>v+1);setError('Refreshing this contact. Try again once it loads.');return;}
  lock.current=true;setBusy(true);setError('');setNotice('');
  try{
   const r=await fetch('/api/work/business-call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({screeningId,phone,callbackPhone:callback,requestKey:requestKey.current??(requestKey.current=crypto.randomUUID())})});const d=await r.json();
   if(!r.ok||!d.id)throw Error(d.error||'Could not start the call.');
   onTakeover?.();setCallId(d.id);setCallStatus(d.status);setNotice(d.status==='ringing'?'Answer your phone, then press 1 to connect.':'Checking the call. Do not start another call yet.');
  }catch(e){setError(e instanceof Error?e.message:'Could not start the call.');}finally{lock.current=false;setBusy(false);}
 }
 async function copy(phone:string){try{await navigator.clipboard.writeText(phone);setNotice('Number copied.');}catch{setNotice(`Copy this number: ${displayContactPhone(phone)}`);}}
 useEffect(()=>{
  const controller=new AbortController();setError('');
  void fetch(`/api/work/manual-call?screeningId=${encodeURIComponent(screeningId)}`,{cache:'no-store',signal:controller.signal}).then(async r=>{if(!r.ok)throw Error();const next=await r.json() as Data;if(!controller.signal.aborted){setData(next);setChecked(Date.now());const prior=next.personalCalls?.[0];if(prior){setCallbackPhone(value=>value||prior.callback_phone);if(!prior.ended_at){setCallId(prior.id);setCallStatus(prior.state);requestKey.current=prior.id;}}}}).catch(()=>{if(!controller.signal.aborted)setError('Could not load contacts.');});
  const timer=setInterval(()=>setRefresh(v=>v+1),30000);return()=>{controller.abort();clearInterval(timer);};
 },[screeningId,refresh]);
 return <section className="manual-call-options" aria-label="Call using your business number">
  <div className="contact-section-title"><span className="contact-section-icon"><Phone size={20}/></span><div><h5>Call the seller</h5><p>Talk to the seller from {data?.businessNumber?displayContactPhone(data.businessNumber):'your business number'}.</p></div></div>
  <p className="contact-help">Answer your phone and press 1 to connect. Calls use credits at 3× usage, last up to 10 minutes, and are not recorded.</p>
  <label className="message-search">Your phone number<input type="tel" autoComplete="tel" value={callbackPhone} onChange={e=>{setCallbackPhone(e.target.value);if(!callId)requestKey.current=null;}} placeholder="(214) 555-0123" disabled={busy||!!callId&&!(['completed','failed'].includes(callStatus))}/></label>
  {callId&&['completed','failed'].includes(callStatus)&&<button type="button" className="contact-secondary" onClick={()=>{setCallId('');setCallStatus('');requestKey.current=null;setRefresh(v=>v+1);}}>New call</button>}
  {!data&&!error&&<p className="contact-feedback" role="status">Loading saved numbers…</p>}
  {error&&<div className="contact-alert" role="alert"><span>{error}</span><button type="button" onClick={()=>setRefresh(v=>v+1)}>Retry</button></div>}
  {notice&&<p className="contact-feedback" role="status">{notice}</p>}
  {data&&!data.contacts.length&&<p className="contact-feedback">{data.reason??'No phone number available.'}</p>}
  {data?.contacts.filter(c=>c.available).map(c=><div className="seller-contact-card" key={c.phone}>
   <div className="seller-contact-identity"><span className="seller-contact-avatar">{(c.name||'S').slice(0,1).toUpperCase()}</span><div><strong>{c.name||'Saved contact'}</strong><span>{displayContactPhone(c.phone)}</span></div></div>
   <div className="seller-contact-actions"><button type="button" className="contact-primary" data-credit-action disabled={busy||!!callId||!callbackPhone.trim()} onClick={()=>void call(c.phone)}><Phone size={16}/>{busy?'Connecting…':'Call seller'}</button><button type="button" className="contact-secondary" onClick={()=>void copy(c.phone)}><Copy size={16}/>Copy number</button></div>
  </div>)}
  {data?.attempts?.map(a=><div className="contact-feedback" key={a.id}><strong>{a.status}</strong><p>{new Date(a.createdAt).toLocaleString('en-US',{hour12:true})}{a.costPending?' · Final call cost pending':''}</p></div>)}
  {!!data?.contacts.some(c=>!c.available)&&<details className="contact-unavailable" open={!data.contacts.some(c=>c.available)}><summary>Unavailable numbers</summary>{data.contacts.filter(c=>!c.available).map(c=><div className="seller-contact-card" key={c.phone}><strong>{c.name||'Saved contact'}</strong><span>{displayContactPhone(c.phone)}</span><p>{c.reason}</p></div>)}</details>}
 </section>;
}
