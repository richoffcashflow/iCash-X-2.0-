"use client";
import {useEffect,useRef,useState} from 'react';
import type {CustomerIdentity as Identity} from '@/lib/customer-identity';
export function CustomerIdentity({identity,onSaved}:{identity:Identity|null;onSaved:()=>void}){
 const [first,setFirst]=useState(identity?.first_name??''),[last,setLast]=useState(identity?.last_name??''),[company,setCompany]=useState(identity?.company_name??'');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const edited=useRef(false);
 useEffect(()=>{if(identity)return;const controller=new AbortController();void fetch('/api/account/identity',{cache:'no-store',signal:controller.signal}).then(async r=>r.ok?r.json():null).then(data=>{if(data?.firstName&&!edited.current&&!controller.signal.aborted)setFirst(data.firstName);}).catch(()=>{});return()=>controller.abort();},[identity]);
 async function save(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage('');try{const r=await fetch('/api/account/identity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({first_name:first,last_name:last,company_name:company})});const result=await r.json();if(!r.ok)throw Error(result.error);setMessage('Saved. Your bot knows who it represents.');onSaved();}catch(e){setMessage(e instanceof Error?e.message:'Could not save. Please try again.');}finally{setBusy(false);}}
 return <form className="account-access" onSubmit={save} style={{textAlign:'left'}}><p>Your bot will work on behalf of:</p><label>First name<input autoComplete="given-name" required maxLength={80} value={first} onChange={e=>{edited.current=true;setFirst(e.target.value);}}/></label><label>Last name<input autoComplete="family-name" required maxLength={80} value={last} onChange={e=>setLast(e.target.value)}/></label><label>Company name <span>(optional)</span><input autoComplete="organization" maxLength={160} value={company} onChange={e=>setCompany(e.target.value)}/></label><p>{company.trim()||`${first.trim()} ${last.trim()}`.trim()||'No company? We’ll use your name.'}</p><button className="fund-button full" disabled={busy}>{busy?'Saving…':'Save details'}</button>{message&&<p role="status">{message}</p>}</form>;
}
