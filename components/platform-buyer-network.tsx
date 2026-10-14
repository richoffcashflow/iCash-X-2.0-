'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowUpRight} from 'lucide-react';
import {webinarRequest,webinarPost} from '@/lib/webinar-client';
import type {NetworkWorkspace} from '@/lib/buyer-network';
import styles from './buyer-network.module.css';
import {WorkspacePanel} from './workspace-panel';
import {BuyerDemandPanel} from './buyer-demand';

export function PlatformBuyerNetwork(){
 const locked=useRef(false);
 const [networkOpen,setNetworkOpen]=useState(false);
 const [data,setData]=useState<NetworkWorkspace|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[editing,setEditing]=useState(false),[address,setAddress]=useState(''),[enabled,setEnabled]=useState(true);
 async function refresh(signal?:AbortSignal){const next=await webinarRequest<NetworkWorkspace>('/api/work/buyer-network',{cache:'no-store',signal});if(!signal?.aborted)setData(next);return next;}
 useEffect(()=>{const abort=new AbortController();let inFlight=false;const load=async()=>{if(document.hidden||inFlight)return;inFlight=true;try{await refresh(abort.signal);if(!abort.signal.aborted)setError('');}catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Could not refresh the buyer network.');}finally{inFlight=false;}};void load();const timer=setInterval(load,60000);return()=>{abort.abort();clearInterval(timer);};},[]);
 function edit(){setAddress(data?.settings?.mailingAddress??'');setEnabled(data?.settings?.enabled??true);setEditing(v=>!v);}
 async function save(e:FormEvent){e.preventDefault();if(locked.current)return;locked.current=true;setBusy(true);setError('');try{await webinarPost('/api/work/buyer-network',{enabled,mailingAddress:address});await refresh();setEditing(false);setNotice(enabled?'Saved. Your bot will email eligible matching buyers when it runs.':'Network delivery paused.');}catch(e){setError(e instanceof Error?e.message:'Could not save.');}finally{locked.current=false;setBusy(false);}}
 async function handled(matchId:string){if(locked.current)return;locked.current=true;setBusy(true);setError('');try{await webinarRequest('/api/work/buyer-network',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({matchId})});await refresh();setNotice('Response marked handled. A new reply will appear for review.');}catch(e){setError(e instanceof Error?e.message:'Could not save.');}finally{locked.current=false;setBusy(false);}}
 if(!data?.hasActiveDeal&&!data?.responses&&!error)return null;
 return <WorkspacePanel id="platform-buyer-network" title="Buyer network" onOpenChange={setNetworkOpen} label={<>Buyer network <span className={styles.vipLabel}>VIP</span><span>{error?' · Needs review':data?.responses?` · ${data.responses} ${data.responses===1?'reply':'replies'}`:!data?.settings?' · Set up emails':''}</span></>}>
  <div className={styles.workspaceBody}>
   <>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {data&&<><BuyerDemandPanel enabled={networkOpen}/><div className={styles.metrics}><div><strong>{data.enrolledBuyers}</strong><span>Active network buyers</span></div><div><strong>{data.matches}</strong><span>Your matches</span></div><div><strong>{data.emailed}</strong><span>Packages sent</span></div></div>
     <p>{!data.enrolledBuyers?'The network is open for enrollment. Share the buyer sign-up link to start growing it.':'Your running bot matches released deals by ZIP, property type, price and repair budget.'}</p>
     <a className={styles.packageLink} href="https://homeoffernetwork.com/buyers" target="_blank" rel="noreferrer">Buyer sign-up page<ArrowUpRight size={16} aria-hidden="true"/></a>
     {!data.settings&&<div className={styles.setupNote}><strong>One step to send packages</strong><p>Add your business mailing address for the email footer. Matches can still appear in the buyer’s inbox.</p></div>}
     {data.settings&&!data.settings.enabled&&<p><strong>Network outreach is paused.</strong> Enable it in settings to resume.</p>}
     <button className={styles.secondary} type="button" onClick={edit}>{editing?'Close settings':data.settings?'Network settings':'Set up package emails'}</button>
     {editing&&<form className={styles.form} onSubmit={save}><label>Business mailing address<textarea required minLength={10} maxLength={300} value={address} onChange={e=>setAddress(e.target.value)} placeholder="Business name, street or PO box, city, state, ZIP"/><small>Displayed in package emails to matched buyers.</small></label><label className={styles.consent}><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/><span>Automatically send eligible network buyers my property packages while my bot is running. Normal email usage charges apply.</span></label><button className={styles.primary} disabled={busy}>{busy?'Saving…':'Save settings'}</button></form>}
     {data.buyers.length>0&&<div className={styles.interested}><h3>Buyer responses</h3>{data.buyers.map(b=><article key={b.id}><strong>{b.name} · {b.state==='interested'?'Interested':'Replied'}</strong><span>{b.address}</span>{b.reply&&<p>{b.reply}</p>}<a href={`mailto:${encodeURIComponent(b.email)}`}>{b.email}</a><button className={styles.quiet} type="button" disabled={busy} onClick={()=>void handled(b.id)}>Mark handled</button></article>)}<small>Confirm funds and signing authority before sending an assignment. Interest does not reserve the property.</small></div>}
     <p className={styles.fine}>Private buyer lists stay private. Only buyers who join the shared network are included.</p>
    </>}
   </>
  </div>
 </WorkspacePanel>;
}
