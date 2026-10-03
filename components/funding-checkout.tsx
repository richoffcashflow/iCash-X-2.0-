'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,ShieldCheck} from 'lucide-react';
import {AccountAccess} from './account-access';
import {earlyAccessTermsVersion,earlyAccessDisclosure} from '@/lib/funding-consent';
import {workCreditTerms,workCreditTermsVersion,priceLabel} from '@/lib/membership-policy';
type Pack={code:string;price_cents:number;credit_cents:number;enabled:boolean};
type Funding={earlyAccess?:boolean;mode:'test'|'live'|null;enabled:boolean;packs?:Pack[];paidCents?:number;needsClaim?:boolean;email?:string};
export function FundingCheckout({onSignedIn,initialCode}:{onSignedIn:()=>void;initialCode?:string}){
 const [status,setStatus]=useState<Funding|null>(null),[code,setCode]=useState(initialCode??'budget_ten'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[paymentReturn,setPaymentReturn]=useState(false);
 const inFlight=useRef(false),polling=useRef(false),notified=useRef(false),alive=useRef(true);
 async function refresh(){if(polling.current)return;polling.current=true;try{const sessionId=new URLSearchParams(window.location.search).get('session_id');const r=await fetch('/api/funding/status'+(sessionId?'?session_id='+encodeURIComponent(sessionId):''),{cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error);if(alive.current){setStatus(d);setError('');}}catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not check credits. Please retry.');}finally{polling.current=false;}}
 useEffect(()=>{alive.current=true;setPaymentReturn(new URLSearchParams(window.location.search).get('payment')==='funded');void refresh();return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(!paymentReturn||status?.paidCents||status?.needsClaim)return;let tries=0;const timer=setInterval(()=>{if(!document.hidden&&++tries<=12)void refresh();},5000);return()=>clearInterval(timer);},[paymentReturn,status?.paidCents,status?.needsClaim]);
 useEffect(()=>{if(paymentReturn&&status?.paidCents&&!status.needsClaim&&!notified.current){notified.current=true;const url=new URL(window.location.href);url.searchParams.delete('payment');url.searchParams.delete('session_id');window.history.replaceState(null,'',url.pathname+url.search+url.hash);onSignedIn();}},[paymentReturn,status?.paidCents,status?.needsClaim,onSignedIn]);
 const packs=(status?.packs??[]).filter(p=>p.price_cents>=1000&&p.price_cents<=100000&&(status?.mode!=='live'||p.enabled)),selected=packs.find(p=>p.code===code);
 async function checkout(){if(inFlight.current||!selected||!status?.enabled)return;inFlight.current=true;setBusy(true);setError('');try{const r=await fetch('/api/funding/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accepted:true,version:workCreditTermsVersion,earlyAccessAccepted:status.earlyAccess===true,earlyAccessVersion:earlyAccessTermsVersion,packCode:selected.code,days:1,totalCents:selected.price_cents})});const d=await r.json();if(!alive.current)return;if(!r.ok)throw Error(d.error);const url=new URL(d.url);if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com')throw Error('Could not open secure checkout.');window.location.assign(url.href);}catch(e){setError(e instanceof Error?e.message:'Could not open checkout.');}finally{inFlight.current=false;if(alive.current)setBusy(false);}}
 if(paymentReturn&&status&&!status.paidCents&&!status.needsClaim)return <div role="status"><h3>Confirming your credits</h3><p>Your balance updates after payment is confirmed. Please don’t pay again.</p><button className="workspace-quiet" onClick={()=>void refresh()}>Check payment</button>{error&&<p role="alert">{error}</p>}</div>;
 if(status?.needsClaim)return <div><h3>Your payment is confirmed</h3><p>Verify your payment email to open your workspace.</p><AccountAccess initialEmail={status.email??''} onSignedIn={onSignedIn}/></div>;
 return <section className="credit-checkout" aria-label="Add work credits">
  <p className="credit-checkout-intro">Choose what to add. Your AI uses credits for eligible research, contact lookups, and follow-up as work becomes available.</p>
  {!status&&<p role="status">Checking available credit amounts…</p>}
  {status?.mode==='test'&&<p className="membership-note">Test checkout · No live work.</p>}
  <div className="credit-pack-options" role="group" aria-label="Work credit amounts">{packs.filter(p=>[1000,2500,5000,10000].includes(p.price_cents)).map(p=><button type="button" key={p.code} aria-pressed={code===p.code} disabled={busy} onClick={()=>setCode(p.code)}><strong>{priceLabel(p.price_cents)}</strong><span>{p.price_cents===1000?'Get started':p.price_cents===2500?'Keep going':p.price_cents===5000?'More capacity':'Build momentum'}</span></button>)}</div>
  {packs.some(p=>p.price_cents>10000)&&<details className="credit-more"><summary>More credit amounts</summary><label>Add credits<select value={code} disabled={busy} onChange={e=>setCode(e.target.value)}>{packs.map(p=><option key={p.code} value={p.code}>{priceLabel(p.price_cents)} one time</option>)}</select></label></details>}
  {selected&&<div className="credit-purchase-summary"><span>One-time purchase</span><strong>{priceLabel(selected.price_cents)}</strong><small>{priceLabel(selected.credit_cents)} added to work credits</small></div>}
  <p className="credit-purchase-terms" id="credit-purchase-terms">By continuing, you authorize eligible AI work to use these credits after payment. The full amount may be used as work is available. No daily renewal or automatic refill. Credits may be spent without a deal.</p>
  {status?.earlyAccess&&<p className="credit-availability">{earlyAccessDisclosure}</p>}
  <details className="credit-full-terms"><summary>Full purchase terms</summary><p>{workCreditTerms}</p><a href="/costs-and-disclosures#one-time" target="_blank" rel="noopener noreferrer">All costs &amp; terms</a></details>
  <button className="fund-button full" disabled={busy||!selected||!status?.enabled} aria-describedby="credit-purchase-terms" onClick={()=>void checkout()}>{busy?'Opening secure checkout…':selected?`Add ${priceLabel(selected.price_cents)} in work credits`:'Choose a credit amount'}<ArrowRight size={17}/></button>
  <p className="credit-purchase-safe"><ShieldCheck size={14}/>Pay once. You decide when to add more.</p>
  {status&&!status.enabled&&<p role="status">Credit purchases are currently unavailable. <button onClick={()=>void refresh()}>Check again</button></p>}
  {error&&<p role="alert">{error} <button onClick={()=>void refresh()}>Retry</button></p>}
 </section>;
}
