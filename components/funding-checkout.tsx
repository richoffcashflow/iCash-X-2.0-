'use client';
import {useEffect,useState} from 'react';
import {processingFeeCents} from '@/lib/funding-fees';
import {AccountAccess} from '@/components/account-access';
import {dailyConsent,dailyConsentVersion} from '@/lib/daily-consent';
type Pack={code:string;price_cents:number;credit_cents:number;enabled:boolean};
type Funding={mode:'test'|'live'|null;enabled:boolean;packs?:Pack[];priceCents?:number;paidCents?:number;needsClaim?:boolean;email?:string};
export function FundingCheckout({onSignedIn,initialCode="budget_ten"}:{onSignedIn:()=>void;initialCode?:string}){
 const [status,setStatus]=useState<Funding|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[accepted,setAccepted]=useState(false),[code,setCode]=useState(initialCode);
 const [daily,setDaily]=useState<{ready:boolean;plan:{state:string;budgetCents:number|null;nextCharge:number|null}|null}|null>(null),[notice,setNotice]=useState('');
 async function refresh(){try{const r=await fetch('/api/funding/status',{cache:'no-store'});if(!r.ok)throw new Error();const funding:Funding=await r.json();setStatus(funding);const billing=await fetch('/api/billing/daily',{cache:'no-store'});if(!billing.ok)throw new Error();const d=await billing.json();setDaily(d);if(d.plan?.budgetCents){const active=funding.packs?.find(p=>p.price_cents===d.plan.budgetCents);if(active)setCode(active.code);}}catch{setError('Could not check funding. Please retry.');}}
 useEffect(()=>{void refresh();},[]);
 const packs=(status?.packs??[]).filter(p=>p.price_cents>=1000);
 const selected=packs.find(p=>p.code===code);const amount=selected?.price_cents??1000;
 const days=1;
 const total=amount*days;
 const fee=processingFeeCents(total),subtotal=total+fee;
 const perDay=amount/100;
 const pace=perDay<5?{level:1,title:"🌱 A light start",note:"A small daily budget leaves less room for paid activity."}:perDay<25?{level:2,title:"⚡ Build momentum",note:"More daily budget gives your bot more room to work."}:perDay<100?{level:3,title:"🔥 Step up the activity",note:"More capacity for property research and seller follow-up."}:{level:4,title:"🚀 Let’s put it to work",note:"Your larger daily budget can support more acquisition activity."};
 async function checkout(){setBusy(true);setError('');try{const r=await fetch('/api/billing/daily',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accepted,version:dailyConsentVersion,action:daily?.plan?.state==='active'?'change':'start',packCode:code,days,totalCents:subtotal})});const d=await r.json();if(!r.ok)throw new Error(d.error);if(d.saved){setNotice(d.message);setBusy(false);setAccepted(false);await refresh();return;}const url=new URL(d.url);if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com')throw new Error('Could not open secure checkout.');window.location.assign(url.href);}catch(e){setError(e instanceof Error?e.message:'Please retry.');setBusy(false);}}
 if(!status)return <p role="status">Checking funding…{error&&<button onClick={()=>void refresh()}>Retry</button>}</p>;
 return <div className="boost-widget">
  {status.mode==='test'&&<p className="boost-caption">Test mode · No real money or live work.</p>}
  {status.needsClaim?<><h3>Keep your balance</h3><p>Verify your email once. We’ll remember this browser.</p><AccountAccess initialEmail={status.email??''} onSignedIn={onSignedIn}/></>:<>
   <div className="boost-duration boost-budget-slider"><label htmlFor="boost-amount">Daily budget <strong>${(amount/100).toLocaleString()}/day</strong></label><input id="boost-amount" type="range" min="0" max={Math.max(0,packs.length-1)} step="1" value={Math.max(0,packs.findIndex(p=>p.code===code))} disabled={busy||packs.length<2} aria-valuetext={`$${(amount/100).toLocaleString()} per day`} onChange={e=>{const pack=packs[Number(e.target.value)];if(pack){setCode(pack.code);setAccepted(false);}}}/><div className="boost-range-labels" aria-hidden="true"><span>$10</span><span>${((packs.at(-1)?.price_cents??1000)/100).toLocaleString()}</span></div></div>
   <p className="boost-average">{daily?.plan?.state==='active'?'New daily charge':'Due today'} <strong>${(subtotal/100).toFixed(2)}</strong></p>
   <div className="boost-pace" data-level={pace.level}><strong>{pace.title}</strong><p>{pace.note}</p><div className="boost-pace-meter" aria-hidden="true">{[1,2,3,4].map(n=><span key={n} data-active={n<=pace.level}/>)}</div><small>Budget capacity—not a prediction of deals or closing speed.</small></div>
   <p className="boost-caption">Choose how much your bot can use each day.</p>
   <p className="boost-caption"><strong>Stop your bot anytime.</strong> {daily?.plan?.state==='active'?'Your budget renews automatically every day until you stop.':'Starting authorizes automatic daily charges until you stop.'}</p>
   <label className="funding-consent"><input type="checkbox" checked={accepted} disabled={busy} onChange={e=>setAccepted(e.target.checked)}/><span>I authorize ${(subtotal/100).toFixed(2)} per day until I stop my bot.</span></label>
   {daily?.plan?.nextCharge&&<p className="boost-caption">Next renewal: {new Date(daily.plan.nextCharge*1000).toLocaleString()}. Budget changes start then.</p>}
   <details className="boost-terms"><summary>Daily billing terms</summary><p>{dailyConsent}</p></details>
   <button className="fund-button full" disabled={busy||!daily?.ready||!accepted} onClick={()=>void checkout()}>{busy?'Opening Stripe…':`${daily?.plan?.state==='active'?'Save daily budget':'Start bot'} — $${(subtotal/100).toFixed(2)}/day`}</button>
   {notice&&<p role="status">{notice}</p>}
   {!daily?.ready&&<p className="boost-caption" role="status">Funding opens when live work is ready.</p>}
  </>}
   {daily?.plan&&<button className="boost-refresh" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const r=await fetch('/api/billing/daily',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'stop'})});if(!r.ok)throw new Error();setNotice('Daily billing stopped. No future renewals.');await refresh();}catch{setError('Cancellation is pending. Please retry; your stop request is saved.');}finally{setBusy(false);}}}>Stop bot & daily billing</button>}
  {error&&<p role="alert">{error}<button className="demo-button" onClick={()=>void refresh()}>Retry</button></p>}
  {!!status.paidCents&&<button className="boost-refresh" onClick={()=>void refresh()}>Refresh payment status</button>}
 </div>;
}
