'use client';
import {useEffect,useState} from 'react';
import {maximumFundingDays} from '@/lib/funding-duration';
import {AccountAccess} from '@/components/account-access';
import {fundingTermsVersion,fundingTermsText} from '@/lib/funding-consent';
type Pack={code:string;price_cents:number;credit_cents:number;enabled:boolean};
type Funding={mode:'test'|'live'|null;enabled:boolean;packs?:Pack[];priceCents?:number;paidCents?:number;needsClaim?:boolean;email?:string};
export function FundingCheckout({onSignedIn,initialCode="start"}:{onSignedIn:()=>void;initialCode?:string}){
 const [status,setStatus]=useState<Funding|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[accepted,setAccepted]=useState(false),[code,setCode]=useState(initialCode),[days,setDays]=useState(3);
 async function refresh(){try{const r=await fetch('/api/funding/status',{cache:'no-store'});if(!r.ok)throw new Error();setStatus(await r.json());}catch{setError('Could not check funding. Please retry.');}}
 useEffect(()=>{void refresh();},[]);
 const packs=(status?.packs??[]).filter(p=>p.price_cents>=2000);
 const selected=packs.find(p=>p.code===code)??packs[0];const amount=selected?.price_cents??2000;
 const maxDays=maximumFundingDays(amount);
 async function checkout(){setBusy(true);setError('');try{const r=await fetch('/api/funding/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accepted,version:fundingTermsVersion,packCode:selected?.code??code,days})});const d=await r.json();if(!r.ok)throw new Error(d.error);const url=new URL(d.url);if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com')throw new Error('Could not open secure checkout.');window.location.assign(url.href);}catch(e){setError(e instanceof Error?e.message:'Please retry.');setBusy(false);}}
 if(!status)return <p role="status">Checking funding…{error&&<button onClick={()=>void refresh()}>Retry</button>}</p>;
 return <div className="boost-widget">
  {status.mode==='test'&&<p className="boost-caption">Test mode · No real money or live work.</p>}
  {status.needsClaim?<><h3>Keep your balance</h3><p>Verify your email once. We’ll remember this browser.</p><AccountAccess initialEmail={status.email??''} onSignedIn={onSignedIn}/></>:<>
   <div className="quick-amounts" role="group" aria-label="Choose your budget">{packs.slice(0,3).map(pack=><button key={pack.code} aria-pressed={selected?.code===pack.code} disabled={busy} onClick={()=>{setCode(pack.code);setDays(d=>Math.min(d,maximumFundingDays(pack.price_cents)));setAccepted(false);}}>${(pack.price_cents/100).toLocaleString()}</button>)}{packs.length===0&&<span>$20 minimum</span>}</div>
   <details className="budget-options"><summary>Budget & timing <span>${(amount/100).toLocaleString()} · {days} days</span></summary><div className="boost-duration"><label htmlFor="boost-amount">Total budget <strong>${(amount/100).toLocaleString()}</strong></label><input id="boost-amount" type="range" min="0" max={Math.max(0,packs.length-1)} step="1" value={Math.max(0,packs.findIndex(p=>p.code===selected?.code))} disabled={busy||packs.length<2} onChange={e=>{const pack=packs[Number(e.target.value)];if(pack){setCode(pack.code);setDays(d=>Math.min(d,maximumFundingDays(pack.price_cents)));setAccepted(false);}}}/></div><div className="boost-duration"><label htmlFor="boost-days">Estimated days <strong>{days}</strong></label><input id="boost-days" type="range" min="3" max={maxDays} step="1" value={days} disabled={busy} onChange={e=>{setDays(Number(e.target.value));setAccepted(false);}}/></div><p className="boost-caption">Average ${(amount/100/days).toFixed(2)}/day. Work may use your budget sooner. No extra charge.</p></details>
   <label className="funding-consent"><input type="checkbox" checked={accepted} disabled={busy} onChange={e=>setAccepted(e.target.checked)}/><span>I agree to the purchase terms.</span></label>
   <details className="boost-terms"><summary>Purchase terms</summary><p>You authorize a one-time ${(amount/100).toFixed(2)} purchase, with an estimated duration of {days} days. You authorize use of the full purchased budget sooner when work is available. The bot stops at your available balance; no automatic reload is authorized. Unused credits stay yours. Results are not guaranteed.</p><p>{fundingTermsText}</p><p>Checkout collects a phone number for account and deal coordination, not marketing-text consent.</p></details>
   <button className="fund-button full" disabled={busy||!status.enabled||!accepted||(status.mode==='live'&&!selected?.enabled)} onClick={()=>void checkout()}>{busy?'Opening Stripe…':`${status.mode==='test'?'Test checkout':'Fund my bot'} · $${(amount/100).toLocaleString()}`}</button>
   <p className="checkout-note">One payment. No subscription. No automatic refill.</p>
   {!status.enabled&&<p className="boost-caption" role="status">Funding opens when live work is ready.</p>}
  </>}
  {error&&<p role="alert">{error}<button className="demo-button" onClick={()=>void refresh()}>Retry</button></p>}
  {!!status.paidCents&&<button className="boost-refresh" onClick={()=>void refresh()}>Refresh payment status</button>}
 </div>;
}
