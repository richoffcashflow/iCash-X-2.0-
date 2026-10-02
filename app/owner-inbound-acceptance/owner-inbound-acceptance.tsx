'use client';
import {useEffect,useRef,useState} from 'react';
const confirmation='Reserve the displayed USD cap and arm one private 60-second inbound audio test';
type Status={status:string;canArm:boolean;configId?:string;quoteCapCents?:number;rateEvidenceHash?:string;runId?:string;expiresAt?:string;reservedCents?:number;actualCostCents?:number|null;canCancel?:boolean;canReconcile?:boolean;sourcePhone?:string;ownerPhone?:string;challenge?:string};
const usd=(c:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100);
export default function OwnerInboundAcceptance(){
 const [status,setStatus]=useState<Status|null>(null),[code,setCode]=useState<string|null>(null),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[attempted,setAttempted]=useState(false),[message,setMessage]=useState('');
 const submitting=useRef(false);
 async function refresh(){if(submitting.current)return;setBusy(true);try{const r=await fetch('/api/owner-inbound-acceptance',{cache:'no-store',credentials:'same-origin'});if(!r.ok)throw Error();const data:Status=await r.json();setStatus(data);if(!['armed','inspecting','claimed','provider_processing'].includes(data.status))setCode(null);setMessage('');}catch{setStatus(null);setCode(null);setMessage('Sign in to the configured owner account. If status is still unavailable, leave the test on hold.');}finally{setBusy(false);}}
 useEffect(()=>{void refresh();},[]);
 useEffect(()=>{if(!code||!status?.expiresAt)return;const clear=()=>setCode(null),timer=setTimeout(clear,Math.max(0,Date.parse(status.expiresAt)-Date.now()));window.addEventListener('pagehide',clear);return ()=>{clearTimeout(timer);window.removeEventListener('pagehide',clear);};},[code,status?.expiresAt]);
 async function action(kind:'arm'|'cancel'|'reconcile'){
  if(submitting.current||!status||(kind==='arm'&&(!confirmed||attempted||!status.canArm)))return;
  if(kind!=='arm'&&!status.runId)return;
  submitting.current=true;setBusy(true);setMessage('');if(kind==='arm')setAttempted(true);
  if(kind==='cancel')setCode(null);
  const body=kind==='arm'?{action:kind,confirmation,configId:status.configId,quoteCapCents:status.quoteCapCents,rateEvidenceHash:status.rateEvidenceHash}:{action:kind,runId:status.runId};
  try{const r=await fetch('/api/owner-inbound-acceptance',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error();const data:Status=await r.json();const {challenge,...safeStatus}=data;setStatus(safeStatus);if(kind==='arm'&&data.status==='armed')setCode(challenge??null);else if(!['inspecting','claimed','provider_processing'].includes(data.status))setCode(null);setMessage(kind==='arm'?'The single-use window is armed. The code is shown only here and cannot be recovered after leaving this page.':data.status==='passed'?'The provider receipts and your spoken code passed this private audio test. This does not release business calling.':data.status==='provider_processing'?'The providers are still processing this call. Check the result after it ends.':'The test stays consumed. No automatic retry occurs.');}
  catch{setCode(null);setStatus(null);setMessage('The outcome needs review. Do not try to arm again. Use Check status.');}
  finally{submitting.current=false;setBusy(false);}
 }
 return <main style={{maxWidth:650,margin:'3rem auto',padding:'1.5rem',lineHeight:1.6}}>
  <h1>Private inbound audio test</h1>
  <p>One incoming AI audio test from the configured owner phone. The window lasts five minutes and the AI conversation is capped at 60 seconds. Carrier setup or other network time may be additional; the reviewed spending cap must cover it. There are at most three spoken code attempts. Audio recording is disabled; providers may retain a transcript and usage metadata.</p>
  <p>This test has no customer data, business tools, offers, messages, callbacks or transfers. Caller ID alone cannot pass the test. The challenge is checked against a transcript fetched directly from the provider.</p>
  <p role="status">Status: {status?.status.replaceAll('_',' ')??'unavailable'}</p>
  {status?.quoteCapCents!==undefined&&<p>One-time test spending cap: <strong>{usd(status.quoteCapCents)}</strong>. This amount is reserved from your iCash X wallet before arming. Usage is settled only with verified provider cost evidence. An uncertain result keeps the reservation on hold for review.</p>}
  {status?.reservedCents!==undefined&&<p>Reserved: {usd(status.reservedCents)}{status.actualCostCents!==null&&status.actualCostCents!==undefined?` · Settled: ${usd(status.actualCostCents)}`:''}</p>}
  {code&&<section aria-label="One-use private test challenge"><h2>Your one-use code</h2><p style={{fontSize:'2rem',letterSpacing:'.2em',fontVariantNumeric:'tabular-nums'}}>{code}</p><p>Call {status?.sourcePhone} from your configured owner phone and say these eight digits when asked. Do not enter or share the code elsewhere.</p></section>}
  {status?.expiresAt&&<p>Window expires: {new Date(status.expiresAt).toLocaleString()}</p>}
  <label><input type="checkbox" checked={confirmed} disabled={busy||attempted||!status?.canArm} onChange={e=>setConfirmed(e.target.checked)}/> I approve the displayed one-time USD cap and want to arm this single-use audio test</label>
  <div style={{display:'flex',gap:12,flexWrap:'wrap',marginTop:16}}><button disabled={busy||attempted||!confirmed||!status?.canArm} onClick={()=>void action('arm')}>Approve cost and arm once</button><button disabled={busy} onClick={()=>void refresh()}>Check status</button>{status?.canReconcile&&<button disabled={busy} onClick={()=>void action('reconcile')}>Verify completed call</button>}{status?.canCancel&&<button disabled={busy} onClick={()=>void action('cancel')}>Cancel this test</button>}</div>
  <p role="alert">{message}</p><p>Canceling before any incoming attempt releases the reservation. Once an incoming attempt starts, canceling consumes the test and holds its cost for review; it cannot hang up an active provider call. A failed, expired or uncertain test is never automatically re-armed.</p>
  <a href="/">Back to workspace</a>
 </main>;
}
