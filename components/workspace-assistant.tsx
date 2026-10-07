'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowUp,ChevronDown,MessageCircle,Sparkles,X} from 'lucide-react';
import type {AssistantAction,AssistantAnswer} from '@/lib/workspace-assistant-policy';
export type AssistantRequest={screeningId:string;address:string;nonce:number};
type Reply={id:string;question:string;answer:AssistantAnswer|null;state:string;created_at:string};
type Props={request:AssistantRequest|null;stale:boolean;onAction:(action:AssistantAction)=>Promise<void>|void};
const suggestions=['What happened today?','What needs me?','What is my bot doing?'];
export function WorkspaceAssistant({request,stale,onAction}:Props){
 const [open,setOpen]=useState(false),[question,setQuestion]=useState(''),[items,setItems]=useState<Reply[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(false),[context,setContext]=useState<AssistantRequest|null>(null),[actionBusy,setActionBusy]=useState(false);
 const inFlight=useRef(false),loaded=useRef(false),alive=useRef(true),handled=useRef<number|null>(null),input=useRef<HTMLInputElement>(null),end=useRef<HTMLDivElement>(null),controller=useRef<AbortController|null>(null);
 const pending=useRef<{requestId:string;question:string;screeningId?:string}|null>(null);
 useEffect(()=>{alive.current=true;const selected=new URLSearchParams(window.location.search).get('assistant');if(selected)setOpen(true);return()=>{alive.current=false;controller.current?.abort();};},[]);
 async function history(){setLoading(true);try{const id=new URLSearchParams(window.location.search).get('assistant');const r=await fetch('/api/work/assistant'+(id?'?id='+encodeURIComponent(id):''),{cache:'no-store'});const value=await r.json();if(!r.ok)throw Error(value.error);if(alive.current){setItems(previous=>{const merged=new Map(previous.map(item=>[item.id,item]));for(const item of value.items as Reply[]){if(!merged.get(item.id)?.answer||item.answer)merged.set(item.id,item);}return [...merged.values()].sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at));});loaded.current=true;setError('');}}catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not load replies.');}finally{if(alive.current)setLoading(false);}}
 useEffect(()=>{if(open&&!loaded.current)void history();},[open]);
 useEffect(()=>{if(open)end.current?.scrollIntoView({block:'nearest'});},[items,busy,open]);
 async function ask(value=question,selected=context){
  const text=value.trim();if(!text||inFlight.current||stale)return;
  inFlight.current=true;setBusy(true);setOpen(true);setError('');
  const previous=pending.current;
  const attempt=previous?.question===text&&previous.screeningId===selected?.screeningId?previous:{requestId:crypto.randomUUID(),question:text,...(selected?{screeningId:selected.screeningId}:{})};pending.current=attempt;
  controller.current=new AbortController();const timer=setTimeout(()=>controller.current?.abort(),55000);
  try{
   const r=await fetch('/api/work/assistant',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.current.signal,body:JSON.stringify({...attempt,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'})});const value=await r.json();
   if(!alive.current)return;
   if(!r.ok){if([400,401,402,404,409,413,429].includes(r.status))pending.current=null;throw Error(value.error);}
   if(r.status===202){setError('Your reply is still being saved. Check replies in a moment.');return;}
   if(typeof value.answer?.text!=='string'||!Array.isArray(value.answer.actions))throw Error('Could not confirm your reply. Check replies before trying again.');
   setItems(previous=>[...previous.filter(item=>item.id!==value.id),value]);setQuestion('');pending.current=null;loaded.current=true;
  }catch(e){if(alive.current)setError(e instanceof Error&&e.name!=='AbortError'?e.message:'This reply is taking longer than expected. Check replies before trying again.');}
  finally{clearTimeout(timer);inFlight.current=false;if(alive.current)setBusy(false);}
 }
 useEffect(()=>{if(!request||handled.current===request.nonce)return;handled.current=request.nonce;setContext(request);setOpen(true);setQuestion('Explain this offer');if(!inFlight.current)void ask('Explain this offer',request);},[request]);
 async function act(action:AssistantAction){if(actionBusy||stale)return;setActionBusy(true);setError('');try{await onAction(action);if(['property','attention','funding'].includes(action.kind))setOpen(false);}catch(e){setError(e instanceof Error?e.message:'Could not complete that action.');}finally{setActionBusy(false);}}
 return <section id="ask-bot" className={`workspace-assistant${open?' is-open':''}`} aria-label="Ask your bot">
  {open&&<div className="assistant-panel" id="assistant-replies"><header><span><Sparkles size={16} aria-hidden="true"/>Your bot</span><button type="button" aria-label="Minimize bot conversation" onClick={()=>setOpen(false)}><ChevronDown size={19}/></button></header>
   <div className="assistant-history" role="log" aria-label="Bot replies" aria-live="polite" aria-relevant="additions">
    {!items.length&&!loading&&<div className="assistant-welcome"><strong>A little clarity. One question away.</strong><p>Ask about your activity, property numbers, or next step. AI answers use work credits; VIP uses 20% less.</p></div>}
    {loading&&<p className="assistant-checking" role="status">Loading saved replies…</p>}
    {items.map(item=><article className="assistant-exchange" key={item.id}><p className="assistant-question">{item.question}</p>{item.answer?<><p className="assistant-answer">{item.answer.text}</p><div className="assistant-answer-actions">{item.answer.actions.map((action,index)=><button type="button" key={index} disabled={actionBusy||stale} onClick={()=>void act(action)}>{action.label}</button>)}</div><a className="assistant-reply-date" href={`/?assistant=${encodeURIComponent(item.id)}#ask-bot`}>{new Date(item.answer.checkedAt).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</a></>:<p className="assistant-checking">{item.state==='pending'?'Reply is still processing.':'This reply could not finish. Ask again to retry.'}</p>}</article>)}
    {busy&&<p className="assistant-checking" role="status"><span className="assistant-loading-dots" aria-hidden="true"><i/><i/><i/></span>Checking your workspace…</p>}
    <div ref={end}/>
   </div>
   <div className="assistant-suggestions">{suggestions.map(value=><button key={value} type="button" disabled={busy||stale} onClick={()=>{setContext(null);void ask(value,null);}}>{value}</button>)}</div>
   {error&&<p className="assistant-error" role="alert">{error} <button type="button" disabled={loading} onClick={()=>void history()}>Check replies</button></p>}
  </div>}
  {context&&open&&<div className="assistant-property-context"><span>{context.address}</span><button type="button" aria-label="Clear property context" onClick={()=>setContext(null)}><X size={14}/></button></div>}
  <form className="assistant-composer" onSubmit={event=>{event.preventDefault();void ask();}}>
   <button type="button" className="assistant-toggle" aria-expanded={open} aria-controls="assistant-replies" aria-label={open?'Minimize bot conversation':'Open bot conversation'} onClick={()=>{setOpen(v=>!v);if(!open)input.current?.focus();}}><MessageCircle size={20}/></button>
   <label className="sr-only" htmlFor="ask-bot-question">Ask your bot</label><input id="ask-bot-question" ref={input} value={question} maxLength={1500} placeholder="Ask your bot…" autoComplete="off" disabled={stale} onFocus={()=>setOpen(true)} onChange={event=>setQuestion(event.target.value)}/>
   <button type="submit" className="assistant-send" aria-label="Send question" disabled={busy||stale||!question.trim()}><ArrowUp size={19}/></button>
  </form>
 </section>;
}
