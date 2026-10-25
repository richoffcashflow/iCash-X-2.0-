'use client';
import {useEffect,useState} from 'react';
import {legacyTrialVersion,legacyTrialTerms} from '@/lib/legacy-trial-policy';
export default function LegacyOffer(){
 const [email,setEmail]=useState(''),[accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [purchase,setPurchase]=useState(''),[confirming,setConfirming]=useState(false);
 async function confirm(){
  const query=new URLSearchParams(window.location.search),session=query.get('session_id'),id=query.get('purchase');
  if(!session||!/^cs_(live|test)_[A-Za-z0-9]+$/.test(session)||!id||!/^[a-f0-9-]{36}$/i.test(id))return;
  setPurchase(id);setConfirming(true);setError('');
  try{const response=await fetch('/api/billing/membership?session_id='+encodeURIComponent(session),{cache:'no-store'}),data=await response.json();if(!response.ok)throw Error(data.error??'Please retry confirmation.');if(data.membership?.accessible){window.location.assign('/access?purchase='+id);return;}setError('Your checkout is being confirmed. Check again in a moment; do not start another subscription.');}catch(e){setError(e instanceof Error?e.message:'Please retry confirmation.');}finally{setConfirming(false);}
 }
 useEffect(()=>{void confirm();},[]);
 async function checkout(event:React.FormEvent){event.preventDefault();if(busy)return;setBusy(true);setError('');try{const r=await fetch('/api/billing/legacy-trial',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,accepted,version:legacyTrialVersion})});const data=await r.json();if(!r.ok||!data.url)throw Error(data.error??'Checkout could not open.');window.location.assign(data.url);}catch(e){setError(e instanceof Error?e.message:'Please retry.');setBusy(false);}}
 if(purchase)return <main style={{maxWidth:620,margin:'8vh auto',padding:24}}><h1>Opening your software access</h1><p>{confirming?'Confirming your free introductory period…':error}</p><button disabled={confirming} onClick={()=>void confirm()}>Check again</button><p><a href={'/access?purchase='+purchase}>Sign in with your checkout email</a></p><a href="/support">Get help</a></main>;
 return <main style={{maxWidth:620,margin:'8vh auto',padding:24,color:'#111',background:'#fff'}}><a href="/">iCash X</a><p>FOR RETURNING ICASH X CUSTOMERS</p><h1>Two months to experience iCash X 2.0.</h1><h2>$0 now. Then $50/month.</h2><p>Two calendar months of software access. Stripe shows your exact first charge date before you confirm. Payment method required; cancel before that date to avoid the charge.</p><p>Work credits for paid AI activity are separate.</p><form onSubmit={checkout}><label>Original purchase email<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} style={{display:'block',width:'100%',padding:12,margin:'8px 0 20px'}}/></label><label style={{display:'flex',gap:12}}><input type="checkbox" required checked={accepted} onChange={e=>setAccepted(e.target.checked)}/><span>{legacyTrialTerms}</span></label><button disabled={busy||!accepted} style={{padding:'14px 24px',marginTop:24,background:'#111',color:'#fff',border:0}}>{busy?'Opening secure checkout…':'Continue to secure checkout'}</button>{error&&<p role="alert">{error}</p>}</form><p><a href="/access">Already completed checkout? Restore access</a> · <a href="/support">Get help</a></p></main>;
}
