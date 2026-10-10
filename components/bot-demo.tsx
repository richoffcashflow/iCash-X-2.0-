'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowLeft,ArrowUpRight,Check,House,Phone,Sparkles} from 'lucide-react';
import {SellerAddressInput} from '@/components/seller-address-input';
import {botDemoConsentText,botDemoConsentVersion} from '@/lib/bot-demo';
import {sellerSubmissionStatus,type SellerSubmissionStatus} from '@/lib/seller-submission-status';

export function BotDemo(){
 const [step,setStep]=useState<'address'|'contact'|'saved'>('address');
 const [address,setAddress]=useState(''),[name,setName]=useState(''),[phone,setPhone]=useState(''),[trap,setTrap]=useState('');
 const [consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [access,setAccess]=useState<'loading'|'ready'|'signin'|'error'>('loading');
 const [progress,setProgress]=useState<SellerSubmissionStatus|null>(null),[round,setRound]=useState(0),[polling,setPolling]=useState(false);
 const request=useRef(''),lock=useRef(false),nameInput=useRef<HTMLInputElement>(null),success=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{const c=new AbortController();void fetch('/api/demo/intake',{cache:'no-store',signal:c.signal}).then(async r=>{if(!r.ok)throw Error();const d=await r.json();setAccess(d.ready?'ready':'signin');}).catch(()=>{if(!c.signal.aborted)setAccess('error');});return()=>c.abort();},[]);
 useEffect(()=>{
  if(step!=='saved'||!request.current)return;
  const controller=new AbortController();let attempts=0,timer:ReturnType<typeof setTimeout>|undefined;setPolling(true);
  async function poll(){
   attempts++;
   try{const r=await fetch('/api/seller/status?request='+encodeURIComponent(request.current),{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)])});
    if(r.ok){const d=await r.json() as SellerSubmissionStatus;if(controller.signal.aborted)return;setProgress(d);if(d.terminal){setPolling(false);return;}}
   }catch{/* Keep the saved receipt even if progress is unavailable. */}
   if(controller.signal.aborted)return;if(attempts<30)timer=setTimeout(poll,2000);else setPolling(false);
  }
  void poll();return()=>{controller.abort();clearTimeout(timer);};
 },[step,round]);
 function changed(){request.current='';setError('');}
 async function submit(e:FormEvent){
  e.preventDefault();if(lock.current||!consent||access!=='ready')return;
  lock.current=true;setBusy(true);setError('');request.current||=crypto.randomUUID();
  try{const r=await fetch('/api/demo/intake',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:request.current,name,address,phone,consented:consent,consentVersion:botDemoConsentVersion,contactTimezone:Intl.DateTimeFormat().resolvedOptions().timeZone,honeypot:trap}),signal:AbortSignal.timeout(20000)});
   const d=await r.json();if(!r.ok)throw Error(d.error||'Please try again.');setProgress(sellerSubmissionStatus('received'));setStep('saved');requestAnimationFrame(()=>success.current?.focus());
  }catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{lock.current=false;setBusy(false);}
 }
 return <main className="bot-demo">
  <header className="demo-header"><a href="/test-bot" className="demo-brand" aria-label="iCash X home">iCash <span>X</span></a><a href="/" className="demo-workspace">Open workspace <ArrowUpRight size={16}/></a></header>
  <section className="demo-main" aria-label="iCash X property demo">
   <div className="demo-eyebrow"><Sparkles size={15}/> YOUR BOT. IN ACTION.</div>
   {step==='saved'?<div className="demo-success">
    <span className="demo-success-mark"><Check size={26}/></span><div role="status" aria-live="polite"><h1 ref={success} tabIndex={-1}>{progress?.title??'Your property is in.'}</h1><p className="demo-intro">{progress?.message??'Your request is saved.'}</p></div>
    <div className="demo-property"><House size={20}/><span>{address}</span></div>
    <a className="demo-submit" href="/">Watch in your workspace <ArrowUpRight size={18}/></a>
    {progress?.phase==='address_review'?<button className="demo-secondary" onClick={()=>{setStep('address');setProgress(null);changed();}}>Update address</button>:!polling&&!progress?.terminal?<button className="demo-secondary" onClick={()=>setRound(v=>v+1)}>Check progress</button>:null}
   </div>:<>
    <h1>{step==='address'?<>One property.<br/><span>See what your bot can do.</span></>:<>Let’s start<br/><span>the conversation.</span></>}</h1>
    <p className="demo-intro">{step==='address'?'Enter a property, add your number, and follow the activity in your iCash X workspace.':'Add the name and number you want to use for this property.'}</p>
    <div className="demo-card">
     {step==='address'?<form onSubmit={e=>{e.preventDefault();if(address.trim().length<8)return;setStep('contact');requestAnimationFrame(()=>nameInput.current?.focus());}}>
      <label className="demo-label" htmlFor="seller-address">Property address</label><SellerAddressInput value={address} onChange={v=>{setAddress(v);changed();}}/>
      <button className="demo-submit" type="submit">Continue <ArrowUpRight size={18}/></button>
     </form>:<form onSubmit={submit}>
      <button type="button" className="demo-back" disabled={busy} onClick={()=>{setStep('address');setError('');}}><ArrowLeft size={15}/><span>{address}</span><u>Edit</u></button>
      <label className="demo-label" htmlFor="demo-name">Your name</label><input ref={nameInput} id="demo-name" autoComplete="name" required maxLength={100} value={name} disabled={busy} onChange={e=>{setName(e.target.value);changed();}} placeholder="First and last name"/>
      <label className="demo-label" htmlFor="demo-phone">Phone number</label><input id="demo-phone" type="tel" inputMode="tel" autoComplete="tel" required maxLength={30} value={phone} disabled={busy} onChange={e=>{setPhone(e.target.value);changed();}} placeholder="(214) 555-0123"/>
      <div className="demo-trap" aria-hidden="true"><label>Leave empty<input tabIndex={-1} autoComplete="off" value={trap} onChange={e=>setTrap(e.target.value)}/></label></div>
      <label className="demo-consent"><input type="checkbox" checked={consent} required disabled={busy} onChange={e=>{setConsent(e.target.checked);changed();}}/><span>{botDemoConsentText}</span></label>
      {access==='signin'?<p className="demo-notice"><a href="/">Sign in to your iCash X account</a> in this browser, then refresh this page to start.</p>:access==='error'?<p className="demo-notice">Couldn’t check your account. Refresh this page to retry.</p>:null}
      <button className="demo-submit" disabled={busy||!consent||access!=='ready'}>{busy?'Saving your property…':access==='loading'?'Checking your account…':'Start my bot demo'}<ArrowUpRight size={18}/></button>
      <p className="demo-credit-note">Runs in your workspace using your existing credits.</p>
      {error&&<p className="demo-notice" role="alert">{error}</p>}
     </form>}
    </div>
    <div className="demo-steps"><span><House size={16}/> Add a property</span><span><Phone size={16}/> Start a conversation</span><span><Check size={16}/> Follow your bot</span></div>
   </>}
  </section>
  <footer className="demo-footer"><span>Powered by iCash X</span><a href="/test-bot/privacy">Privacy & contact choices</a></footer>
 </main>;
}
