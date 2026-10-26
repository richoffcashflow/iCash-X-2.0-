'use client';
import './legacy-offer.css';
import {AccountAccess} from '@/components/account-access';
import {useEffect,useState} from 'react';
import {legacyTrialVersion,legacyTrialTerms} from '@/lib/legacy-trial-policy';
export default function LegacyOffer(){
 const [email,setEmail]=useState(''),[accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [recover,setRecover]=useState(false);
 const [purchase,setPurchase]=useState(''),[confirming,setConfirming]=useState(false);
 async function confirm(){
  const query=new URLSearchParams(window.location.search),session=query.get('session_id'),id=query.get('purchase');
  if(!session||!/^cs_(live|test)_[A-Za-z0-9]+$/.test(session)||!id||!/^[a-f0-9-]{36}$/i.test(id))return;
  setPurchase(id);setConfirming(true);setError('');
  try{const response=await fetch('/api/billing/membership?session_id='+encodeURIComponent(session),{cache:'no-store'}),data=await response.json();if(!response.ok)throw Error(data.error??'Please retry confirmation.');if(data.membership?.accessible){window.location.assign('/access?purchase='+id);return;}setError('Your checkout is being confirmed. Check again in a moment; do not start another subscription.');}catch(e){setError(e instanceof Error?e.message:'Please retry confirmation.');}finally{setConfirming(false);}
 }
 useEffect(()=>{void confirm();},[]);
 async function checkout(event:React.FormEvent){event.preventDefault();if(busy)return;setBusy(true);setError('');try{const r=await fetch('/api/billing/legacy-trial',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,accepted,version:legacyTrialVersion})});const data=await r.json();if(!r.ok||!data.url)throw Error(data.error??'Checkout could not open.');window.location.assign(data.url);}catch(e){setError(e instanceof Error?e.message:'Please retry.');setBusy(false);}}
 if(purchase)return <main className="returning-offer returning-confirm"><a className="returning-brand" href="/legacy-offer"><img src="/favicon.svg?v=chrome-x" alt="" width={40} height={40}/><span>iCash X <span>2.0</span></span></a><section className="returning-card"><p className="returning-eyebrow">WELCOME BACK</p><h1>Opening your software access</h1><p role="status">{confirming?'Confirming your free introductory period…':error}</p><button className="returning-primary" disabled={confirming} onClick={()=>void confirm()}>Check again</button><p><a href={'/access?purchase='+purchase}>Sign in with your checkout email</a></p><a href="/support">Get help</a></section></main>;
 return <div className="returning-offer">
  <header className="returning-header"><a className="returning-brand" href="/legacy-offer"><img src="/favicon.svg?v=chrome-x" alt="" width={40} height={40}/><span>iCash X <span>2.0</span></span></a><a className="returning-help" href="/support">Need help?</a></header>
  <main className="returning-grid">
   <section className="returning-intro" aria-labelledby="returning-title">
    <p className="returning-eyebrow">FOR RETURNING ICASH X CUSTOMERS</p>
    <h1 id="returning-title">Two months to experience <span>iCash X 2.0.</span></h1>
    <p className="returning-lead">Welcome back. Get two calendar months of software access free and see what’s new in 2.0.</p>
    <ul className="returning-features"><li><span>01</span><div><strong>Research properties</strong><p>Explore opportunities and organize your leads.</p></div></li><li><span>02</span><div><strong>Manage your outreach</strong><p>Seller calls, texts, and follow-up in one workspace.</p></div></li><li><span>03</span><div><strong>Keep your deals moving</strong><p>Bring your pipeline and deal tools together.</p></div></li></ul>
    <p className="returning-note">A fresh start in 2.0. Your previous account data does not transfer.</p>
   </section>
   <section className="returning-card" aria-labelledby="returning-price">
    <p className="returning-eyebrow">YOUR WELCOME-BACK OFFER</p>
    <h2 id="returning-price">$0 now. Then $50/month.</h2>
    <p className="returning-card-intro">Two calendar months of software access.</p>
    <div className="returning-schedule"><div><span>First two months</span><strong>$0</strong></div><div><span>After your free period</span><strong>$50 <small>/ month</small></strong></div></div>
    <p className="returning-billing">Stripe shows your exact first charge date before you confirm. Payment method required; cancel before that date to avoid the charge.</p>
    <form onSubmit={checkout}>
     <label className="returning-email">Original purchase email<input type="email" autoComplete="email" placeholder="you@example.com" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
     <details className="returning-terms"><summary>Offer and billing terms</summary><p>{legacyTrialTerms}</p></details>
     <label className="returning-consent"><input type="checkbox" required checked={accepted} onChange={e=>setAccepted(e.target.checked)}/><span>I agree to the offer and billing terms above, including $50/month after my two free months unless I cancel.</span></label>
     <button className="returning-primary" disabled={busy||!accepted}>{busy?'Opening secure checkout…':'Continue to secure checkout'}</button>
     <p className="returning-secure">Checkout securely with Stripe</p>
     {error&&<p className="returning-alert" role="alert">{error}</p>}
    </form>
    <div className="returning-recovery"><button type="button" onClick={()=>setRecover(!recover)}>{recover?'Close email verification':'Resume a checkout from another device'}</button>{recover&&<section><AccountAccess trialRecovery initialEmail={email} onSignedIn={()=>{setRecover(false);setError('Email verified. Continue to secure checkout above to resume your offer.');}}/></section>}</div>
   </section>
  </main>
  <footer className="returning-footer"><span>Already completed checkout? <a href="/access">Restore access</a></span><a href="/support">Get help</a></footer>
 </div>;
}
