'use client';
import {useEffect,useRef,useState} from 'react';
import {defaultBotProfile,setupProfileSchema,type BotProfile,type BotSetup} from '@/lib/bot-setup';
import {saveBotBuild} from '@/lib/bot-build';

export function PostPaymentBotName({onBrand,onCreated}:{onBrand:(profile:BotProfile)=>void;onCreated:()=>Promise<void>}){
 const [name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const locked=useRef(false),controller=useRef<AbortController|null>(null),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
 async function create(){
  if(locked.current)return;
  const profile=setupProfileSchema.safeParse({...defaultBotProfile,displayName:name.trim()});
  if(!profile.success){setError('Enter a name for your bot.');return;}
  locked.current=true;setBusy(true);setError('');const request=new AbortController();controller.current=request;
  const timer=setTimeout(()=>request.abort(),20000);
  try{
   const r=await fetch('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'init'}),signal:request.signal});
   const data:{setup?:BotSetup;error?:string}=await r.json();if(!r.ok||!data.setup)throw Error(data.error||'Could not create your bot. Please retry.');
   const current=data.setup;
   const saved=await saveBotBuild({...defaultBotProfile,...current.profile,displayName:profile.data.displayName,theme:'ink',aiLogo:null},current,{retry:false,signal:request.signal,editedFields:['displayName']});
   if(!mounted.current)return;
   onBrand({...defaultBotProfile,...saved.profile});await onCreated();
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Could not save. Please retry.');}
  finally{clearTimeout(timer);locked.current=false;if(mounted.current)setBusy(false);}
 }
 return <section className="post-payment-name" aria-labelledby="bot-name-title"><h2 id="bot-name-title">{busy?'Creating your bot…':'Name your bot'}</h2><form onSubmit={e=>{e.preventDefault();void create();}}><label className="sr-only" htmlFor="paid-bot-name">Bot name</label><input id="paid-bot-name" autoComplete="off" maxLength={64} placeholder="Bot name" value={name} disabled={busy} onChange={e=>{setName(e.target.value);setError('');}} required/><button disabled={busy||!name.trim()}>{busy?'Creating…':'Create & start bot'}</button></form>{error&&<p role="alert">{error}</p>}</section>;
}
