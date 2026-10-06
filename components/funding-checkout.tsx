'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,ShieldCheck} from 'lucide-react';
import {customFundingCode,fundingAmountCents} from '@/lib/funding-amount';
import {AccountAccess} from './account-access';
import {earlyAccessTermsVersion,earlyAccessDisclosure} from '@/lib/funding-consent';
import {workCreditTerms,workCreditTermsVersion,priceLabel} from '@/lib/membership-policy';
type Pack={code:string;price_cents:number;credit_cents:number;enabled:boolean};
type Funding={earlyAccess?:boolean;mode:'test'|'live'|null;enabled:boolean;packs?:Pack[];custom?:{enabled:boolean;minCents:number;maxCents:number};paidCents?:number;needsClaim?:boolean;email?:string};
export function FundingCheckout({onSignedIn,initialCode}:{onSignedIn:()=>void;initialCode?:string}){
 const [status,setStatus]=useState<Funding|null>(null),[code,setCode]=useState(initialCode??'budget_ten'),[customAmount,setCustomAmount]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[paymentReturn,setPaymentReturn]=useState(false);
 const inFlight=useRef(false),polling=useRef(false),notified=useRef(false),alive=useRef(true);
 async function refresh(){if(polling.current)return;polling.current=true;try{const sessionId=new URLSearchParams(window.location.search).get('session_id');const r=await fetch('/api/funding/status'+(sessionId?'?session_id='+encodeURIComponent(sessionId):''),{cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error);if(alive.current){setStatus(d);setError('');}}catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not check credits. Please retry.');}finally{polling.current=false;}}
 useEffect(()=>{alive.current=true;setPaymentReturn(new URLSearchParams(window.location.search).get('payment')==='funded');void refresh();return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(!paymentReturn||status?.paidCents||status?.needsClaim)return;let tries=0;const timer=setInterval(()=>{if(!document.hidden&&++tries<=12)void refresh();},5000);return()=>clearInterval(timer);},[paymentReturn,status?.paidCents,status?.needsClaim]);
 useEffect(()=>{if(paymentReturn&&status?.paidCents&&!status.needsClaim&&!notified.current){notified.current=true;const url=new URL(window.location.href);url.searchParams.delete('payment');url.searchParams.delete('session_id');window.history.replaceState(null,'',url.pathname+url.search+url.hash);onSignedIn();}},[paymentReturn,status?.paidCents,status?.needsClaim,onSignedIn]);
 const packs=(status?.packs??[]).filter(p=>p.price_cents>=1000&&p.price_cents<=100000&&(status?.mode!=='live'||p.enabled)),selected=packs.find(p=>p.code===code);
 const isCustom=code===customFundingCode,amount=isCustom?fundingAmountCents(customAmount):selected?.price_cents??null;
 const canPay=!!status?.enabled&&amount!==null&&(!isCustom||status.custom?.enabled===true);
 async function checkout(){if(inFlight.current||!canPay)return;inFlight.current=true;setBusy(true);setError('');try{const r=await fetch('/api/funding/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accepted:true,version:workCreditTermsVersion,earlyAccessAccepted:status.earlyAccess===true,earlyAccessVersion:earlyAccessTermsVersion,packCode:code,days:1,totalCents:amount,...(isCustom?{customAmountCents:amount}:{})})});const d=await r.json();if(!alive.current)return;if(!r.ok)throw Error(d.error);const url=new URL(d.url);if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com')throw Error('Could not open secure checkout.');window.location.assign(url.href);}catch(e){setError(e instanceof Error?e.message:'Could not open checkout.');}finally{inFlight.current=false;if(alive.current)setBusy(false);}}
 if(paymentReturn&&status&&!status.paidCents&&!status.needsClaim)return <div role="status"><h3>Confirming your credits</h3><p>Your balance updates after payment is confirmed. Please don’t pay again.</p><button className="workspace-quiet" onClick={()=>void refresh()}>Check payment</button>{error&&<p role="alert">{error}</p>}</div>;
 if(status?.needsClaim)return <div><h3>Your payment is confirmed</h3><p>Verify your payment email to open your workspace.</p><AccountAccess initialEmail={status.email??''} onSignedIn={onSignedIn}/></div>;
 return <section className="credit-checkout" aria-label="Add money">
  <p className="credit-checkout-intro">Choose an amount to start your bot.</p>
  {!status&&<p role="status">Checking available credit amounts…</p>}
  {status?.mode==='test'&&<p className="membership-note">Test checkout · No live work.</p>}
  <div className="credit-pack-options" role="group" aria-label="Amount to add">{[1000,2500,5000].map(cents=>{const pack=packs.find(p=>p.price_cents===cents);return <button type="button" key={cents} aria-pressed={!isCustom&&selected?.price_cents===cents} disabled={busy||!pack} onClick={()=>pack&&setCode(pack.code)}><strong>{priceLabel(cents)}</strong></button>;})}<button type="button" aria-pressed={isCustom} disabled={busy||!status?.custom?.enabled} onClick={()=>setCode(customFundingCode)}><strong>Custom</strong></button></div>
  {isCustom&&<label className="credit-custom-amount" htmlFor="custom-credit-amount">Amount in dollars<input id="custom-credit-amount" type="text" inputMode="decimal" autoComplete="off" placeholder="10.00" value={customAmount} disabled={busy} aria-describedby="custom-credit-hint" onChange={e=>setCustomAmount(e.target.value)}/><small id="custom-credit-hint">$10–$1,000{customAmount&&amount===null?' · Enter a valid amount.':''}</small></label>}
  {amount!==null&&<div className="credit-purchase-summary"><span>One-time purchase</span><strong>{priceLabel(amount)}</strong><small>{priceLabel(isCustom?amount:selected?.credit_cents??amount)} added to credits</small></div>}
  <p className="credit-purchase-terms" id="credit-purchase-terms">Your bot starts automatically after payment. Credits pay for eligible work as it happens. No daily renewal or automatic refill. Results aren’t guaranteed.</p>
  {status?.earlyAccess&&<p className="credit-availability">{earlyAccessDisclosure}</p>}
  <details className="credit-full-terms"><summary>Full purchase terms</summary><p>{workCreditTerms}</p><a href="/costs-and-disclosures#one-time" target="_blank" rel="noopener noreferrer">All costs &amp; terms</a></details>
  <button className="fund-button full" disabled={busy||!canPay} aria-describedby="credit-purchase-terms" onClick={()=>void checkout()}>{busy?'Opening secure checkout…':amount!==null?`Add ${priceLabel(amount)}`:'Enter an amount'}<ArrowRight size={17}/></button>
  <p className="credit-purchase-safe"><ShieldCheck size={14}/>Manual recharge · Add more whenever you want.</p>
  {status&&!status.enabled&&<p role="status">Credit purchases are currently unavailable. <button onClick={()=>void refresh()}>Check again</button></p>}
  {error&&<p role="alert">{error} <button onClick={()=>void refresh()}>Retry</button></p>}
 </section>;
}
