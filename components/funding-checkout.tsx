'use client';
import {useEffect,useState} from 'react';
import {processingFeeCents,processingFeePercent} from '@/lib/funding-fees';
import {AccountAccess} from '@/components/account-access';
import {fundingTermsVersion,fundingTermsText} from '@/lib/funding-consent';
type Pack={code:string;price_cents:number;credit_cents:number;enabled:boolean};
type Funding={mode:'test'|'live'|null;enabled:boolean;packs?:Pack[];priceCents?:number;paidCents?:number;needsClaim?:boolean;email?:string};
export function FundingCheckout({onSignedIn,initialCode="budget_ten"}:{onSignedIn:()=>void;initialCode?:string}){
 const [status,setStatus]=useState<Funding|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[accepted,setAccepted]=useState(false),[code,setCode]=useState(initialCode);
 async function refresh(){try{const r=await fetch('/api/funding/status',{cache:'no-store'});if(!r.ok)throw new Error();setStatus(await r.json());}catch{setError('Could not check funding. Please retry.');}}
 useEffect(()=>{void refresh();},[]);
 const packs=(status?.packs??[]).filter(p=>p.price_cents>=1000);
 const selected=packs.find(p=>p.code===code);const amount=selected?.price_cents??1000;
 const days=1;
 const total=amount*days;
 const fee=processingFeeCents(total),subtotal=total+fee;
 const perDay=amount/100;
 const pace=perDay<5?{level:1,title:"🌱 A light start",note:"A small daily budget leaves less room for paid activity."}:perDay<25?{level:2,title:"⚡ Build momentum",note:"More daily budget gives your bot more room to work."}:perDay<100?{level:3,title:"🔥 Step up the activity",note:"More capacity for property research and seller follow-up."}:{level:4,title:"🚀 Let’s put it to work",note:"Your larger daily budget can support more acquisition activity."};
 async function checkout(){setBusy(true);setError('');try{const r=await fetch('/api/funding/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accepted,version:fundingTermsVersion,packCode:code,days,totalCents:subtotal})});const d=await r.json();if(!r.ok)throw new Error(d.error);const url=new URL(d.url);if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com')throw new Error('Could not open secure checkout.');window.location.assign(url.href);}catch(e){setError(e instanceof Error?e.message:'Please retry.');setBusy(false);}}
 if(!status)return <p role="status">Checking funding…{error&&<button onClick={()=>void refresh()}>Retry</button>}</p>;
 return <div className="boost-widget">
  {status.mode==='test'&&<p className="boost-caption">Test mode · No real money or live work.</p>}
  {status.needsClaim?<><h3>Keep your balance</h3><p>Verify your email once. We’ll remember this browser.</p><AccountAccess initialEmail={status.email??''} onSignedIn={onSignedIn}/></>:<>
   <div className="boost-duration boost-budget-slider"><label htmlFor="boost-amount">Daily budget <strong>${(amount/100).toLocaleString()}/day</strong></label><input id="boost-amount" type="range" min="0" max={Math.max(0,packs.length-1)} step="1" value={Math.max(0,packs.findIndex(p=>p.code===code))} disabled={busy||packs.length<2} aria-valuetext={`$${(amount/100).toLocaleString()} per day`} onChange={e=>{const pack=packs[Number(e.target.value)];if(pack){setCode(pack.code);setAccepted(false);}}}/><div className="boost-range-labels" aria-hidden="true"><span>$10</span><span>${((packs.at(-1)?.price_cents??1000)/100).toLocaleString()}</span></div></div>
   <p className="boost-average">Processing fee ({processingFeePercent}%) <strong>${(fee/100).toFixed(2)}</strong></p>
   <p className="boost-average">Due today before tax <strong>${(subtotal/100).toFixed(2)}</strong></p>
   <p className="boost-caption">Applicable sales tax calculated at checkout. Fees and tax do not add bot credits.</p>
   <div className="boost-pace" data-level={pace.level}><strong>{pace.title}</strong><p>{pace.note}</p><div className="boost-pace-meter" aria-hidden="true">{[1,2,3,4].map(n=><span key={n} data-active={n<=pace.level}/>)}</div><small>Budget capacity—not a prediction of deals or closing speed.</small></div>
   <p className="boost-caption">Choose how much your bot can use each day.</p>
   <p className="boost-caption"><strong>Stop your bot anytime.</strong> Daily billing is not available yet. No automatic charges are active.</p>
   <label className="funding-consent"><input type="checkbox" checked={accepted} disabled={busy} onChange={e=>setAccepted(e.target.checked)}/><span>I agree to the purchase terms.</span></label>
   <details className="boost-terms"><summary>Daily billing terms</summary><p>The intended daily charge is ${(subtotal/100).toFixed(2)} plus applicable sales tax: ${(total/100).toFixed(2)} for bot usage and ${(fee/100).toFixed(2)} processing fee. Starting the bot will require authorization for recurring daily charges. Stopping the bot must cancel future daily charges. Already-used services are not reversed. Daily billing is not connected yet, so starting and charging are disabled.</p></details>
   <button className="fund-button full" disabled onClick={()=>void checkout()}>{busy?'Opening Stripe…':`Start bot — $${(subtotal/100).toFixed(2)}/day + tax`}</button>
   {!status.enabled&&<p className="boost-caption" role="status">Funding opens when live work is ready.</p>}
  </>}
  {error&&<p role="alert">{error}<button className="demo-button" onClick={()=>void refresh()}>Retry</button></p>}
  {!!status.paidCents&&<button className="boost-refresh" onClick={()=>void refresh()}>Refresh payment status</button>}
 </div>;
}
