'use client';
import {useEffect,useRef,useState} from 'react';
import type {BuyerQualificationPayload,BuyerQualificationRow} from '@/lib/buyer-qualification';
import {confirmQualificationNavigation,qualificationDecision,qualificationPayload} from './buyer-qualification-form';
import styles from './buyer-qualification.module.css';

type Review={id:string;buyerId:string;dealId:string;state:string;payload:BuyerQualificationPayload;createdAt:string;expiresAt:string;decisionNote:string|null;notice:string};
type Queue={candidates?:{buyerId:string;name:string;qualificationState:string;expiresAt:string|null}[];requests:Review[];hasMore:boolean;notice:string};
async function response<T>(r:Response):Promise<T>{const data=await r.json();if(!r.ok)throw Error(data.error||'Could not complete this request. Refresh its status before retrying.');return data;}
function useQueue<T>(url:string){
 const [result,setResult]=useState<{url:string;data:T}|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[version,setVersion]=useState(0);
 useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');
  void fetch(url,{cache:'no-store',signal:controller.signal}).then(r=>{if(!controller.signal.aborted&&[401,403,404].includes(r.status))setResult(null);return response<T>(r);}).then(data=>{if(!controller.signal.aborted)setResult({url,data});}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not load buyer reviews.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[url,version]);
 return {data:result?.url===url?result.data:null,error,loading,refresh:()=>setVersion(v=>v+1)};
}
const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const status=(state:string)=>({submitted:'Waiting for review',needs_information:'More information needed',approved:'Reviewed',declined:'Not approved',revoked:'Withdrawn',expired:'Expired'}[state]??state.replaceAll('_',' '));
function Evidence({payload:p}:{payload:BuyerQualificationPayload}){return <dl><dt>Areas</dt><dd>{p.markets.join('; ')}</dd><dt>Property types</dt><dd>{p.propertyTypes.join(', ')}</dd><dt>Maximum price</dt><dd>{money(p.maxPriceCents)}</dd><dt>Maximum repairs</dt><dd>{money(p.maxRepairCents)}</dd><dt>Source</dt><dd>{p.sourceName}: {p.sourceReference}</dd><dt>Recorded</dt><dd>{new Date(p.criteriaObservedAt).toLocaleString()}</dd><dt>Buyer’s statement</dt><dd>{p.buyerStatement}</dd></dl>;}

export function BuyerQualificationPanel({dealId}:{dealId:string}){
 const [open,setOpen]=useState(false),[visited,setVisited]=useState(false);
 return <details className={styles.panel} onToggle={e=>{setOpen(e.currentTarget.open);if(e.currentTarget.open)setVisited(true);}}><summary>Buyer qualifications</summary>{visited&&<div hidden={!open}><CustomerBuyerReview key={dealId} dealId={dealId}/></div>}</details>;
}
function CustomerBuyerReview({dealId}:{dealId:string}){
 const [page,setPage]=useState(0),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[message,setMessage]=useState(''),[actionError,setActionError]=useState('');
 const queue=useQueue<Queue>(`/api/buyer-qualifications?dealId=${encodeURIComponent(dealId)}&page=${page}`);
 const request=useRef<{body:string;key:string}|null>(null),mutating=useRef(false);
 async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();if(mutating.current||queue.loading||queue.error)return;const form=e.currentTarget;mutating.current=true;setBusy(true);setActionError('');
  try{const payload=qualificationPayload(new FormData(form),dealId),body=JSON.stringify(payload);if(request.current?.body!==body)request.current={body,key:crypto.randomUUID()};
   const result=await response<{message:string}>(await fetch('/api/buyer-qualifications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idempotencyKey:request.current.key,payload})}));
   request.current=null;form.reset();setDirty(false);setMessage(result.message);setPage(0);queue.refresh();
  }catch(e){setActionError(e instanceof Error?e.message:'Could not save. Your entries are still here.');}finally{mutating.current=false;setBusy(false);}
 }
 async function withdraw(id:string){if(mutating.current||queue.loading||queue.error)return;mutating.current=true;setBusy(true);setActionError('');try{const result=await response<{message:string}>(await fetch('/api/buyer-qualifications',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:id})}));setMessage(result.message);queue.refresh();}catch(e){setActionError(e instanceof Error?e.message:'Refresh the request before trying again.');}finally{mutating.current=false;setBusy(false);}}
 const blocked=busy||queue.loading||!!queue.error;
 function changePage(next:number){if(!confirmQualificationNavigation(dirty,text=>window.confirm(text)))return;setDirty(false);setPage(next);}
 return <section aria-label="Buyer qualification requests" data-unsaved-draft={dirty?'true':undefined}>
  <p className={styles.notice}>Save what a buyer actually told you. A qualified reviewer must check the source, funds and signing authority. Submitting this form does not verify a buyer or grant permission to contact them.</p>
  {(queue.error||actionError)&&<p role="alert" className={styles.error}>{actionError||queue.error}</p>}{message&&<p role="status" className={styles.notice}>{message}</p>}
  <button type="button" disabled={busy||queue.loading} onClick={queue.refresh}>Refresh buyer status</button>
  {queue.loading&&!queue.data&&<p role="status">Loading buyer reviews…</p>}
  {queue.data&&<>
   {queue.data.requests.length===0&&<p>No buyer review requests yet.</p>}
   {queue.data.requests.map(row=><article className={styles.card} key={row.id}><p className={styles.status}>{status(row.state)}</p><p>{row.notice}</p>{row.decisionNote&&<p>Reviewer: {row.decisionNote}</p>}<details><summary>Review the saved evidence</summary><Evidence payload={row.payload}/></details><p className={styles.muted}>Expires {new Date(row.expiresAt).toLocaleString()}</p>{!['revoked','declined','expired'].includes(row.state)&&<button type="button" disabled={blocked} onClick={()=>void withdraw(row.id)}>Withdraw this buyer review</button>}</article>)}
   <nav className={styles.paging} aria-label="Buyer review pages">{page>0&&<button disabled={blocked} onClick={()=>changePage(page-1)}>Previous reviews</button>}{queue.data.hasMore&&<button disabled={blocked} onClick={()=>changePage(page+1)}>More reviews</button>}</nav>
   {!queue.data.candidates?.length?<p className={styles.notice}>Buyer research has not returned any available profiles for this deal yet. No qualified buyer match is confirmed.</p>:<details className={styles.card}><summary>Add buyer evidence</summary><p>Use dated references a reviewer can check. Do not paste bank account numbers, passwords or payment details. Dates below use your local time.</p>
    <form onSubmit={submit} onChange={()=>setDirty(true)}><fieldset disabled={busy}>
     <label>Buyer profile<select name="buyerId" required defaultValue=""><option value="">Choose a researched buyer</option>{queue.data.candidates.map(b=><option key={b.buyerId} value={b.buyerId}>{b.name} · {status(b.qualificationState)}</option>)}</select></label>
     <label>Areas this buyer wants (one per line)<textarea name="markets" required maxLength={1000} placeholder="Dallas, TX"/></label>
     <fieldset><legend>Property types</legend><label className={styles.check}><input type="checkbox" name="propertyTypes" value="house"/> Houses</label><label className={styles.check}><input type="checkbox" name="propertyTypes" value="land"/> Land</label></fieldset>
     <div className={styles.grid}><label>Maximum purchase price ($)<input name="maxPrice" inputMode="decimal" required pattern="[0-9]+(\.[0-9]{1,2})?"/></label><label>Maximum repairs ($)<input name="maxRepairs" inputMode="decimal" required pattern="[0-9]+(\.[0-9]{1,2})?"/><small>Enter 0 only if the buyer accepts no repairs.</small></label></div>
     <label>Evidence source<input name="sourceName" required minLength={3} maxLength={120} placeholder="Buyer interview or written criteria"/></label>
     <label>Source reference<textarea name="sourceReference" required minLength={12} maxLength={1000} placeholder="Identify the dated record and how a reviewer can verify it"/></label>
     <label>Buyer’s actual statement<textarea name="buyerStatement" required minLength={12} maxLength={4000}/></label>
     <div className={styles.grid}><label>When were these criteria recorded?<input name="observedAt" type="datetime-local" required/></label><label>Expiry (no more than 30 days after the evidence)<input name="expiresAt" type="datetime-local" required/></label></div>
     <button className={styles.primary} disabled={blocked}>{busy?'Saving…':'Submit for human review'}</button>
    </fieldset></form>
   </details>}
  </>}
 </section>;
}

export function BuyerQualificationDashboard(){
 const [page,setPage]=useState(0);const queue=useQueue<{requests:BuyerQualificationRow[];hasMore:boolean;notice:string}>(`/api/buyer-qualifications/admin?page=${page}`);
 const container=useRef<HTMLElement>(null);
 const dirty=()=>!!container.current?.querySelector('[data-unsaved-draft="true"]');
 function canLeave(){return confirmQualificationNavigation(dirty(),text=>window.confirm(text));}
 function changePage(next:number){if(canLeave())setPage(next);}
 useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(container.current?.querySelector('[data-unsaved-draft="true"]')){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[]);
 return <section ref={container} className={`${styles.panel} ${styles.page}`} aria-label="Buyer review desk"><header className={styles.header}><h1>Buyer evidence reviews</h1><a href="/support/admin" onClick={event=>{if(!canLeave())event.preventDefault();}}>Support desk</a></header><p className={styles.notice}>This desk requires a separately authorized authority reviewer. Support access alone cannot approve a buyer. Review actual evidence yourself; no external verification is performed by this form.</p>
  <button disabled={queue.loading} onClick={queue.refresh}>Refresh reviews</button>{queue.error&&<p role="alert" className={styles.error}>{queue.error}</p>}{queue.loading&&!queue.data&&<p role="status">Loading reviews…</p>}
  {queue.data&&<><p>{queue.data.notice}</p>{queue.error&&<p>Showing the last loaded page. Review actions are disabled until a refresh succeeds.</p>}{queue.data.requests.length===0&&<p>No buyer evidence requests in this page.</p>}{queue.data.requests.map(row=><OperatorBuyerReview key={row.id} row={row} onSaved={queue.refresh} loading={queue.loading||!!queue.error}/>)}<nav className={styles.paging} aria-label="Operator review pages">{page>0&&<button disabled={queue.loading||!!queue.error} onClick={()=>changePage(page-1)}>Previous</button>}{queue.data.hasMore&&<button disabled={queue.loading||!!queue.error} onClick={()=>changePage(page+1)}>Next</button>}</nav></>}
 </section>;
}
function OperatorBuyerReview({row,onSaved,loading}:{row:BuyerQualificationRow;onSaved:()=>void;loading:boolean}){
 const [decision,setDecision]=useState('needs_information'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[dirty,setDirty]=useState(false);
 const pending=useRef(false);
 async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();if(pending.current||loading)return;const form=e.currentTarget;pending.current=true;setBusy(true);setError('');try{const payload=qualificationDecision(new FormData(form),row.id);const result=await response<{message:string}>(await fetch('/api/buyer-qualifications/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}));setMessage(result.message);setDirty(false);setDecision('needs_information');form.reset();onSaved();}catch(e){setError(e instanceof Error?e.message:'Review could not be confirmed. Refresh its status before retrying.');}finally{pending.current=false;setBusy(false);}}
 return <article className={styles.card} data-unsaved-draft={dirty?'true':undefined}><h2>{status(row.state)}</h2><p className={styles.muted}>Account {row.account_id} · Deal {row.deal_id} · Request {row.id}</p><Evidence payload={row.payload}/>{row.decision_note&&<p>Prior review: {row.decision_note}</p>}<p>Expires {new Date(row.expires_at).toLocaleString()}</p>
  <details><summary>Record a review decision</summary><p>References only: do not paste bank details or credentials. Dates use your local time.</p><form onSubmit={submit} onChange={()=>setDirty(true)}><fieldset disabled={busy||loading}>
   <label>Decision<select name="decision" value={decision} onChange={e=>setDecision(e.target.value)}><option value="needs_information">Request more information</option><option value="approved">Approve reviewed evidence</option><option value="declined">Decline</option><option value="revoked">Revoke prior review</option></select></label>
   <label>Review note<textarea name="note" required minLength={12} maxLength={1000}/></label>
   {decision==='approved'&&<>
    <label className={styles.check}><input name="criteriaConfirmed" type="checkbox" required/> I checked the buyer’s actual current criteria and source record.</label>
    <label className={styles.check}><input name="fundsVerified" type="checkbox" required/> I reviewed valid evidence of funds for the stated amount.</label>
    <label className={styles.check}><input name="signatoryVerified" type="checkbox" required/> I verified the named person’s authority to sign for this buyer.</label>
    <label>Review record reference<textarea name="reviewReference" required minLength={12} maxLength={1000}/></label>
    <label>Funds evidence reference<textarea name="fundsReference" required minLength={12} maxLength={1000}/></label>
    <div className={styles.grid}><label>Verified funds ($ USD)<input name="fundsAmount" inputMode="decimal" required pattern="[0-9]+(\.[0-9]{1,2})?"/></label><label>Funds evidence recorded at<input name="fundsObservedAt" type="datetime-local" required/></label></div>
    <label>Authorized signatory’s name<input name="signatoryName" required minLength={2} maxLength={200}/></label>
    <label>Signing authority evidence reference<textarea name="authorityReference" required minLength={12} maxLength={1000}/></label>
    <div className={styles.grid}><label>Authority evidence recorded at<input name="authorityObservedAt" type="datetime-local" required/></label><label>Review valid until<input name="validUntil" type="datetime-local" required/></label></div>
   </>}
   <button className={styles.primary}>{busy?'Recording…':'Record decision'}</button>
  </fieldset></form></details>{error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.notice}>{message}</p>}
 </article>;
}
