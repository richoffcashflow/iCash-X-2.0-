'use client';
import {useEffect,useRef,useState} from 'react';
import {MessageCircle,ArrowDown,ArrowUp} from 'lucide-react';
import {smsLength} from '@/lib/sms-length';
import {reconcileTextAttempt,textStateLabel,type SendAttempt,type TextReceipt} from '@/lib/text-send-state';
import {messageSpeaker,safeLocalTime} from './workspace-view';
type Thread={id:string;recipient:string;paused:boolean;manualReply?:boolean;sendReason?:string|null;name?:string;party?:string};
type Message={id:string;thread_id:string;direction:string;body:string;state:string;created_at:string;retryKey?:string|null;attachments?:{url:string;filename?:string}[]};
type Data={threads:Thread[];messages:Message[];receipt?:TextReceipt|null;threadId?:string;nextThread:string|null;next:{before:string;beforeId:string}|null};
export function DealMessages({dealId,initialThreadId='',contactNames={},active=true,onTakeover}:{dealId:string;initialThreadId?:string;contactNames?:Record<string,string>;active?:boolean;onTakeover?:()=>void}){
 const [data,setData]=useState<(Data&{scope:string})|null>(null),[error,setError]=useState(''),[threadId,setThreadId]=useState(initialThreadId),[afterThread,setAfterThread]=useState(''),[page,setPage]=useState<{before:string;beforeId:string}|null>(null),[refresh,setRefresh]=useState(0),[drafts,setDrafts]=useState<Record<string,string>>({});
 const attempts=useRef<Record<string,SendAttempt>>({});
 const selectedThread=useRef(initialThreadId);
 useEffect(()=>{if(initialThreadId){setThreadId(initialThreadId);setPage(null);setAfterThread('');}},[initialThreadId]);
 const scope=JSON.stringify([dealId,threadId,afterThread,page]);
 useEffect(()=>{if(!Object.values(drafts).some(d=>d.trim()))return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[drafts]);
 useEffect(()=>{
  if(!active)return;const controller=new AbortController();let inFlight=false;
  async function load(){if(document.hidden||inFlight)return;inFlight=true;try{
   const pending=attempts.current[threadId||selectedThread.current];
   const q=new URLSearchParams({dealId,...(afterThread?{afterThread}:{}),...(threadId?{threadId}:{}),...(pending?{requestKey:pending.key}:{}),...page});const response=await fetch(`/api/work/messages?${q}`,{signal:controller.signal,cache:'no-store'});if(!response.ok)throw Error();const next=await response.json() as Data;if(!controller.signal.aborted){
    selectedThread.current=next.threadId??'';
    const attempt=next.threadId?attempts.current[next.threadId]:undefined;
    if(attempt&&reconcileTextAttempt(attempt,next.receipt))setDrafts(d=>d[next.threadId!]?.trim()===attempt.body?{...d,[next.threadId!]:''}:d);
    setData({...next,scope});setError('');
   }
  }catch{if(!controller.signal.aborted)setError('Messages could not refresh. Your draft is still here.');}finally{inFlight=false;}}
  void load();const timer=setInterval(load,5000);document.addEventListener('visibilitychange',load);return()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',load);};
 },[active,dealId,threadId,page,afterThread,refresh,scope]);
 const current=data?.scope===scope?data.threads.find(t=>t.id===data.threadId):undefined;
 function choose(id:string){setThreadId(id);setPage(null);setError('');}
 return <div className="deal-texts" data-unsaved-draft={Object.values(drafts).some(d=>d.trim())?'true':undefined}>
 {error&&<p className="conversation-load-error" role="status">{error} <button className="workspace-quiet" onClick={()=>setRefresh(v=>v+1)}>Retry</button></p>}
 {data?.scope===scope&&!data.threads.length&&<div className="conversation-empty"><MessageCircle size={26}/><strong>No text conversation yet</strong><p>Choose a saved contact to start a conversation.</p></div>}
 <div className={`conversation-inbox${data?.threads.length===1&&!data.nextThread&&!afterThread?' single-contact':''}`}>
 {!!data?.threads.length&&(data.threads.length>1||data.nextThread||afterThread)&&<aside className="conversation-contacts" aria-label="Text contacts"><div className="conversation-contacts-title">Contacts</div>{data.threads.map(t=><button type="button" key={t.id} aria-pressed={(threadId||data.threadId)===t.id} onClick={()=>choose(t.id)}><span className="conversation-contact-avatar">{t.party==='buyer'?'B':'S'}</span><span><strong>{contactNames[t.recipient]??(t.party==='buyer'?'Buyer':'Seller')}</strong><small>{t.recipient}</small>{drafts[t.id]?.trim()&&<em>Draft saved</em>}</span></button>)}<div className="history-pages">{afterThread&&<button onClick={()=>{setAfterThread('');setThreadId('');setPage(null);setData(null);}}>First contacts</button>}{data.nextThread&&<button onClick={()=>{setAfterThread(data.nextThread!);setThreadId('');setPage(null);setData(null);}}>More contacts</button>}</div></aside>}
 <div className="conversation-thread-pane">
 {!current&&(!data||data.scope!==scope)&&<p className="conversation-loading" role="status">Loading conversation…</p>}
 {current&&<><div className="conversation-thread-heading"><div><strong>{contactNames[current.recipient]??(current.party==='buyer'?'Buyer':'Seller')}</strong><span>{current.recipient}</span></div></div><div className="history-pages">{page&&<button onClick={()=>setPage(null)}>Latest texts</button>}{data?.next&&<button onClick={()=>setPage(data.next)}>Older texts</button>}</div><Conversation onTakeover={onTakeover} key={current.id} attempts={attempts.current} stale={!!error||!active} draft={drafts[current.id]??''} onDraft={value=>setDrafts(d=>({...d,[current.id]:value}))} thread={current} messages={data?.messages.slice().reverse()??[]} onSent={()=>{setPage(null);setRefresh(v=>v+1);}}/></>}
 </div></div>
 </div>;
}
function Conversation({onTakeover,thread,messages,onSent,draft,onDraft,attempts,stale}:{onTakeover?:()=>void;thread:Thread;messages:Message[];onSent:()=>void;draft:string;onDraft:(value:string)=>void;attempts:Record<string,SendAttempt>;stale:boolean}){
 const log=useRef<HTMLDivElement>(null),nearLatest=useRef(true),[showLatest,setShowLatest]=useState(false);
 useEffect(()=>{if(nearLatest.current&&log.current)log.current.scrollTop=log.current.scrollHeight;},[messages.at(-1)?.id]);
 return <div className="conversation-body"><div className="conversation-log-wrap"><div ref={log} className="message-history" role="log" aria-live="polite" aria-label="Text history" onScroll={()=>{const node=log.current;if(node){nearLatest.current=node.scrollHeight-node.scrollTop-node.clientHeight<64;setShowLatest(!nearLatest.current);}}}>
  {!messages.length&&<p>No messages yet.</p>}
  {messages.map(message=><article key={message.id} className={`message-bubble ${message.direction==='outgoing'?'message-outgoing':'message-incoming'}`}>
   <strong className="message-speaker">{messageSpeaker(message.direction,thread.party)}</strong><p className="message-body" style={{whiteSpace:'pre-wrap'}}>{message.body}</p>
   {message.direction==='incoming'&&message.attachments?.map((attachment,index)=>{
    let safe=false;try{const url=new URL(attachment.url);safe=url.protocol==='https:'&&url.hostname==='api.contiguity.com'&&url.pathname.startsWith('/attachments/')&&!url.username&&!url.password;}catch{}
    return safe?<p key={index}><a href={attachment.url} target="_blank" rel="noopener noreferrer" style={{color:'inherit'}}>View attachment {index+1}</a></p>:<p key={index}>Attachment held for review</p>;
   })}
   <small>{message.direction==='outgoing'?textStateLabel(message.state):'Received'} · {safeLocalTime(message.created_at)}</small>
   {message.retryKey&&<button type="button" className="message-retry" disabled={stale||attempts[thread.id]?.busy||attempts[thread.id]?.held} onClick={()=>{if(draft.trim()&&draft.trim()!==message.body&&!window.confirm('Replace your draft with this unsent text?'))return;attempts[thread.id]={key:message.retryKey!,body:message.body,busy:false,held:false,retryable:true,status:''};onDraft(message.body);document.getElementById(`reply-${thread.id}`)?.focus();}}>Retry text</button>}
  </article>)}
  </div>{showLatest&&<button type="button" className="conversation-latest" onClick={()=>{nearLatest.current=true;setShowLatest(false);if(log.current)log.current.scrollTop=log.current.scrollHeight;}}><ArrowDown size={14}/>Latest texts</button>}</div>
  <TextComposer onTakeover={onTakeover} attempts={attempts} stale={stale} thread={thread} message={draft} setMessage={onDraft} onSent={()=>{nearLatest.current=true;onSent();}}/>
 </div>;
}
function TextComposer({onTakeover,thread,message,setMessage,onSent,attempts,stale}:{onTakeover?:()=>void;thread:Thread;message:string;setMessage:(value:string)=>void;onSent:()=>void;attempts:Record<string,SendAttempt>;stale:boolean}){
 const [,update]=useState(0);
 const attempt=attempts[thread.id],busy=attempt?.busy??false,held=attempt?.held??false,status=attempt?.status??'';
 const replyBlocked=!!thread.sendReason||(thread.paused&&!thread.manualReply);
 const length=smsLength(message),maxLength=length.limit;
 async function send(event:Pick<React.FormEvent,'preventDefault'>){
  event.preventDefault();const body=message.trim();if(attempts[thread.id]?.busy||attempts[thread.id]?.held||stale||replyBlocked||!body||!length.fits)return;
  // One attempt per contact survives tab changes. The synchronous lock prevents double submits.
  const prior=attempts[thread.id];
  const request:SendAttempt={key:prior?.retryable&&prior.body===body?prior.key:crypto.randomUUID(),body,busy:true,held:false,status:''};attempts[thread.id]=request;update(n=>n+1);
  try{
   const response=await fetch('/api/work/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({threadId:thread.id,requestKey:request.key,message:body})});const result=await response.json();
   if(result.manual===true)onTakeover?.();
   if(result.notSent){request.status=result.error||'Text not sent. Your draft is saved.';request.retryable=result.state==='ready';return;}
   if(!response.ok)throw Error();
   if(result.status==='message_accepted'){request.status=result.state==='delivered'?'Delivered.':'Sent. Delivery confirmation pending.';setMessage('');}
   else{request.status='Confirming delivery automatically…';request.held=true;request.retryable=true;}
  }catch{request.status='Confirming delivery automatically…';request.held=true;request.retryable=true;}finally{request.busy=false;update(n=>n+1);onSent();}
 }
 return <form className="message-composer" data-unsaved-draft={message.trim()?'true':undefined} onSubmit={send}>
  <label className="sr-only" htmlFor={`reply-${thread.id}`}>Your reply</label><div className="text-input-row"><textarea id={`reply-${thread.id}`} placeholder={`Text the ${thread.party==='buyer'?'buyer':'seller'}…`} value={message} onChange={event=>setMessage(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing&&window.matchMedia('(pointer: fine)').matches){event.preventDefault();void send(event);}}} maxLength={160} rows={2} required disabled={busy||held}/><button className="message-send" aria-label={busy?'Sending text':'Send text'} disabled={busy||held||stale||replyBlocked||!message.trim()||!length.fits}><ArrowUp size={18}/></button></div>
  <div className="text-composer-meta"><small>Sending pauses the bot on this lead</small><small aria-live="polite">{length.units}/{maxLength}</small></div>
  {replyBlocked&&<p>{thread.sendReason??'Texting is unavailable for this contact.'} {thread.sendReason?.startsWith('Add credits')&&<button type="button" onClick={()=>{document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog=>dialog.close());document.getElementById('workspace-funding-toggle')?.click();}}>Add credits</button>}</p>}{status&&<p role="status">{status}</p>}
  {!length.fits&&<p>Shorten this draft to {maxLength} characters before sending.</p>}
 </form>;
}
