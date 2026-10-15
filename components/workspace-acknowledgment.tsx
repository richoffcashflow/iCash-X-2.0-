'use client';
import {useRef,useState} from 'react';
import {webinarRequest} from '@/lib/webinar-client';
import {workspaceAcknowledgmentVersion,workspaceAcknowledgmentTitle,workspaceAcknowledgmentSections,workspaceAcknowledgmentConsent} from '@/lib/workspace-acknowledgment-policy';

export function WorkspaceAcknowledgment({onAccepted,preview=false}:{onAccepted:()=>Promise<boolean>;preview?:boolean}){
 const [agreed,setAgreed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const inFlight=useRef(false);
 async function accept(){
  if(!agreed||inFlight.current)return;
  inFlight.current=true;setBusy(true);setError('');
  try{
   if(!preview){const receipt=await webinarRequest<{accepted:boolean;version:string}>('/api/account/workspace-acknowledgment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:workspaceAcknowledgmentVersion,accepted:true})});if(receipt.accepted!==true||receipt.version!==workspaceAcknowledgmentVersion)throw Error('Your acceptance could not be confirmed. Please try again.');}
   if(!await onAccepted())throw Error('Your acceptance is saved. Reconnect and try again to open your workspace.');
  }catch(error){setError(error instanceof Error?error.message:'Your acceptance could not be saved. Please try again.');}
  finally{inFlight.current=false;setBusy(false);}
 }
 return <section className="workspace-acknowledgment" aria-labelledby="workspace-ack-title">
  <span className="workspace-action-required">{preview?'Preview · Action required':'Action required'}</span>
  <h1 id="workspace-ack-title">{workspaceAcknowledgmentTitle}</h1>
  <p className="workspace-ack-intro">Please review this short acknowledgment before opening your workspace.</p>
  <div className="workspace-ack-terms">{workspaceAcknowledgmentSections.map(section=><section key={section.title}><h2>{section.title}</h2><p>{section.text}</p></section>)}</div>
  <div className="workspace-ack-links"><a href="/costs-and-disclosures" target="_blank" rel="noopener noreferrer">Full costs & disclosures</a><a href="/workspace-terms.txt" download>Save a copy</a></div>
  <label className="workspace-ack-checkbox"><input type="checkbox" checked={agreed} disabled={busy} onChange={e=>setAgreed(e.target.checked)}/><span>{workspaceAcknowledgmentConsent}</span></label>
  {error&&<p role="alert">{error}</p>}
  <button type="button" className="workspace-ack-accept" disabled={!agreed||busy} onClick={()=>void accept()}>{busy?'Saving your acceptance…':'I agree & open workspace'}</button>
  <p className="workspace-ack-footnote">{preview?'Preview only. This does not accept terms for your real account.':'Your acceptance is saved with your account, the document version and the date. You can download it from the account menu.'}</p>
 </section>;
}
