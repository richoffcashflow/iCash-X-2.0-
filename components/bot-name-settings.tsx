'use client';
import {useEffect,useRef,useState} from 'react';
export function BotNameSettings({initialName,onSaved}:{initialName:string;onSaved:()=>Promise<unknown>}){
 const [name,setName]=useState(initialName),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const locked=useRef(false);
 useEffect(()=>{setName(initialName);},[initialName]);
 async function save(){
  if(locked.current)return;locked.current=true;setBusy(true);setMessage('');
  try{
   const r=await fetch('/api/account/bot-name',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name}),signal:AbortSignal.timeout(15000)});
   const data=await r.json();if(!r.ok)throw Error(data.error||'Could not save your bot name.');
   setName(data.name);setMessage('Bot name saved.');await onSaved();
  }catch(e){setMessage(e instanceof Error?e.message:'Could not save. Please try again.');}
  finally{locked.current=false;setBusy(false);}
 }
 return <form className="bot-name-settings" onSubmit={e=>{e.preventDefault();void save();}}>
  <label htmlFor="workspace-bot-name">Bot name</label>
  <p>Choose the name shown in your workspace.</p>
  <input id="workspace-bot-name" autoComplete="off" value={name} onChange={e=>setName(e.target.value)} maxLength={64} required disabled={busy}/>
  <button type="submit" className="fund-button" disabled={busy||!name.trim()||name.trim()===initialName}>{busy?'Saving…':'Save bot name'}</button>
  {message&&<p role="status">{message}</p>}
 </form>;
}
