'use client';
import {PrivatePhone} from '@/components/owner-phone-privacy';
import {useEffect,useState} from 'react';
import {BrowserCallControls} from '@/components/browser-call-controls';
import {Phone} from 'lucide-react';
type Data={personalCalls?:{id:string;state:string;connection_type?:string;ended_at:string|null;audioAvailable?:boolean}[];attempts?:{id:string;createdAt:string;status:string;costPending:boolean}[];contacts:{phone:string;name?:string;available:boolean;businessNumber:string|null;reason:string}[];reason?:string};
export function displayContactPhone(phone:string){return phone.replace(/^\+1(\d{3})(\d{3})(\d{4})$/,'($1) $2-$3');}
export function ManualCallOptions({apiBase='/api/work',screeningId,onTakeover,autoStart=false,onAutoStartHandled,preferredPhone='',compact=false}:{apiBase?:string;screeningId:string;onTakeover?:()=>void;autoStart?:boolean;onAutoStartHandled?:()=>void;preferredPhone?:string;compact?:boolean}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[setupRetry,setSetupRetry]=useState(0);
 const [browserReady,setBrowserReady]=useState<boolean|null>(null);
 useEffect(()=>{
  const controller=new AbortController();
  void fetch(`${apiBase}/browser-call`,{cache:'no-store',signal:controller.signal}).then(async r=>{if(!r.ok)throw Error();const d=await r.json();if(!controller.signal.aborted)setBrowserReady(d.ready===true);}).catch(()=>{if(!controller.signal.aborted)setBrowserReady(false);});
  return()=>controller.abort();
 },[apiBase,setupRetry]);
 useEffect(()=>{
  const controller=new AbortController();
  void fetch(`${apiBase}/manual-call?screeningId=${encodeURIComponent(screeningId)}`,{cache:'no-store',signal:controller.signal}).then(async r=>{if(!r.ok)throw Error();const next=await r.json() as Data;if(!controller.signal.aborted){setData(next);setError('');}}).catch(()=>{if(!controller.signal.aborted)setError('Could not load contacts.');});
  const timer=setInterval(()=>{if(!document.hidden)setRefresh(v=>v+1);},30000);return()=>{controller.abort();clearInterval(timer);};
 },[apiBase,screeningId,refresh]);
 // A failed initial click must never turn into an unexpected call after a refresh.
 useEffect(()=>{if(autoStart&&(error||browserReady===false))onAutoStartHandled?.();},[autoStart,error,browserReady,onAutoStartHandled]);
 const contacts=data?(preferredPhone?data.contacts.filter(c=>c.phone===preferredPhone):data.contacts):[];
 return <section className={`manual-call-options${compact?' compact-call-options':''}`} aria-label="Call using your business number">
  {!compact&&<div className="contact-section-title"><span className="contact-section-icon"><Phone size={20}/></span><div><h5>Call the seller</h5><p>From your business number</p></div></div>}
  {(!data&&!error||browserReady===null)&&<p className="contact-feedback" role="status">Getting your call ready…</p>}
  {error&&<div className="contact-alert" role="alert"><span>{error}</span><button type="button" onClick={()=>setRefresh(v=>v+1)}>Retry</button></div>}
  {browserReady===false&&<div className="contact-alert" role="alert"><span>Calling is temporarily unavailable.</span><button type="button" onClick={()=>{setBrowserReady(null);setSetupRetry(v=>v+1);}}>Retry</button></div>}
  {browserReady&&data&&<BrowserCallControls apiBase={apiBase} screeningId={screeningId} contacts={contacts} activeCall={data.personalCalls?.[0]} autoStart={autoStart&&!error} onAutoStartHandled={onAutoStartHandled} onStarted={onTakeover} onFinished={()=>setRefresh(v=>v+1)}/>}
  {data&&!contacts.length&&<p className="contact-feedback">{preferredPhone?'Calling is unavailable for this conversation’s number.':data.reason??'No phone number available.'}</p>}
  {!compact&&data?.personalCalls?.filter(c=>c.audioAvailable).map(c=><div className="contact-feedback" key={c.id}><strong>Listen to your call</strong><audio controls preload="none" aria-label="Play seller call" style={{width:'100%'}} src={apiBase+'/business-call?id='+c.id+'&audio=1'}/></div>)}
  {!compact&&data?.attempts?.map(a=><div className="contact-feedback" key={a.id}><strong>{a.status}</strong><p>{new Date(a.createdAt).toLocaleString('en-US',{hour12:true})}{a.costPending?' · Final call cost pending':''}</p></div>)}
  {!!contacts.some(c=>!c.available)&&<details className="contact-unavailable" open={!contacts.some(c=>c.available)}><summary>Unavailable numbers</summary>{contacts.filter(c=>!c.available).map(c=><div className="seller-contact-card" key={c.phone}><strong>{c.name||'Saved contact'}</strong><span><PrivatePhone>{displayContactPhone(c.phone)}</PrivatePhone></span><p>{c.reason}</p></div>)}</details>}
 </section>;
}
