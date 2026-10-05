'use client';
import {useEffect,useRef,useState} from 'react';
import {MessageCircle,ArrowDown,ArrowUp,RefreshCw} from 'lucide-react';
import {smsLength} from '@/lib/sms-length';
import {messageSpeaker,safeLocalTime} from './workspace-view';
type Thread={id:string;recipient:string;paused:boolean;manualReply?:boolean;party?:string};
type Message={id:string;thread_id:string;direction:string;body:string;state:string;created_at:string;attachments?:{url:string;filename?:string}[]};
type Ai={id:string;thread_id:string;state:string;reply:string|null;analysis:{summary?:string;callbackRequested?:boolean;facts?:{kind:string;quote:string}[]}|null};
type Data={threads:Thread[];messages:Message[];ai?:Ai[];threadId?:string;nextThread:string|null;next:{before:string;beforeId:string}|null};
type SendAttempt={key:string;body:string;busy:boolean;held:boolean;status:string};
export function DealMessages({dealId,active=true,onTakeover}:{dealId:string;active?:boolean;onTakeover?:()=>void}){
 const [data,setData]=useState<(Data&{scope:string})|null>(null),[error,setError]=useState(''),[threadId,setThreadId]=useState(''),[afterThread,setAfterThread]=useState(''),[page,setPage]=useState<{before:string;beforeId:string}|null>(null),[refresh,setRefresh]=useState(0),[drafts,setDrafts]=useState<Record<string,string>>({}),[search,setSearch]=useState('');
 const attempts=useRef<Record<string,SendAttempt>>({});
 const scope=JSON.stringify([dealId,threadId,afterThread,page]);
 useEffect(()=>{if(!Object.values(drafts).some(d=>d.trim()))return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[drafts]);
 useEffect(()=>{
  if(!active)return;const controller=new AbortController();let inFlight=false;
  async function load(){if(document.hidden||inFlight)return;inFlight=true;try{
   const q=new URLSearchParams({dealId,...(afterThread?{afterThread}:{}),...(threadId?{threadId}:{}),...page});const response=await fetch(`/api/work/messages?${q}`,{signal:controller.signal,cache:'no-store'});if(!response.ok)throw Error();const next=await response.json() as Data;if(!controller.signal.aborted){setData({...next,scope});setError('');}
  }catch{if(!controller.signal.aborted)setError('Messages could not refresh. Your draft is still here.');}finally{inFlight=false;}}
  void load();const timer=setInterval(load,15000);document.addEventListener('visibilitychange',load);return()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',load);};
 },[active,dealId,threadId,page,afterThread,refresh,scope]);
 const current=data?.scope===scope?data.threads.find(t=>t.id===data.threadId):undefined;
 function choose(id:string){setThreadId(id);setPage(null);setSearch('');setError('');}
 return <div className="deal-texts" data-unsaved-draft={Object.values(drafts).some(d=>d.trim())?'true':undefined}>
 {error&&<p className="conversation-load-error" role="status">{error} <button className="workspace-quiet" onClick={()=>setRefresh(v=>v+1)}>Retry</button></p>}
 {data?.scope===scope&&!data.threads.length&&<div className="conversation-empty"><MessageCircle size={26}/><strong>No text conversation yet</strong><p>A permitted contact needs to be linked before you can send. Your bot’s saved texts will appear here.</p><button type="button" onClick={()=>setRefresh(v=>v+1)}>Check contact</button><a href="/support">Get help</a></div>}
 <div className={`conversation-inbox${data?.threads.length===1&&!data.nextThread&&!afterThread?' single-contact':''}`}>
 {!!data?.threads.length&&(data.threads.length>1||data.nextThread||afterThread)&&<aside className="conversation-contacts" aria-label="Text contacts"><div className="conversation-contacts-title">Contacts</div>{data.threads.map(t=><button type="button" key={t.id} aria-pressed={(threadId||data.threadId)===t.id} onClick={()=>choose(t.id)}><span className="conversation-contact-avatar">{t.party==='buyer'?'B':'S'}</span><span><strong>{t.party==='buyer'?'Buyer':'Seller'}</strong><small>{t.recipient}</small>{drafts[t.id]?.trim()&&<em>Draft saved</em>}</span></button>)}<div className="history-pages">{afterThread&&<button onClick={()=>{setAfterThread('');setThreadId('');setPage(null);setData(null);}}>First contacts</button>}{data.nextThread&&<button onClick={()=>{setAfterThread(data.nextThread!);setThreadId('');setPage(null);setData(null);}}>More contacts</button>}</div></aside>}
 <div className="conversation-thread-pane">
 {!current&&(!data||data.scope!==scope)&&<p className="conversation-loading" role="status">Loading conversation…</p>}
 {current&&<><div className="conversation-thread-heading"><div><strong>{current.party==='buyer'?'Buyer':'Seller'}</strong><span>{current.recipient}</span></div><button type="button" className="conversation-refresh" aria-label="Refresh texts" onClick={()=>setRefresh(v=>v+1)}><RefreshCw size={16}/></button></div><details className="conversation-search"><summary>Search texts</summary><label className="message-search">Find in loaded texts<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search this message page"/></label></details><div className="history-pages">{page&&<button onClick={()=>setPage(null)}>Latest texts</button>}{data?.next&&<button onClick={()=>setPage(data.next)}>Older texts</button>}</div><Conversation onTakeover={onTakeover} key={current.id} attempts={attempts.current} stale={!!error||!active} draft={drafts[current.id]??''} onDraft={value=>setDrafts(d=>({...d,[current.id]:value}))} search={search} thread={current} ai={data?.ai?.[0]} messages={data?.messages.slice().reverse()??[]} onSent={()=>{setPage(null);setRefresh(v=>v+1);}}/></>}
 </div></div>
 </div>;
}
function Conversation({onTakeover,thread,messages,ai,onSent,draft,onDraft,search,attempts,stale}:{onTakeover?:()=>void;thread:Thread;messages:Message[];ai?:Ai;onSent:()=>void;draft:string;onDraft:(value:string)=>void;search:string;attempts:Record<string,SendAttempt>;stale:boolean}){
 const log=useRef<HTMLDivElement>(null),nearLatest=useRef(true),[showLatest,setShowLatest]=useState(false);
 useEffect(()=>{if(nearLatest.current&&log.current)log.current.scrollTop=log.current.scrollHeight;},[messages.at(-1)?.id,search]);
 const visible=messages.filter(m=>m.body.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
 return <div className="conversation-body"><div className="conversation-log-wrap"><div ref={log} className="message-history" role="log" aria-live="polite" aria-label="Text history" onScroll={()=>{const node=log.current;if(node){nearLatest.current=node.scrollHeight-node.scrollTop-node.clientHeight<64;setShowLatest(!nearLatest.current);}}}>
  {!messages.length&&<p>No messages yet.</p>}
  {!visible.length&&messages.length>0&&<p>No matching texts on this page. Try another phrase or open older texts.</p>}{visible.map(message=><article key={message.id} className={`message-bubble ${message.direction==='outgoing'?'message-outgoing':'message-incoming'}`}>
   <strong className="message-speaker">{messageSpeaker(message.direction,thread.party)}</strong><p className="message-body" style={{whiteSpace:'pre-wrap'}}>{message.body}</p>
   {message.direction==='incoming'&&message.attachments?.map((attachment,index)=>{
    let safe=false;try{const url=new URL(attachment.url);safe=url.protocol==='https:'&&url.hostname==='api.contiguity.com'&&url.pathname.startsWith('/attachments/')&&!url.username&&!url.password;}catch{}
    return safe?<p key={index}><a href={attachment.url} target="_blank" rel="noopener noreferrer" style={{color:'inherit'}}>View attachment {index+1}</a></p>:<p key={index}>Attachment held for review</p>;
   })}
   <small>{message.direction==='outgoing'?message.state==='accepted'?'Accepted by provider':message.state.replaceAll('_',' '):'Received'} · {safeLocalTime(message.created_at)}</small>
  </article>)}
  </div>{showLatest&&<button type="button" className="conversation-latest" onClick={()=>{nearLatest.current=true;setShowLatest(false);if(log.current)log.current.scrollTop=log.current.scrollHeight;}}><ArrowDown size={14}/>Latest texts</button>}</div>
  <TextComposer onTakeover={onTakeover} attempts={attempts} stale={stale} thread={thread} message={draft} setMessage={onDraft} onSent={()=>{nearLatest.current=true;onSent();}}/>
  {ai&&<details className="message-ai-note"><summary>{ai.state==='handoff'?'A person was requested':ai.state==='needs_review'?'Review AI reply':'AI conversation notes'}</summary>{ai.analysis?.summary&&<p>{ai.analysis.summary}</p>}{ai.analysis?.callbackRequested&&<p>Callback requested. Not booked yet.</p>}{ai.reply&&<><p>{ai.reply}</p><button type="button" onClick={()=>{if(!draft.trim()||window.confirm('Replace your unsent draft with this suggested reply?'))onDraft(ai.reply!);}}>Use as my draft</button></>}</details>}
 </div>;
}
function TextComposer({onTakeover,thread,message,setMessage,onSent,attempts,stale}:{onTakeover?:()=>void;thread:Thread;message:string;setMessage:(value:string)=>void;onSent:()=>void;attempts:Record<string,SendAttempt>;stale:boolean}){
 const [,update]=useState(0);
 const attempt=attempts[thread.id],busy=attempt?.busy??false,held=attempt?.held??false,status=attempt?.status??'';
 const replyBlocked=thread.paused&&!thread.manualReply;
 const length=smsLength(message),maxLength=length.limit;
 async function send(event:Pick<React.FormEvent,'preventDefault'>){
  event.preventDefault();const body=message.trim();if(attempts[thread.id]?.busy||attempts[thread.id]?.held||stale||replyBlocked||!body||!length.fits)return;
  // One attempt per contact survives tab changes. The synchronous lock prevents double submits.
  const request:SendAttempt={key:crypto.randomUUID(),body,busy:true,held:false,status:''};attempts[thread.id]=request;update(n=>n+1);
  try{
   const response=await fetch('/api/work/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({threadId:thread.id,requestKey:request.key,message:body})});const result=await response.json();
   if(!response.ok)throw Error();
   if(result.manual===true)onTakeover?.();
   if(result.status==='message_accepted'){request.status='Accepted by the provider. Delivery is not confirmed yet.';setMessage('');}
   else{request.status='Message held. Contact permission, sender setup or available budget needs review.';request.held=true;}
  }catch{request.status='Send status is uncertain. Check the conversation before sending again.';request.held=true;}finally{request.busy=false;update(n=>n+1);onSent();}
 }
 return <form className="message-composer" data-unsaved-draft={message.trim()?'true':undefined} onSubmit={send}>
  <label className="sr-only" htmlFor={`reply-${thread.id}`}>Your reply</label><div className="text-input-row"><textarea id={`reply-${thread.id}`} placeholder={`Text the ${thread.party==='buyer'?'buyer':'seller'}…`} value={message} onChange={event=>setMessage(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing&&window.matchMedia('(pointer: fine)').matches){event.preventDefault();void send(event);}}} maxLength={160} rows={2} required disabled={busy||held||replyBlocked}/><button className="message-send" aria-label={busy?'Sending text':'Send text'} disabled={busy||held||stale||replyBlocked||!message.trim()||!length.fits}><ArrowUp size={18}/></button></div>
  <div className="text-composer-meta"><small>Sending pauses the bot on this lead</small><small aria-live="polite">{length.units}/{maxLength}</small></div>
  {held&&<button type="button" className="message-check-status" onClick={()=>{onSent();}}>Check latest status</button>}{replyBlocked&&<p>Texting is unavailable for this contact. <button type="button" onClick={onSent}>Check again</button> <a href="/support">Get help</a></p>}{status&&<p role="status">{status}</p>}
  {!length.fits&&<p>Shorten this draft to {maxLength} characters before sending.</p>}
 </form>;
}
