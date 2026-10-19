'use client';
import {useEffect,useRef,useState} from 'react';
import {webinarRequest as workspaceRequest} from '@/lib/webinar-client';
import {overviewTime} from '@/lib/owner-overview';
import {callbackPhone,validSellerCallbackContext,type SellerCallbackContext} from '@/lib/seller-callback-context';
import styles from './outreach.module.css';
export function OwnerCallbackLookup(){
 const [phone,setPhone]=useState(''),[business,setBusiness]=useState(''),[report,setReport]=useState<SellerCallbackContext|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>active.current?.abort(),[]);
 function clear(){active.current?.abort();active.current=null;setReport(null);setError('');setBusy(false);}
 async function find(){
  clear();const caller=callbackPhone(phone);if(!caller){setError('Enter the seller’s 10-digit phone number.');return;}
  const controller=new AbortController();active.current=controller;setBusy(true);
  try{
   const data=await workspaceRequest<{report:SellerCallbackContext}>('/api/admin/callback-context',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:caller,businessNumber:business||null}),signal:controller.signal});
   if(active.current!==controller)return;
   if(!validSellerCallbackContext(data.report,caller,business||null))throw Error('Caller details could not be verified.');
   setReport(data.report);
  }catch(e){if(active.current===controller)setError(e instanceof Error?e.message:'Caller details could not load.');}
  finally{if(active.current===controller){active.current=null;setBusy(false);}}
 }
 return <details className={styles.explanation}><summary>Seller calling back? Find their property</summary>
  <p>Look up the caller before discussing the property. Confirm the address with them; their phone number does not verify ownership.</p>
  <form className={styles.callbackForm} onSubmit={e=>{e.preventDefault();void find();}}>
   <label>Seller’s phone<input type="tel" autoComplete="off" value={phone} maxLength={24} placeholder="(555) 555-1234" onChange={e=>{clear();setPhone(e.target.value);}}/></label>
   <label>Number they called<select value={business} onChange={e=>{clear();setBusiness(e.target.value);}}><option value="">Not sure</option><option value="+14243948384">(424) 394-8384</option><option value="+17208134296">(720) 813-4296</option><option value="+14244377030">(424) 437-7030 · paused</option></select></label>
   <button disabled={busy} type="submit">{busy?'Finding property…':'Find property'}</button>
  </form>
  {error&&<p role="alert">{error}</p>}
  {report&&<div aria-live="polite"><p>{report.status==='unknown'?'No recent outreach matches. Ask which property they are calling about.':report.status==='ambiguous'?'Several properties match. Ask the seller to give the address before choosing a property.':'One recent property match. Confirm this is the property they are calling about.'}</p>
   {report.matches.map((m,i)=><article className={styles.callbackMatch} key={m.screeningId+':'+m.businessNumber+':'+i}><strong>{m.address}</strong><span>{m.account} · {m.businessNumber}</span><span>Last outreach: {overviewTime(m.lastContactAt)} CT</span><span>{m.available?'Property conversation available':'Automatic handling is on hold. Check the account and property controls.'}</span><small>Account reference: {m.accountId}</small></article>)}
   {report.matches.length===51&&<p>More matches may exist. Select the number they called to narrow the results.</p>}
  </div>}
 </details>;
}
