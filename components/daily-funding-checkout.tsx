'use client';
import {useEffect,useId,useRef,useState,type CSSProperties} from 'react';
import {ArrowRight,Check,ShieldCheck,Sparkles} from 'lucide-react';
import {AccountAccess} from './account-access';
import {dailyBudgetTier,validDailyBudget} from '@/lib/daily-budget';
import {dailyConsent,dailyConsentVersion} from '@/lib/daily-consent';
import {earlyAccessTermsVersion,earlyAccessDailyDisclosure} from '@/lib/funding-consent';
type Pack={code:string;price_cents:number;credit_cents:number;enabled:boolean};
type Funding={mode:'test'|'live'|null;earlyAccess?:boolean;packs?:Pack[];paidCents?:number;needsClaim?:boolean;email?:string};
type Daily={ready:boolean;plan:{state:string;budgetCents:number|null;nextCharge:number|null}|null};
const dollars=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(cents/100);
export function DailyFundingCheckout({onSignedIn,initialCode}:{onSignedIn:()=>void;initialCode?:string}){
 const id=useId(),mounted=useRef(true),lock=useRef(false),notified=useRef(false),polling=useRef(false),edited=useRef(!!initialCode);
 const [funding,setFunding]=useState<Funding|null>(null),[daily,setDaily]=useState<Daily|null>(null),[code,setCode]=useState(initialCode||'budget_ten'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[accepted,setAccepted]=useState(''),[returned,setReturned]=useState(false);
 async function refresh(){try{
  const sessionId=new URLSearchParams(window.location.search).get('session_id');
  // Reconcile a completed daily checkout before reading its funding receipts.
  const billing=await fetch('/api/billing/daily',{cache:'no-store'});if(!billing.ok)throw Error('Could not check your daily plan. Please retry.');const d:Daily=await billing.json();
  const response=await fetch('/api/funding/status'+(sessionId?'?session_id='+encodeURIComponent(sessionId):''),{cache:'no-store'});if(!response.ok)throw Error('Could not check funding. Please retry.');const f:Funding=await response.json();if(!mounted.current)return;
  setFunding(f);setDaily(d);setError('');if(!edited.current&&d.plan?.budgetCents){const active=f.packs?.find(p=>p.price_cents===d.plan?.budgetCents);if(active)setCode(active.code);}
 }catch(e){if(mounted.current){setDaily(null);setAccepted('');setError(e instanceof Error?e.message:'Could not check funding.');}}}
 useEffect(()=>{mounted.current=true;setReturned(new URLSearchParams(window.location.search).get('payment')==='funded');void refresh();return()=>{mounted.current=false;};},[]);
 useEffect(()=>{if(!returned||funding?.paidCents||funding?.needsClaim)return;let tries=0;const timer=setInterval(()=>{if(polling.current||document.hidden)return;if(++tries>12){clearInterval(timer);return;}polling.current=true;void refresh().finally(()=>{polling.current=false;});},5000);return()=>clearInterval(timer);},[returned,funding?.paidCents,funding?.needsClaim]);
 useEffect(()=>{if(returned&&funding?.paidCents&&!funding.needsClaim&&!notified.current){notified.current=true;const u=new URL(window.location.href);u.searchParams.delete('payment');u.searchParams.delete('session_id');window.history.replaceState(null,'',u.pathname+u.search+u.hash);onSignedIn();}},[returned,funding?.paidCents,funding?.needsClaim,onSignedIn]);
 const eligible=(funding?.packs??[]).filter(p=>validDailyBudget(p.price_cents)&&p.price_cents===p.credit_cents&&(funding?.mode!=='live'||p.enabled)).sort((a,b)=>a.price_cents-b.price_cents);
 const packs=eligible.filter((p,index)=>p.code===code||(!eligible.some(other=>other.price_cents===p.price_cents&&other.code===code)&&eligible.findIndex(other=>other.price_cents===p.price_cents)===index));
 const selected=packs.find(p=>p.code===code),amount=selected?.price_cents??1000,tier=dailyBudgetTier(amount),changing=daily?.plan?.state==='active',early=funding?.earlyAccess===true;
 const scope=JSON.stringify([code,amount,funding?.mode,early,daily?.ready,daily?.plan?.state,daily?.plan?.nextCharge,dailyConsentVersion]);
 async function checkout(){if(lock.current||!selected||!daily?.ready||accepted!==scope)return;lock.current=true;setBusy(true);setError('');try{
  const r=await fetch('/api/billing/daily',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:changing?'change':'start',packCode:code,totalCents:amount,accepted:true,version:dailyConsentVersion,earlyAccessAccepted:early,earlyAccessVersion:earlyAccessTermsVersion})});const d=await r.json();if(!mounted.current)return;if(!r.ok)throw Error(d.error||'Could not open checkout.');
  if(d.saved){setNotice(d.message);setAccepted('');await refresh();return;}
  const u=new URL(d.url);if(u.protocol!=='https:'||u.hostname!=='checkout.stripe.com')throw Error('Could not open secure checkout.');window.location.assign(u.href);
 }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Please retry.');}finally{lock.current=false;if(mounted.current)setBusy(false);}}
 async function stop(){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const r=await fetch('/api/billing/daily',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'stop'})});if(!r.ok)throw Error('Could not confirm cancellation. Retry to check your stop request.');setNotice('Daily billing stopped. Your unused credits remain.');await refresh();onSignedIn();}catch(e){setError(e instanceof Error?e.message:'Please retry.');}finally{lock.current=false;setBusy(false);}}
 if(returned&&funding&&!funding.paidCents&&!funding.needsClaim)return <div className="daily-payment-status" role="status"><h3>Confirming your payment</h3><p>We’ll open your workspace once it’s confirmed. Please don’t pay again.</p><button onClick={()=>void refresh()}>Check payment</button>{error&&<p role="alert">{error}</p>}</div>;
 if(!funding||!daily)return <div role="status"><p>{error||'Loading daily budgets…'}</p>{error&&<button onClick={()=>void refresh()}>Retry</button>}</div>;
 if(funding.needsClaim)return <div className="daily-payment-status"><Check size={28}/><h3>Your budget is funded.</h3><p>Verify your payment email to open your workspace.</p><AccountAccess initialEmail={funding.email??''} onSignedIn={onSignedIn}/></div>;
 return <div className="daily-funding" style={{'--tier-color':tier.color} as CSSProperties}>
  {funding.mode==='test'&&<p>Test mode · No real charges or live work.</p>}
  <div className="daily-tier-heading"><span className="daily-tier-badge"><Sparkles size={14}/>{tier.name}</span><span>You set the pace</span></div>
  <div className="daily-price" aria-live="polite"><strong>{dollars(amount)}</strong><span>/ day</span></div>
  <p className="daily-tier-description">{tier.detail}</p>
  <label className="sr-only" htmlFor={id}>Daily budget</label><input id={id} className="daily-slider" type="range" min="0" max={Math.max(0,packs.length-1)} step="1" value={Math.max(0,packs.findIndex(p=>p.code===code))} aria-valuetext={`${dollars(amount)} per day, ${tier.name}`} disabled={busy||packs.length<2} onChange={e=>{const p=packs[Number(e.target.value)];if(p){edited.current=true;setCode(p.code);setAccepted('');setNotice('');}}}/>
  <div className="daily-slider-labels"><span>$10 / day</span><span>{dollars(packs.at(-1)?.price_cents??100000)} / day</span></div>
  <div className="daily-presets" role="group" aria-label="Popular daily budgets">{packs.filter(p=>[1000,2500,5000,10000].includes(p.price_cents)).map(p=><button key={p.code} type="button" aria-pressed={p.code===code} disabled={busy} onClick={()=>{edited.current=true;setCode(p.code);setAccepted('');setNotice('');}}>{dollars(p.price_cents)}</button>)}</div>
  <div className="daily-capacity"><div><span>DAILY WORK BUDGET</span><strong>{amount===1000?'Start here':`${amount/1000}× the $10 budget`}</strong></div><div className="daily-capacity-bars" aria-hidden="true">{[1000,2500,5000,10000].map(n=><i key={n} className={amount>=n?'filled':''}/>)}</div><p>The same AI at every level. More budget gives it more room for research, lead matching, and follow-up. Results vary.</p></div>
  <p className="daily-renewal" id={id+'-terms'}>{changing?'New amount starts at the next renewal. No charge now. ':''}<strong>{dollars(amount)} every 24 hours</strong> until you stop. {dollars(amount*7)} over 7 renewals. Unused credits stay in your account.</p>
  {early&&<p className="daily-availability">AI calling and seller-ad lead delivery are not live yet. Daily charges continue while those features are unavailable; funding does not enable them.</p>}
  <label className="funding-consent"><input type="checkbox" checked={accepted===scope} disabled={busy||!selected||!daily.ready} aria-describedby={id+'-terms'} onChange={e=>setAccepted(e.target.checked?scope:'')}/><span>I authorize {dollars(amount)}/day until I stop{early?', including while some features are unavailable':''}.</span></label>
  <button type="button" className="setup-primary daily-checkout-button" disabled={busy||!daily.ready||!selected||accepted!==scope} onClick={()=>void checkout()}>{busy?'One moment…':changing?`Confirm ${dollars(amount)}/day`:`Start daily funding · ${dollars(amount)}/day`}<ArrowRight size={18}/></button>
  <span className="daily-control-note"><ShieldCheck size={14}/>Firm spending limit · No automatic budget increases</span>
  <details className="boost-terms"><summary>Billing & how your budget works</summary><p>{dailyConsent}</p><p>Eligible work must fit your available credits and daily limit. Work that doesn’t fit waits for a later funded day; tomorrow’s money is never spent early. Increasing your budget doesn’t guarantee a lead or deal.</p>{early&&<p>{earlyAccessDailyDisclosure}</p>}<a href="/costs-and-disclosures#daily-billing" target="_blank" rel="noopener noreferrer">All costs and terms ↗</a></details>
  {daily.plan?.nextCharge&&<p className="daily-next-renewal">Next renewal: {new Date(daily.plan.nextCharge*1000).toLocaleString()}.</p>}
  {daily.plan&&<button className="boost-refresh" disabled={busy} onClick={()=>void stop()}>Stop bot & daily billing</button>}
  {!daily.ready&&<p role="status">Daily funding is currently unavailable.</p>}{notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error} <button onClick={()=>void refresh()}>Refresh</button></p>}
 </div>;
}
