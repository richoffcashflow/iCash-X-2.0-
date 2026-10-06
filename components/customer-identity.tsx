"use client";
import {useEffect,useRef,useState} from 'react';
import type {CustomerIdentity as Identity} from '@/lib/customer-identity';
type Contact={email:string;phone:string;pendingEmail?:string|null};
export function CustomerIdentity({identity,onSaved,onboarding=false,contact}:{identity:Identity|null;onSaved:()=>void;onboarding?:boolean;contact?:Contact}){
 const [kind,setKind]=useState<'person'|'company'>(identity?.company_name?'company':'person');
 const [first,setFirst]=useState(identity?.first_name??''),[last,setLast]=useState(identity?.last_name??''),[company,setCompany]=useState(identity?.company_name??'');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [email,setEmail]=useState(contact?.pendingEmail||contact?.email||''),[phone,setPhone]=useState(contact?.phone??''),[pendingEmail,setPendingEmail]=useState(contact?.pendingEmail??null);
 const edited=useRef(false),saving=useRef(false);
 useEffect(()=>{if(edited.current||saving.current)return;setFirst(identity?.first_name??'');setLast(identity?.last_name??'');setCompany(identity?.company_name??'');setKind(identity?.company_name?'company':'person');},[identity?.first_name,identity?.last_name,identity?.company_name]);
 useEffect(()=>{setPendingEmail(contact?.pendingEmail??null);if(!edited.current&&!saving.current){setEmail(contact?.pendingEmail||contact?.email||'');setPhone(contact?.phone??'');}},[contact?.email,contact?.phone,contact?.pendingEmail]);
 useEffect(()=>{if(identity)return;const controller=new AbortController();void fetch('/api/account/identity',{cache:'no-store',signal:controller.signal}).then(async r=>r.ok?r.json():null).then(data=>{if(data?.firstName&&!edited.current&&!controller.signal.aborted)setFirst(data.firstName);}).catch(()=>{});return()=>controller.abort();},[identity]);
 async function save(e:React.FormEvent){
  e.preventDefault();if(saving.current)return;saving.current=true;setBusy(true);setMessage('');setError('');let saved=false;
  try{
   const r=await fetch('/api/account/identity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({first_name:kind==='person'?first:'',last_name:kind==='person'?last:'',company_name:kind==='company'?company:'',...(contact?{phone}:{})}),signal:AbortSignal.timeout(20000)});
   const result=await r.json();if(!r.ok)throw Error(result.error||'Could not save. Please try again.');saved=true;if(typeof result.phone==='string')setPhone(result.phone);
   setMessage(result.smsUpdatesPaused?'Saved. Turn text updates back on for your new number in Updates.':'Saved.');
   if(contact&&email.trim().toLowerCase()!==contact.email.toLowerCase()){
    const response=await fetch('/api/account/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email}),signal:AbortSignal.timeout(20000)});
    const change=await response.json();if(!response.ok)throw Error(`Your name and phone are saved. ${change.error||'Please retry the email change.'}`);
    setPendingEmail(change.pendingEmail??null);setEmail(change.pendingEmail||change.email);setMessage(change.pendingEmail?'Name and phone saved. Confirm your email change from your inbox.':'Saved.');
   }
   edited.current=false;
  }catch(e){setError(e instanceof Error?e.message:'Could not save. Please try again.');}
  finally{saving.current=false;setBusy(false);if(saved)onSaved();}
 }
 return <form className="account-access buyer-identity" onSubmit={save} data-unsaved-draft={edited.current?'true':undefined}>
  {onboarding&&<><h2>Who will your bot represent?</h2><p>Use your company or your own name.</p></>}
  {contact&&<><label>Email<input type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={320} disabled={busy} value={email} onChange={e=>{edited.current=true;setEmail(e.target.value);}}/></label>{pendingEmail&&<p className="account-confirmation" role="status">Confirm {pendingEmail} using the link sent to your inbox. Check your current inbox too. Until confirmed, keep signing in with {contact.email}.</p>}<label>Phone<input type="tel" autoComplete="tel" maxLength={40} disabled={busy} value={phone} onChange={e=>{edited.current=true;setPhone(e.target.value);}}/></label></>}
  <fieldset disabled={busy} className="identity-choice"><legend className="sr-only">Buying as</legend><label><input type="radio" name={onboarding?'setup-identity':'settings-identity'} checked={kind==='person'} onChange={()=>{edited.current=true;setKind('person');}}/>Individual</label><label><input type="radio" name={onboarding?'setup-identity':'settings-identity'} checked={kind==='company'} onChange={()=>{edited.current=true;setKind('company');}}/>Company</label></fieldset>
  {kind==='company'?<label>Company name<input autoComplete="organization" required maxLength={160} disabled={busy} value={company} onChange={e=>{edited.current=true;setCompany(e.target.value);}}/></label>:<div className="identity-name-row"><label>First name<input autoComplete="given-name" required maxLength={80} disabled={busy} value={first} onChange={e=>{edited.current=true;setFirst(e.target.value);}}/></label><label>Last name<input autoComplete="family-name" required maxLength={80} disabled={busy} value={last} onChange={e=>{edited.current=true;setLast(e.target.value);}}/></label></div>}
  <button className="fund-button full" disabled={busy}>{busy?'Saving…':onboarding?'Continue':'Save details'}</button>
  {onboarding&&<small>You can change this in Settings.</small>}{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 </form>;
}
