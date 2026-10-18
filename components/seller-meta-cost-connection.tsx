'use client';
import {useRef,useState,type FormEvent} from 'react';
import type {AcquisitionCostReport} from '@/lib/seller-acquisition-costs';
type Choice={id:string;name:string};
const money=(micros:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(micros/1000000);
const stamp=(value:string)=>new Date(value).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true})+' Central';
export function SellerMetaCostConnection({sources,onSaved,onDenied}:{sources:AcquisitionCostReport['automation'];onSaved:()=>Promise<unknown>;onDenied:()=>void}){
 const [accounts,setAccounts]=useState<Choice[]>([]),[campaigns,setCampaigns]=useState<Choice[]>([]),[account,setAccount]=useState(''),[metaCampaign,setMetaCampaign]=useState(''),[campaign,setCampaign]=useState('image_ads');
 const [token,setToken]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');const inFlight=useRef(false);
 async function result(r:Response){
  if(r.status===401||r.status===403){setToken('');setAccounts([]);setCampaigns([]);setAccount('');setMetaCampaign('');onDenied();throw Error('Sign in with the owner account to connect Meta.');}
  const d=await r.json();if(!r.ok)throw Error(d.error||'Meta could not be reached.');return d;
 }
 async function connect(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');setNotice('');
  try{
   const d=await result(await fetch('/api/seller/costs/meta',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:token.trim()})}));
   setToken('');setAccounts(d.accounts);setAccount('');setCampaigns([]);setMetaCampaign('');setNotice(d.message);
  }catch(e){setError(e instanceof Error?e.message:'Meta could not be connected.');}finally{inFlight.current=false;setBusy(false);}
 }
 async function load(accountId?:string){
  if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');setNotice('');
  try{const d=await result(await fetch('/api/seller/costs/meta'+(accountId?'?account='+encodeURIComponent(accountId):''),{cache:'no-store'}));
   if(accountId){setCampaigns(d.campaigns);setMetaCampaign('');if(!d.campaigns.length)setNotice('No campaigns were available for this account.');}
   else{setAccounts(d.accounts);if(!d.accounts.length)setNotice('No USD ad accounts were available. Check the connection’s advertising-account access.');}
  }catch(e){setError(e instanceof Error?e.message:'Meta could not be reached.');}finally{inFlight.current=false;setBusy(false);}
 }
 async function save(e:FormEvent<HTMLFormElement>|null,entry={campaign,accountId:account,metaCampaignId:metaCampaign,enabled:true}){
  e?.preventDefault();if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');setNotice('');
  try{const d=await result(await fetch('/api/seller/costs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'meta',requestId:crypto.randomUUID(),...entry})}));setNotice(d.message);await onSaved();}
  catch(e){setError(e instanceof Error?e.message:'Connection could not be saved.');}finally{inFlight.current=false;setBusy(false);}
 }
 return <div className="lead-cost-settings" aria-label="Automatic Meta costs"><h3>Automatic Meta costs</h3><p>Sync campaign spend every hour. New lead estimates use the last 7 completed days of spend divided by unique leads received. Completed days also update each lead’s reported cost; customer charges stay fixed.</p>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!sources.length&&<p><strong>{accounts.length?'Meta access verified.':'Not connected yet.'}</strong> {accounts.length?'Choose your ad account and HomeOffer campaign below to start importing spend.':'Paste your Meta access token below, then choose your ad account and HomeOffer campaign.'}</p>}
  {sources.map(s=>{const stale=!!s.syncedAt&&Date.now()-Date.parse(s.syncedAt)>48*3600000;const state=!s.enabled?'Paused':s.status==='synced'&&!stale?'Syncing automatically':s.status==='pending'?'First import pending':stale?'Import is out of date':s.status==='connection_required'?'Meta read access required':'Last import needs attention';return <div className="lead-cost-sync" key={s.id}>
   <strong>{s.campaign} · {state}</strong><p>{s.syncedAt?'Last successful import: '+stamp(s.syncedAt):'No spend imported yet.'}</p>
   {s.syncedAt&&<p>7-day spend {money(s.spendMicros)} · {s.leadCount} unique leads · Average {s.averageMicros===null?'unavailable':money(s.averageMicros)}{s.unallocatedMicros>0?' · '+money(s.unallocatedMicros)+' spent on days with no leads':''}</p>}
   <button type="button" disabled={busy} onClick={()=>void save(null,{campaign:s.campaign,accountId:s.accountId,metaCampaignId:s.metaCampaignId,enabled:!s.enabled})}>{s.enabled?'Pause cost sync':'Resume cost sync'}</button>
  </div>;})}
  <details open={!sources.length}><summary>{sources.length?'Connect another campaign or update access':'Connect Meta campaign'}</summary>
   <form className="meta-access-form" onSubmit={e=>void connect(e)}>
    <label>Meta access token<input type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} value={token} onChange={e=>setToken(e.target.value)} minLength={20} maxLength={4096} placeholder="Paste your Meta access token" required disabled={busy} aria-describedby="meta-access-help"/></label>
    <button disabled={busy||!token.trim()}>{busy?'Connecting…':'Save and connect'}</button>
   </form>
   <p className="lead-cost-hint" id="meta-access-help">Your token is encrypted, kept private, and used to read ad costs. It is never displayed again after saving. No Vercel setup is needed.</p>
   <details className="meta-access-help"><summary>Where do I get the token?</summary><ol>
    <li>Open <a href="https://business.facebook.com/settings/system-users" target="_blank" rel="noopener noreferrer">Meta Business Settings → System users</a> and select your business.</li>
    <li>Create or select a system user. Assign your Meta developer app and the HomeOffer ad account, with View performance access to the ad account.</li>
    <li>Choose Generate token, select your app, and include <code>ads_read</code> permission. Paste the token in the field above.</li>
   </ol><p className="lead-cost-hint">If no app is available, add your Meta developer app to the same business first. A Pixel ID or ad account number is not an access token.</p></details>
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
