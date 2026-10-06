"use client";
import {useEffect,useRef,useState} from 'react';
import type {CustomerIdentity as Identity} from '@/lib/customer-identity';
export function CustomerIdentity({identity,onSaved,onboarding=false}:{identity:Identity|null;onSaved:()=>void;onboarding?:boolean}){
 const [kind,setKind]=useState<'person'|'company'>(identity?.company_name?'company':'person');
 const [first,setFirst]=useState(identity?.first_name??''),[last,setLast]=useState(identity?.last_name??''),[company,setCompany]=useState(identity?.company_name??'');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const edited=useRef(false),saving=useRef(false);
 useEffect(()=>{if(identity)return;const controller=new AbortController();void fetch('/api/account/identity',{cache:'no-store',signal:controller.signal}).then(async r=>r.ok?r.json():null).then(data=>{if(data?.firstName&&!edited.current&&!controller.signal.aborted)setFirst(data.firstName);}).catch(()=>{});return()=>controller.abort();},[identity]);
 async function save(e:React.FormEvent){e.preventDefault();if(saving.current)return;saving.current=true;setBusy(true);setMessage('');setError('');try{const r=await fetch('/api/account/identity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({first_name:kind==='person'?first:'',last_name:kind==='person'?last:'',company_name:kind==='company'?company:''}),signal:AbortSignal.timeout(20000)});const result=await r.json();if(!r.ok)throw Error(result.error||'Could not save. Please try again.');edited.current=false;setMessage('Saved.');onSaved();}catch(e){setError(e instanceof Error?e.message:'Could not save. Please try again.');}finally{saving.current=false;setBusy(false);}}
 return <form className="account-access buyer-identity" onSubmit={save} data-unsaved-draft={edited.current?'true':undefined}>
  {onboarding&&<><h2>Who will your bot represent?</h2><p>Use your company or your own name.</p></>}
  <fieldset disabled={busy} className="identity-choice"><legend className="sr-only">Buying as</legend><label><input type="radio" name={onboarding?'setup-identity':'settings-identity'} checked={kind==='person'} onChange={()=>{edited.current=true;setKind('person');}}/>Individual</label><label><input type="radio" name={onboarding?'setup-identity':'settings-identity'} checked={kind==='company'} onChange={()=>{edited.current=true;setKind('company');}}/>Company</label></fieldset>
  {kind==='company'?<label>Company name<input autoComplete="organization" required maxLength={160} disabled={busy} value={company} onChange={e=>{edited.current=true;setCompany(e.target.value);}}/></label>:<div className="identity-name-row"><label>First name<input autoComplete="given-name" required maxLength={80} disabled={busy} value={first} onChange={e=>{edited.current=true;setFirst(e.target.value);}}/></label><label>Last name<input autoComplete="family-name" required maxLength={80} disabled={busy} value={last} onChange={e=>{edited.current=true;setLast(e.target.value);}}/></label></div>}
  <button className="fund-button full" disabled={busy}>{busy?'Saving…':onboarding?'Continue':'Save details'}</button>
  {onboarding&&<small>You can change this in Settings.</small>}{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 </form>;
}
