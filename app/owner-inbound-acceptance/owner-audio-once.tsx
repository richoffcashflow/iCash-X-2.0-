'use client';
import {useRef,useState} from 'react';
const endpoint='/api/owner-inbound-acceptance/audio-once';
type Status={status:string;canArm:boolean;canCancel?:boolean;canReconcile?:boolean;checks?:Record<string,boolean>;incomingDiagnostics?:Record<string,number|null>;configHash?:string;versionId?:string;expiresAt?:string;challenge?:string;result?:{status?:string;forwarding?:string;durationSeconds?:number|null;challenge?:string}};
export default function OwnerAudioOnce(){
 const [status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState(false),[consent,setConsent]=useState(false),[code,setCode]=useState<string|null>(null),[message,setMessage]=useState(''),[attempted,setAttempted]=useState(false);
 const active=useRef(false),armAttempted=useRef(false);
 async function run(action?:'arm'|'cancel'|'reconcile'){
  if(active.current||action==='arm'&&(!consent||!status?.canArm||armAttempted.current))return;
  if(action==='arm'){armAttempted.current=true;setAttempted(true);}active.current=true;setBusy(true);setMessage('');
  try{
   const body=action==='arm'?{action,confirmation:'Arm one 60-second owner audio test; provider fees may apply',configHash:status!.configHash,versionId:status!.versionId}:{action};
   const r=await fetch(endpoint,{method:action?'POST':'GET',cache:'no-store',credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(35000),...(action?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
   if(!r.ok)throw Error();const data:Status=await r.json();if(!data||typeof data.status!=='string'||typeof data.canArm!=='boolean')throw Error();
   const {challenge,...safe}=data;setStatus(safe);
   if(action==='arm'&&data.status==='armed'&&typeof challenge==='string'&&/^\d{8}$/.test(challenge))setCode(challenge);
   else if(!['armed','inspecting','claimed','provider_processing'].includes(data.status))setCode(null);
   setConsent(false);setMessage(action==='arm'?'Armed once. Call the displayed number now and say your code. The code cannot be recovered after leaving this page.':data.status==='passed'?'Audio and dashboard code verified. Forwarding status is shown separately.':'Status checked. No call was placed.');
  }catch{setMessage(action==='arm'?'The arm result is uncertain. Do not arm again. Check status; this test stays one-use.':'Status is unavailable. Leave the call on hold.');}
  finally{active.current=false;setBusy(false);}
 }
 return <section aria-label="One-use owner audio test" style={{maxWidth:650,margin:'2rem auto',padding:'1.5rem',lineHeight:1.6,border:'1px solid currentColor',borderRadius:12}}>
  <h2>One-use owner audio test</h2>
  <p>Call +1 424-394-8384 from your configured owner phone ending 5280 after arming. The AI conversation is capped at 60 seconds. Queue waiting may add up to 30 seconds. Provider fees may apply; forwarding pricing is unverified. Customer credits are not reserved or charged.</p>
  <p>This private test has no seller actions, outbound call, business tools or customer data. Audio recording is disabled; the provider may retain a transcript and usage metadata. Caller ID alone does not verify identity. Say the private dashboard code one digit at a time.</p>
  <button disabled={busy} onClick={()=>void run()}>Check one-use readiness</button>
  <p role="status">Status: {status?.status.replaceAll('_',' ')??'not checked'}</p>
  {status?.checks&&<ul>{Object.entries(status.checks).filter(([,ok])=>!ok).map(([name])=><li key={name}>Needs review: {name}</li>)}</ul>}
  {status?.incomingDiagnostics&&<details><summary>Read-only incoming Main diagnostics</summary><ul>{Object.entries(status.incomingDiagnostics).map(([key,value])=><li key={key}>{key}: {value??'unknown'}</li>)}</ul></details>}
  {status?.canArm&&!attempted&&<><label><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/> I approve this one owner-initiated test with the duration and provider-fee disclosures above</label><p><button disabled={busy||!consent} onClick={()=>void run('arm')}>Arm one test for five minutes</button></p></>}
  {code&&<p>Private test code: <strong>{code}</strong></p>}
  {status?.expiresAt&&<p>Call window ends {new Date(status.expiresAt).toLocaleString()}</p>}
  {status?.canCancel&&<button disabled={busy} onClick={()=>void run('cancel')}>Cancel unused test</button>}
  {status?.canReconcile&&<button disabled={busy} onClick={()=>void run('reconcile')}>Check completed audio result</button>}
  {status?.result&&<p>Audio result: {status.result.status}. Dashboard code: {status.result.challenge}. Forwarding evidence: {status.result.forwarding}. {typeof status.result.durationSeconds==='number'?`Conversation: ${status.result.durationSeconds} seconds.`:''}</p>}
  <p role="alert">{message}</p><p>Refresh, retry, expiry, cancellation or an uncertain result cannot create another allowance. A passed audio test does not certify forwarding or release business calling.</p>
 </section>;
}
