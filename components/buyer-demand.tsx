'use client';
import {useEffect,useState} from 'react';
import type {BuyerDemand} from '@/lib/deal-completion';
export function BuyerDemandPanel({enabled}:{enabled:boolean}){
 const [data,setData]=useState<BuyerDemand|null>(null),[error,setError]=useState(''),[query,setQuery]=useState(''),[refresh,setRefresh]=useState(0);
 useEffect(()=>{if(!enabled)return;const c=new AbortController();void fetch('/api/work/buyer-demand',{cache:'no-store',signal:c.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);setData(d);setError('');}).catch(e=>{if(!c.signal.aborted)setError(e instanceof Error?e.message:'Could not load buyer demand.');});return()=>c.abort();},[enabled,refresh]);
 if(!enabled)return null;
 const markets=data?.markets.filter(m=>m.zip.startsWith(query.trim()));
 return <section className="buyer-demand"><h4>Where buyers are looking</h4><p>Current buyer budgets, repair preferences and stated capacity help prioritize eligible sourcing.</p>{error&&<p role="alert">{error} <button type="button" onClick={()=>setRefresh(v=>v+1)}>Retry</button></p>}{!data&&!error&&<p role="status">Checking buyer preferences…</p>}{data&&<>
 {data.markets.length>0?<><label>Find a ZIP<input inputMode="numeric" maxLength={5} value={query} onChange={e=>setQuery(e.target.value.replace(/\D/g,''))} placeholder="ZIP code"/></label><div className="demand-markets">{markets?.map(m=><article key={m.zip}><strong>{m.zip}</strong><span>{m.buyers} active buyers</span><small>{m.houseBuyers} buying houses · {m.landBuyers} buying land</small>{!!m.budgetCents&&<small>Typical house budget: {(m.budgetCents/100).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0})} · Repairs up to {((m.repairBudgetCents??0)/100).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0})}</small>}{typeof m.capacityBuyers==='number'&&<small>{m.capacityBuyers} buyers reported room to buy more</small>}</article>)}</div>{!markets?.length&&<p>No listed market matches that ZIP yet.</p>}</>:<p>Market insights appear as at least three active buyers join a ZIP. Share your buyer sign-up page to grow coverage.</p>}
 <small>Preferences are renewed within 30 days. Buying interest is self-reported; funds and authority still need verification for each deal.</small></>}</section>;
}
