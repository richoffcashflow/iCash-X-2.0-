'use client';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {acquisitionSources,acquisitionSourceLabels,acquisitionDollarsToCents,type AcquisitionCostReport} from '@/lib/seller-acquisition-costs';
import {SellerMetaCostConnection} from '@/components/seller-meta-cost-connection';
const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const kindLabels:Record<string,string>={reported:'Owner-reported cost',campaign_report:'Campaign spend report',estimate:'Estimated ad cost',organic:'Direct request',demo:'Practice',meta_report:'Meta campaign allocation',meta_estimate:'Automatic Meta estimate'};

export function SellerAcquisitionCosts(){
 const [data,setData]=useState<AcquisitionCostReport|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [source,setSource]=useState('meta'),[campaign,setCampaign]=useState(''),[amount,setAmount]=useState('');
 const inFlight=useRef(false),retry=useRef<{key:string;id:string}|null>(null);
 const load=useCallback(async()=>{const r=await fetch('/api/seller/costs',{cache:'no-store'});const d=await r.json();if(!r.ok){if(r.status===401||r.status===403)setData(null);throw Error(d.error||'Lead costs could not load.');}setData(d);return d as AcquisitionCostReport;},[]);
 useEffect(()=>{void load().then(d=>{const initial=d.estimates.find(e=>e.source==='meta'&&e.campaign==='');if(initial)setAmount((initial.costMicros/1000000).toFixed(2));}).catch(e=>setError(e.message));},[load]);
 async function save(e:FormEvent<HTMLFormElement>,action:'lead'|'estimate',leadId?:string){
  e.preventDefault();if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');setNotice('');
  try{
   const f=new FormData(e.currentTarget),costCents=acquisitionDollarsToCents(String(f.get('cost')??''));
   const payload=action==='lead'?{action,leadId,costCents,note:String(f.get('note')||'Owner-entered advertising cost')}:{action,source,campaign,costCents,note:'Owner-entered estimate for new leads'};
   const key=JSON.stringify(payload);if(retry.current?.key!==key)retry.current={key,id:crypto.randomUUID()};
   const r=await fetch('/api/seller/costs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,requestId:retry.current.id})});
   const d=await r.json();if(!r.ok)throw Error(d.error||'Cost was not confirmed.');setNotice(d.message);retry.current=null;
   await load();
  }catch(e){setError(e instanceof Error?e.message:'Cost was not confirmed.');}finally{inFlight.current=false;setBusy(false);}
 }
 let adCents:number|null=null;try{adCents=acquisitionDollarsToCents(amount);}catch{/* The form gives a precise error on save. */}
 return <section className="lead-costs" id="lead-costs" aria-label="Lead costs">
  <div className="lead-costs-heading"><div><h2>Lead costs</h2><p>Track acquisition costs, customer charges, and the balance for each lead.</p></div><button type="button" disabled={busy} onClick={()=>{setError('');void load().catch(e=>setError(e.message));}}>Refresh costs</button></div>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!data?<p>Loading lead costs…</p>:<>
   <div className="lead-cost-settings"><h3>Pricing for new usage</h3><p>DealMachine research usage is 3× its saved provider cost. Other usage stays at 2×. VIP keeps its 30% discount. Lead pricing includes advertising and processing and is fixed at the first assignment. Existing prices stay unchanged.</p>
   </div>
   <SellerMetaCostConnection sources={data.automation} onSaved={load} onDenied={()=>{setData(null);setError('Platform owner access required. Sign in again.');}}/>
   <div className="lead-cost-settings"><h3>Backup estimate for new leads</h3><p>Use this when an automatic campaign average is unavailable. New leads include ad cost and processing; paid sources without either a recorded cost or an estimate wait for a cost entry.</p>
    <form onSubmit={e=>void save(e,'estimate')}>
     <label>Source<select value={source} onChange={e=>{setSource(e.target.value);const saved=data.estimates.find(x=>x.source===e.target.value&&x.campaign===campaign);setAmount(saved?(saved.costMicros/1000000).toFixed(2):'');}}>{acquisitionSources.map(s=><option key={s} value={s}>{acquisitionSourceLabels[s]}</option>)}</select></label>
     <label>Ad cost per lead, USD<input name="cost" inputMode="decimal" type="number" step="0.01" min="0" max="10000" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="11.20" required/></label>
     <label>Campaign (optional)<input value={campaign} onChange={e=>setCampaign(e.target.value)} pattern="[a-zA-Z0-9_-]*" maxLength={100} placeholder="All campaigns for this source"/></label>
     <button disabled={busy}>{busy?'Saving…':'Save estimate for new leads'}</button>
    </form>
    {adCents!==null&&<p className="lead-cost-hint">With this ad cost alone: {money(adCents*2)} Standard / {money(Math.ceil(adCents*1.6))} VIP. Processing is added before calculating the final price.</p>}
    {data.estimates.length>0&&<div className="lead-cost-presets" aria-label="Saved cost estimates">{data.estimates.map(v=><button type="button" key={v.source+':'+v.campaign} onClick={()=>{setSource(v.source);setCampaign(v.campaign);setAmount((v.costMicros/1000000).toFixed(2));}}>{acquisitionSourceLabels[v.source]}{v.campaign?' · '+v.campaign:''}: {money(v.costMicros/10000)}</button>)}</div>}
   </div>
   <h3>Recent leads</h3><p>Latest 50 real requests. Saving a cost keeps completed customer charges unchanged. Lead balance includes the ad cost once and estimated processing; calls and other work are separate.</p>
   {!data.leads.length?<p>No real leads yet.</p>:<div className="lead-cost-list">{data.leads.map(lead=>{
    const total=lead.acquisition!==null&&lead.processingMicros!==null?(lead.acquisition.costMicros+lead.processingMicros)/10000:null;
    return <article key={lead.id} className="lead-cost-card">
     <header><h4>{lead.address}</h4><p>{acquisitionSourceLabels[lead.source]??lead.source}{lead.campaign?' · '+lead.campaign:''} · {new Date(lead.createdAt).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true})} Central</p></header>
     <dl><div><dt>Lead cost</dt><dd>{total===null?'Not recorded':money(total)}</dd></div><div><dt>Collected · {lead.recipients} {lead.recipients===1?'recipient':'recipients'}</dt><dd>{money(lead.collectedCents)}</dd></div><div><dt>Lead balance</dt><dd>{total===null?'—':money(lead.collectedCents-total)}</dd></div></dl>
     <p className="lead-cost-hint">{lead.acquisition?kindLabels[lead.acquisition.kind]+': '+money(lead.acquisition.costMicros/10000):'Ad cost is missing'}{lead.processingMicros!==null?' · Processing estimate: '+money(lead.processingMicros/10000):''}</p>
     <form key={lead.id+':'+JSON.stringify(lead.acquisition)} onSubmit={e=>void save(e,'lead',lead.id)}>
      <label>Actual ad cost, USD<input name="cost" aria-label={'Ad cost for '+lead.address} inputMode="decimal" type="number" step="0.01" min="0" max="10000" defaultValue={lead.acquisition?(lead.acquisition.costMicros/1000000).toFixed(2):''} placeholder="Enter cost" required/></label>
      <label>Note (optional)<input name="note" maxLength={500} minLength={5} placeholder="For example, Meta Ads Manager"/></label>
      <button disabled={busy}>Save lead cost</button>
     </form>
     {lead.holdReason?.includes('ad cost')&&<p>{lead.holdReason}</p>}
    </article>;
   })}</div>}
  </>}
 </section>;
}
