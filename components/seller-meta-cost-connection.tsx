'use client';
import {useRef,useState,type FormEvent} from 'react';
import type {AcquisitionCostReport} from '@/lib/seller-acquisition-costs';
type Choice={id:string;name:string};
const money=(micros:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(micros/1000000);
const stamp=(value:string)=>new Date(value).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true})+' Central';
export function SellerMetaCostConnection({sources,onSaved}:{sources:AcquisitionCostReport['automation'];onSaved:()=>Promise<unknown>}){
 const [accounts,setAccounts]=useState<Choice[]>([]),[campaigns,setCampaigns]=useState<Choice[]>([]),[account,setAccount]=useState(''),[metaCampaign,setMetaCampaign]=useState(''),[campaign,setCampaign]=useState('image_ads');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');const inFlight=useRef(false);
 async function load(accountId?:string){
  if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');setNotice('');
  try{const r=await fetch('/api/seller/costs/meta'+(accountId?'?account='+encodeURIComponent(accountId):''),{cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'Meta could not be reached.');
   if(accountId){setCampaigns(d.campaigns);setMetaCampaign('');if(!d.campaigns.length)setNotice('No campaigns were available for this account.');}
   else{setAccounts(d.accounts);if(!d.accounts.length)setNotice('No USD ad accounts were available. Check the connection’s advertising-account access.');}
  }catch(e){setError(e instanceof Error?e.message:'Meta could not be reached.');}finally{inFlight.current=false;setBusy(false);}
 }
 async function save(e:FormEvent<HTMLFormElement>|null,entry={campaign,accountId:account,metaCampaignId:metaCampaign,enabled:true}){
  e?.preventDefault();if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');setNotice('');
  try{const r=await fetch('/api/seller/costs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'meta',requestId:crypto.randomUUID(),...entry})});const d=await r.json();if(!r.ok)throw Error(d.error||'Connection could not be saved.');setNotice(d.message);await onSaved();}
  catch(e){setError(e instanceof Error?e.message:'Connection could not be saved.');}finally{inFlight.current=false;setBusy(false);}
 }
 return <div className="lead-cost-settings" aria-label="Automatic Meta costs"><h3>Automatic Meta costs</h3><p>Sync campaign spend every hour. New lead estimates use the last 7 completed days of spend divided by unique leads received. Completed days also update each lead’s reported cost; customer charges stay fixed.</p>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!sources.length&&<p><strong>Not connected yet.</strong> Select the Meta campaign behind your HomeOffer tracking link to start importing spend.</p>}
  {sources.map(s=>{const stale=!!s.syncedAt&&Date.now()-Date.parse(s.syncedAt)>48*3600000;const state=!s.enabled?'Paused':s.status==='synced'&&!stale?'Syncing automatically':s.status==='pending'?'First import pending':stale?'Import is out of date':s.status==='connection_required'?'Meta read access required':'Last import needs attention';return <div className="lead-cost-sync" key={s.id}>
   <strong>{s.campaign} · {state}</strong><p>{s.syncedAt?'Last successful import: '+stamp(s.syncedAt):'No spend imported yet.'}</p>
   {s.syncedAt&&<p>7-day spend {money(s.spendMicros)} · {s.leadCount} unique leads · Average {s.averageMicros===null?'unavailable':money(s.averageMicros)}{s.unallocatedMicros>0?' · '+money(s.unallocatedMicros)+' spent on days with no leads':''}</p>}
   <button type="button" disabled={busy} onClick={()=>void save(null,{campaign:s.campaign,accountId:s.accountId,metaCampaignId:s.metaCampaignId,enabled:!s.enabled})}>{s.enabled?'Pause cost sync':'Resume cost sync'}</button>
  </div>;})}
  <details><summary>{sources.length?'Connect another campaign':'Connect Meta campaign'}</summary>
   <button type="button" disabled={busy} onClick={()=>void load()}>Check Meta connection</button>
   {accounts.length>0&&<form onSubmit={e=>void save(e)}>
    <label>Ad account<select aria-label="Ad account" required value={account} disabled={busy} onChange={e=>{setAccount(e.target.value);setCampaigns([]);setMetaCampaign('');if(e.target.value)void load(e.target.value);}}><option value="">Select account</option>{accounts.map(a=><option value={a.id} key={a.id}>{a.name}</option>)}</select></label>
    <label>Meta campaign<select aria-label="Meta campaign" required value={metaCampaign} disabled={busy||!campaigns.length} onChange={e=>setMetaCampaign(e.target.value)}><option value="">Select campaign</option>{campaigns.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
    <label>HomeOffer tracking campaign<input value={campaign} onChange={e=>setCampaign(e.target.value)} pattern="[a-zA-Z0-9_-]+" maxLength={100} placeholder="image_ads" required/></label>
    <button disabled={busy||!account||!metaCampaign}>Start automatic cost tracking</button>
   </form>}
   <p className="lead-cost-hint">Use the campaign value in your ad link, such as image_ads. Each Meta campaign maps to one tracking campaign. USD accounts only.</p>
  </details>
 </div>;
}
