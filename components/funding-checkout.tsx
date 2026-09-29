'use client';
import {useEffect,useState} from 'react';
import {maximumFundingDays} from '@/lib/funding-duration';
import {AccountAccess} from '@/components/account-access';
import {fundingTermsVersion,fundingTermsText} from '@/lib/funding-consent';
type Pack={code:string;price_cents:number;credit_cents:number;enabled:boolean};
type Funding={mode:'test'|'live'|null;enabled:boolean;packs?:Pack[];priceCents?:number;paidCents?:number;needsClaim?:boolean;email?:string};
export function FundingCheckout({onSignedIn,initialCode="start"}:{onSignedIn:()=>void;initialCode?:string}){
 const [status,setStatus]=useState<Funding|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[accepted,setAccepted]=useState(false),[code,setCode]=useState(initialCode),[days,setDays]=useState(1);
 async function refresh(){try{const r=await fetch('/api/funding/status',{cache:'no-store'});if(!r.ok)throw new Error();setStatus(await r.json());}catch{setError('Could not check funding. Please retry.');}}
 useEffect(()=>{void refresh();},[]);
 const packs=(status?.packs??[]).filter(p=>p.price_cents>=2000);
 const selected=packs.find(p=>p.code===code);const amount=selected?.price_cents??2000;
 const maxDays=maximumFundingDays(amount);
 const total=amount*days;
 const perDay=amount/100;
 const pace=perDay<5?{level:1,title:"🌱 A light start",note:"A small daily budget leaves less room for paid activity."}:perDay<25?{level:2,title:"⚡ Build momentum",note:"More daily budget gives your bot more room to work."}:perDay<100?{level:3,title:"🔥 Step up the activity",note:"More capacity for property research and seller follow-up."}:{level:4,title:"🚀 Let’s put it to work",note:"Your larger daily budget can support more acquisition activity."};
 async function checkout(){setBusy(true);setError('');try{const r=await fetch('/api/funding/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accepted,version:fundingTermsVersion,packCode:code,days,totalCents:total})});const d=await r.json();if(!r.ok)throw new Error(d.error);const url=new URL(d.url);if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com')throw new Error('Could not open secure checkout.');window.location.assign(url.href);}catch(e){setError(e instanceof Error?e.message:'Please retry.');setBusy(false);}}
 if(!status)return <p role="status">Checking funding…{error&&<button onClick={()=>void refresh()}>Retry</button>}</p>;
 return <div className="boost-widget">
  {status.mode==='test'&&<p className="boost-caption">Test mode · No real money or live work.</p>}
  {status.needsClaim?<><h3>Keep your balance</h3><p>Verify your email once. We’ll remember this browser.</p><AccountAccess initialEmail={status.email??''} onSignedIn={onSignedIn}/></>:<>
   <div className="boost-duration boost-budget-slider"><label htmlFor="boost-amount">Daily budget <strong>${(amount/100).toLocaleString()}</strong></label><input id="boost-amount" type="range" min="0" max={Math.max(0,packs.length-1)} step="1" value={Math.max(0,packs.findIndex(p=>p.code===code))} disabled={busy||packs.length<2} aria-valuetext={`$${(amount/100).toLocaleString()} per day`} onChange={e=>{const pack=packs[Number(e.target.value)];if(pack){setCode(pack.code);setDays(d=>Math.min(d,maximumFundingDays(pack.price_cents)));setAccepted(false);}}}/><div className="boost-range-labels" aria-hidden="true"><span>$20</span><span>${((packs.at(-1)?.price_cents??2000)/100).toLocaleString()}</span></div></div>
   <div className="boost-duration"><label htmlFor="boost-days">Estimated days <strong>{days} {days===1?'day':'days'}</strong></label><input id="boost-days" type="range" min="1" max={maxDays} step="1" value={days} disabled={busy} aria-valuetext={`${days} days`} onChange={e=>{setDays(Number(e.target.value));setAccepted(false);}}/><div className="boost-range-labels" aria-hidden="true"><span>1 day</span><span>{maxDays} days</span></div></div>
   <p className="boost-average" aria-live="polite">Total budget <strong>${(total/100).toLocaleString()}</strong></p>
   <p className="boost-average" aria-live="polite">Average spend <strong>${(total/100/days).toLocaleString()}/day</strong></p>
   <div className="boost-pace" data-level={pace.level}><strong>{pace.title}</strong><p>{pace.note}</p><div className="boost-pace-meter" aria-hidden="true">{[1,2,3,4].map(n=><span key={n} data-active={n<=pace.level}/>)}</div><small>Budget capacity—not a prediction of deals or closing speed.</small></div>
   <p className="boost-caption">${(amount/100).toLocaleString()}/day × {days} {days===1?'day':'days'}. One-time payment. Budget may run out sooner.</p>
   <label className="funding-consent"><input type="checkbox" checked={accepted} disabled={busy} onChange={e=>setAccepted(e.target.checked)}/><span>I agree to the purchase terms.</span></label>
   <details className="boost-terms"><summary>Purchase terms</summary><p>You authorize a one-time ${(total/100).toFixed(2)} purchase, with an estimated duration of {days} days. You authorize use of the full purchased budget sooner when work is available. The bot stops at your available balance; no automatic reload is authorized. Unused credits stay yours. Results are not guaranteed.</p><p>{fundingTermsText}</p><p>Checkout collects a phone number for account and deal coordination, not marketing-text consent.</p></details>
   <button className="fund-button full" disabled={busy||!status.enabled||!accepted||(status.mode==='live'&&!selected?.enabled)} onClick={()=>void checkout()}>{busy?'Opening Stripe…':`${status.mode==='test'?'Test funding':'Fund my bot'} — $${(total/100).toLocaleString()}`}</button>
   {!status.enabled&&<p className="boost-caption" role="status">Funding opens when live work is ready.</p>}
  </>}
  {error&&<p role="alert">{error}<button className="demo-button" onClick={()=>void refresh()}>Retry</button></p>}
  {!!status.paidCents&&<button className="boost-refresh" onClick={()=>void refresh()}>Refresh payment status</button>}
 </div>;
}
