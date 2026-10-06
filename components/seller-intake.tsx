'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Check,MapPin,Phone,ShieldCheck,House,ArrowLeft,X,BadgeDollarSign} from 'lucide-react';
import {SellerAddressInput} from '@/components/seller-address-input';
import {sellerBrand,sellerConsentVersion,sellerConsentText,sellerSharingText} from '@/lib/seller-leads';
import {sellerOptinCopy,sellerOptinSource,sellerOptinCampaign} from '@/lib/seller-optin';

export function SellerIntake(){
 const [step,setStep]=useState<'address'|'contact'>('address');
 const [variant,setVariant]=useState('fast_cash');
 const [name,setName]=useState(''),[address,setAddress]=useState(''),[phone,setPhone]=useState('');
 const [consented,setConsented]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false),[trap,setTrap]=useState('');
 const nameInput=useRef<HTMLInputElement>(null),success=useRef<HTMLHeadingElement>(null),info=useRef<HTMLDialogElement>(null);
 const request=useRef(''),lock=useRef(false),interacted=useRef(false),measured=useRef(false),started=useRef(false);
 const copy=sellerOptinCopy(variant);
 const sent=useRef(new Set<string>());
 const eventQueue=useRef(Promise.resolve());
 function track(event:'view'|'start'|'contact'){
  if(!measured.current||sent.current.has(event))return;
  sent.current.add(event);
  eventQueue.current=eventQueue.current.then(async()=>{await fetch('/api/seller/experiment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event}),keepalive:true,signal:AbortSignal.timeout(2500)});}).catch(()=>{});
 }
 useEffect(()=>{
  let active=true;
  const q=new URLSearchParams(window.location.search);
  void fetch('/api/seller/experiment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:'open',source:sellerOptinSource(q.get('utm_source')),campaign:sellerOptinCampaign(q.get('campaign')||q.get('utm_campaign'))})})
   .then(r=>r.ok?r.json():null).then(data=>{
    // Never change the offer once a visitor has begun. Unseen variants do not count.
    if(!active||interacted.current||!data?.measured)return;
    measured.current=true;setVariant(sellerOptinCopy(data.variant).id);
    requestAnimationFrame(()=>{if(active)track('view');});
   }).catch(()=>{});
  return()=>{active=false;};
 },[]);
 function begin(){interacted.current=true;if(!started.current){started.current=true;track('start');}}
 async function submit(e:FormEvent){
  e.preventDefault();if(!consented){setError('Please check the contact agreement to continue.');return;}if(lock.current)return;
  lock.current=true;setBusy(true);setError('');if(!request.current)request.current=crypto.randomUUID();
  try{
   const q=new URLSearchParams(window.location.search),source=sellerOptinSource(q.get('utm_source'));
   const campaign=sellerOptinCampaign(q.get('campaign')||q.get('utm_campaign')),clickId=(q.get('fbclid')||q.get('gclid')||q.get('ttclid')||'').replace(/[^a-zA-Z0-9_.:-]/g,'').slice(0,300);
   await Promise.race([eventQueue.current,new Promise(resolve=>setTimeout(resolve,800))]);
   const r=await fetch('/api/seller/intake',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,address,phone,consented,consentVersion:sellerConsentVersion,contactTimezone:Intl.DateTimeFormat().resolvedOptions().timeZone,requestId:request.current,campaign,source,clickId,honeypot:trap})});
   const d=await r.json();if(!r.ok)throw Error(d.error||'Please retry.');setDone(true);requestAnimationFrame(()=>success.current?.focus());
  }catch(e){setError(e instanceof Error?e.message:'Please retry.');}finally{lock.current=false;setBusy(false);}
 }
 return <main className={`seller-shell seller-step-${done?'done':step}`}>
  <header className="seller-header">
   <a className="seller-wordmark" href="/sell" aria-label={sellerBrand+' home'}><span className="seller-brand-mark"><House size={25} aria-hidden="true"/></span><span>HomeOffer<span className="seller-network">NETWORK</span></span></a>
   <button className="seller-help" onClick={()=>info.current?.showModal()}>How it works</button>
  </header>
  <section className="seller-hero" aria-label="Request a cash offer">
   <div className="seller-story">
    {done?<div className="seller-success" role="status"><span className="seller-success-icon"><Check size={28}/></span><h1 ref={success} tabIndex={-1}>You’re on your way.</h1><p>Your request is saved. We’ll review your property and match it with available buyers.</p><div className="seller-next"><Phone size={21}/><span><strong>Keep your phone nearby.</strong><br/>Matched buyers may call or text you. You decide whether to accept any offer.</span></div><a href="/sell/privacy">Your information & contact choices</a></div>:<>
     <div className="seller-heading">
      {step==='address'?<><h1><em>{copy.accent}</em><span>{copy.headline}</span></h1><p className="seller-intro">{copy.description}</p></>:<><span className="seller-kicker">ONE LAST STEP</span><h1>Where can buyers<br/><em>reach you?</em></h1><p className="seller-intro">Your request is free. You’re in control.</p></>}
     </div>
     <div className="seller-card">
      {step==='address'?<form className="seller-address-form" onSubmit={e=>{e.preventDefault();if(address.trim().length<8)return;begin();track('contact');setError('');setStep('contact');requestAnimationFrame(()=>nameInput.current?.focus({preventScroll:true}));}}>
       <label className="seller-sr-only" htmlFor="seller-address">Your property address</label>
       <SellerAddressInput value={address} onChange={value=>{begin();setAddress(value);request.current='';}}/>
       <button className="seller-submit" type="submit">{copy.cta}</button>
       <p className="seller-form-note"><ShieldCheck size={14} aria-hidden="true"/>Free request. No obligation to sell.</p>
      </form>:<>
       <button className="seller-back" onClick={()=>{setStep('address');setError('');requestAnimationFrame(()=>document.getElementById('seller-address')?.focus({preventScroll:true}));}} disabled={busy}><ArrowLeft size={14} aria-hidden="true"/><span>{address}</span><u>Edit</u></button>
       <form onSubmit={submit}>
        <div className="seller-contact-field"><label htmlFor="seller-name">Your name</label><input ref={nameInput} id="seller-name" name="name" autoComplete="name" required maxLength={100} value={name} onChange={e=>{setName(e.target.value);request.current='';}} placeholder="First and last name" disabled={busy}/></div>
        <div className="seller-contact-field"><label htmlFor="seller-phone">Phone number</label><input id="seller-phone" name="tel" type="tel" autoComplete="tel" inputMode="tel" required maxLength={30} value={phone} onChange={e=>{setPhone(e.target.value);request.current='';}} placeholder="(555) 123-4567" disabled={busy}/></div>
        <div className="seller-trap" aria-hidden="true"><label>Leave this empty<input tabIndex={-1} autoComplete="off" value={trap} onChange={e=>setTrap(e.target.value)}/></label></div>
        <label className="seller-choice seller-ai-consent"><input type="checkbox" required checked={consented} onChange={e=>{setConsented(e.target.checked);request.current='';}} disabled={busy}/><span>{sellerConsentText}</span></label>
        <button className="seller-submit" disabled={busy||!consented}>{busy?'Saving your request…':'Get My Cash Offer'}</button>
        {error&&<p role="alert" className="seller-error">{error}</p>}
        <p className="seller-privacy-note">By submitting, you acknowledge our <a href="/sell/privacy">Privacy & sharing notice</a>.</p>
       </form>
      </>}
     </div>
     {step==='address'&&<div className="seller-benefits"><div><span><BadgeDollarSign size={20} aria-hidden="true"/></span><p><strong>Free request</strong><small>No payment needed</small></p></div><div><span><ShieldCheck size={20} aria-hidden="true"/></span><p><strong>No obligation</strong><small>You’re in control</small></p></div><div><span><House size={20} aria-hidden="true"/></span><p><strong>Sell as-is</strong><small>Skip the repairs</small></p></div></div>}
    </>}
   </div>
   <div className="seller-visual" aria-hidden="true"><img src="/homeoffer-neighborhood.webp" width={1536} height={1024} alt="" fetchPriority="high"/><span>YOUR HOME. YOUR NEXT MOVE.</span></div>
  </section>
  <footer className="seller-footer"><p>{sellerSharingText} <a href="/sell/privacy">Privacy</a></p></footer>
  <dialog ref={info} className="seller-explainer" aria-labelledby="seller-how-title" onClick={e=>{if(e.target===e.currentTarget)info.current?.close();}}><button className="seller-dialog-close" aria-label="Close how it works" onClick={()=>info.current?.close()}><X size={21}/></button><h2 id="seller-how-title">From your address<br/>to your next move.</h2><ol><li><MapPin size={22}/><div><strong>Tell us about your home</strong><p>Start with your address and the best number to reach you.</p></div></li><li><House size={22}/><div><strong>Connect with cash buyers</strong><p>We review your request and share it with matched, independent buyers.</p></div></li><li><Check size={22}/><div><strong>Decide on your terms</strong><p>Discuss any offers. Only accept what works for you.</p></div></li></ol><p className="seller-disclosure">{sellerSharingText}</p><button className="seller-submit" onClick={()=>info.current?.close()}>Get started</button></dialog>
 </main>;
}
