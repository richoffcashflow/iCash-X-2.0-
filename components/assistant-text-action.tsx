'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {smsLength} from '@/lib/sms-length';
import {textStateLabel} from '@/lib/text-send-state';
type Preview={address:string;party:string;body:string;reason:string|null;latest:{body:string;direction:string;state:string}|null;receipt:{id:string;body:string;request_key:string;state:string}|null};
export function AssistantTextAction({questionId,actionIndex,stale,onConversation,onClose}:{questionId:string;actionIndex:number;stale:boolean;onConversation:()=>void;onClose:()=>void}){
 const [preview,setPreview]=useState<Preview|null>(null),[body,setBody]=useState(''),[busy,setBusy]=useState(false),[checking,setChecking]=useState(true),[uncertain,setUncertain]=useState(false),[error,setError]=useState('');
 const key=useRef<string|null>(null),locked=useRef(false),alive=useRef(true),edited=useRef(false);
 const url='/api/work/assistant/actions?'+new URLSearchParams({questionId,actionIndex:String(actionIndex)});
 const refresh=useCallback(async()=>{
  try{const r=await fetch(url,{cache:'no-store'});const p=await r.json();if(!r.ok)throw Error(p.error);if(!alive.current)return;
   setPreview(p);if(p.receipt){key.current=p.receipt.request_key;setBody(p.receipt.body);}else if(!edited.current)setBody(p.body);
   setUncertain(!!p.receipt&&['dispatching','needs_review'].includes(p.receipt.state));setError('');
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not check the saved action.');}
  finally{if(alive.current)setChecking(false);}
 },[url]);
 useEffect(()=>{alive.current=true;void refresh();return()=>{alive.current=false;};},[refresh]);
 useEffect(()=>{if(!uncertain)return;const timer=setInterval(()=>void refresh(),5000);return()=>clearInterval(timer);},[uncertain,refresh]);
 const state=preview?.receipt?.state;
 const finished=!!state&&['accepted','sent','delivered','cancelled','failed'].includes(state);
 async function send(){
  if(locked.current||stale||checking||uncertain||finished||preview?.reason||!body.trim()||!smsLength(body.trim()).fits)return;
  locked.current=true;edited.current=true;setBusy(true);setError('');key.current??=crypto.randomUUID();
  try{
   const r=await fetch('/api/work/assistant/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({questionId,actionIndex,requestKey:key.current,message:body.trim()})});const result=await r.json();
   if(!alive.current)return;
   if(!r.ok&&!result.notSent){setUncertain(true);throw Error(result.error);}
   if(result.notSent)setError(result.error??'Text not sent. Check the saved action.');
   else setUncertain(true);
   await refresh();
  }catch(e){if(alive.current){setUncertain(true);setError(e instanceof Error?e.message:'Checking the original delivery before another attempt.');}}
  finally{locked.current=false;if(alive.current)setBusy(false);}
 }
 return <section className="assistant-text-action" aria-label="Review and send reply" data-unsaved-draft={edited.current&&!preview?.receipt?'true':undefined}>
  <header><div><strong>Review {preview?.party==='buyer'?'buyer':'seller'} reply</strong><p>{preview?.address??'Checking the conversation…'}</p></div><button type="button" disabled={busy} onClick={onClose}>Close</button></header>
  {preview?.latest&&<div className="assistant-action-latest"><small>Latest saved message · {preview.latest.direction==='incoming'?'Received':textStateLabel(preview.latest.state)}</small><p>{preview.latest.body}</p></div>}
  <label>Message<textarea value={body} maxLength={160} disabled={checking||busy||uncertain||!!preview?.receipt||stale} onChange={e=>{edited.current=true;setBody(e.target.value);}}/></label>
  <small>{smsLength(body).fits?body.length+' / 160 characters':'Shorten this reply to fit one text.'}</small>
  <p>Sending puts this property under your control. Open the property’s bot controls when you’re ready to return it to the bot.</p>
  {preview?.reason&&!finished&&<p role="status">{preview.reason}</p>}
  {(state||uncertain)&&<p role="status">{uncertain?'Confirming the original delivery…':state==='accepted'||state==='sent'?'Sent. Delivery confirmation pending.':state==='delivered'?'Delivered.':state==='ready'?'Not sent. The saved text can be retried.':'Not delivered. Review the conversation before preparing another reply.'}</p>}
  {error&&<p role="alert">{error}</p>}
  <div className="assistant-answer-actions"><button type="button" disabled={!preview||stale||busy||checking||uncertain||finished||!!preview.reason||!body.trim()||!smsLength(body.trim()).fits} onClick={()=>void send()}>{busy?'Sending…':state==='ready'?'Retry saved text':'Send reply'}</button><button type="button" disabled={busy} onClick={onConversation}>Open conversation</button><button type="button" disabled={busy} onClick={()=>void refresh()}>Check status</button></div>
 </section>;
}
