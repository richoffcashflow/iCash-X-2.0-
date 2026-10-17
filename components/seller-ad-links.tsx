'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {sellerAdSources,sellerAdUrl,sellerAdRate,sellerAdsCsv,type SellerAdRow} from '@/lib/seller-ad-links';

export function SellerAdLinks(){
 const [rows,setRows]=useState<SellerAdRow[]|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[format,setFormat]=useState('all');
 const lock=useRef(false);
 async function load(){setLoading(true);try{const r=await fetch('/api/seller/ad-links',{cache:'no-store'}),d=await r.json();if(!r.ok){if(r.status===401||r.status===403){setRows(null);setNotice('');}throw Error(d.error);}setRows(d.rows);setError('');}catch(e){setError(e instanceof Error?e.message:'Could not load ad links.');}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 async function save(e:FormEvent<HTMLFormElement>,slug?:string){
  e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');const form=e.currentTarget,f=new FormData(form),get=(key:string)=>String(f.get(key)||'');
  try{
   const body=slug?{action:'asset',slug,assetUrl:get('assetUrl')}:{action:'create',label:get('label'),format:get('format'),source:get('source'),campaign:get('campaign'),assetUrl:get('assetUrl')};
   const r=await fetch('/api/seller/ad-links',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),d=await r.json();if(!r.ok){if(r.status===401||r.status===403){setRows(null);setNotice('');}throw Error(d.error);}
   if(!slug)form.reset();setNotice(slug?'Media link saved.':'Tracking link created. Copy it into your ad’s website URL.');await load();
  }catch(e){setError(e instanceof Error?e.message:'Could not save the link.');}finally{lock.current=false;setBusy(false);}
 }
 async function copy(row:SellerAdRow){try{await navigator.clipboard.writeText(sellerAdUrl(row));setNotice(`Copied ${row.label}.`);}catch{setNotice('Select the tracking link below and copy it.');}}
 function download(){const url=URL.createObjectURL(new Blob([sellerAdsCsv(rows||[])],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download='HomeOffer-ad-links-and-results.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 const visible=(rows||[]).filter(r=>format==='all'||r.format===format);
 return <section aria-labelledby="seller-ad-title" className="seller-ad-links">
  <div className="seller-optin-report-heading"><div><h2 id="seller-ad-title">Ad links & response rates</h2><p>One tracking link for each image or video.</p></div><div className="seller-ad-actions"><button type="button" disabled={loading} onClick={()=>void load()}>{loading?'Refreshing…':'Refresh results'}</button><button type="button" disabled={!rows?.length} onClick={download}>Download CSV</button></div></div>
  <p>Use the tracking link as the ad’s website URL. Add a media link to keep the matching image or video beside its results.</p>
  {error&&<p role="alert">{error}{rows?' Showing the last loaded results.':''}</p>}{notice&&<p role="status">{notice}</p>}
  <details className="seller-ad-create"><summary>Create a tracking link</summary><form onSubmit={e=>void save(e)}>
   <label>Ad name<input name="label" placeholder="Video 06 · Cash offer" minLength={2} maxLength={100} required/></label>
   <label>Format<select name="format" aria-label="Format"><option value="image">Image</option><option value="video">Video</option></select></label>
   <label>Source<select name="source" aria-label="Source">{sellerAdSources.map(s=><option key={s} value={s}>{s==='meta'?'Meta · Facebook / Instagram':s}</option>)}</select></label>
   <label>Campaign ID<input name="campaign" defaultValue="hon_fast_cash_cbo_20261016" pattern="[a-zA-Z0-9_-]+" maxLength={100} required/></label>
   <label>Image or video link (optional)<input name="assetUrl" type="url" placeholder="https://…" maxLength={2000}/></label><button disabled={busy}>Create tracking link</button>
  </form></details>
  <label className="seller-ad-filter">Show<select aria-label="Show" value={format} onChange={e=>setFormat(e.target.value)}><option value="all">Images & videos</option><option value="image">Images</option><option value="video">Videos</option></select></label>
  {rows===null?<p>{loading?'Loading ad links…':'Results unavailable.'}</p>:<div className="seller-optin-table-wrap"><table><thead><tr><th scope="col">Ad / source</th><th scope="col">Visitors</th><th scope="col">Responses</th><th scope="col">Response rate</th><th scope="col">Qualified</th><th scope="col">Links</th></tr></thead><tbody>{visible.map(row=><tr key={row.slug}>
   <th scope="row">{row.label}<small>{row.format} · {row.source}</small><small>{row.campaign}</small></th><td>{row.visitors}</td><td>{row.responses}</td><td>{sellerAdRate(row.responses,row.visitors)}</td><td>{row.qualified}</td>
   <td className="seller-ad-link-cell"><button type="button" onClick={()=>void copy(row)}>Copy tracking link</button><details><summary>View links</summary><label>Tracking link<input readOnly value={sellerAdUrl(row)} onFocus={e=>e.target.select()}/></label>{row.assetUrl&&<a href={row.assetUrl} target="_blank" rel="noopener noreferrer">Open {row.format} ↗</a>}<form onSubmit={e=>void save(e,row.slug)}><label>Media link<input name="assetUrl" type="url" defaultValue={row.assetUrl} placeholder="https://…" maxLength={2000}/></label><button disabled={busy}>Save media link</button></form></details></td>
  </tr>)}</tbody></table>{!visible.length&&<p>No links in this format yet.</p>}</div>}
  <p className="seller-optin-method">Results start when tracking is enabled and include each link’s full history. Response rate = visitors who submit a valid request ÷ tracked visitors. Repeat visits in the same browser count once per ad. A request is credited to the most recent tracked ad visited in the past 30 days; duplicate requests, known bots and privacy opt-outs are excluded. Visitors who block tracking may not be counted. These are website response rates; ad impressions and click-through rates stay in your ad platform.</p>
 </section>;
}
