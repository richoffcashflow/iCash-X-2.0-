'use client';
import {PrivatePhone} from '@/components/owner-phone-privacy';
import {notifyWorkspaceChanges,subscribeWorkspaceChanges} from '@/lib/workspace-events-client';
import {Fragment,useEffect,useRef,useState} from 'react';
import {MessageCircle,ArrowDown,ArrowUp} from 'lucide-react';
import {smsLength} from '@/lib/sms-length';
import {reconcileTextAttempt,textStateLabel,type SendAttempt,type TextReceipt} from '@/lib/text-send-state';
import {CallConversation} from './call-conversation';
import {conversationTimeline,type ConversationCall} from '@/lib/conversation-timeline';
import {createPollCadence} from '@/lib/poll-cadence';
import {messageSpeaker,safeLocalTime} from './workspace-view';
type Thread={reply?:{preview:string;received_at:string;unread_count:number}|null;id:string;recipient:string;paused:boolean;manualReply?:boolean;sendReason?:string|null;name?:string;party?:string};
type Message={author?:'bot'|'you'|'contact';id:string;thread_id:string;direction:string;body:string;state:string;created_at:string;retryKey?:string|null;attachments?:{url:string;filename?:string}[]};
type Data={threads:Thread[];messages:Message[];firstMessage?:Message|null;calls?:ConversationCall[];callsUnavailable?:boolean;receipt?:TextReceipt|null;threadId?:string;nextThread:string|null;next:{before:string;beforeId:string}|null};
export function DealMessages({dealId,initialThreadId='',contactNames={},active=true,onTakeover,historyOnly=false}:{dealId:string;historyOnly?:boolean;initialThreadId?:string;contactNames?:Record<string,string>;active?:boolean;onTakeover?:()=>void}){
 const [data,setData]=useState<(Data&{scope:string})|null>(null),[error,setError]=useState(''),[threadId,setThreadId]=useState(initialThreadId),[afterThread,setAfterThread]=useState(''),[page,setPage]=useState<{before:string;beforeId:string}|null>(null),[refresh,setRefresh]=useState(0),[drafts,setDrafts]=useState<Record<string,string>>({});
 const [includeCalls,setIncludeCalls]=useState(false),[readError,setReadError]=useState('');
 const container=useRef<HTMLDivElement>(null);
 const readIds=useRef(new Set<string>()),readInFlight=useRef(false);
 const attempts=useRef<Record<string,SendAttempt>>({});
 const selectedThread=useRef(initialThreadId);
 useEffect(()=>{if(initialThreadId){setThreadId(initialThreadId);setPage(null);setAfterThread('');}},[initialThreadId]);
 const scope=JSON.stringify([dealId,threadId,afterThread,page]);
 useEffect(()=>{if(!Object.values(drafts).some(d=>d.trim()))return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[drafts]);
 useEffect(()=>{
  if(!active)return;const controller=new AbortController(),cadence=createPollCadence();let inFlight=false,timer:ReturnType<typeof setTimeout>|undefined,delay=5000;
  async function load(){if(document.hidden||inFlight)return;inFlight=true;try{
   const pending=attempts.current[threadId||selectedThread.current];
   const q=new URLSearchParams({dealId,...(includeCalls?{includeCalls:'true'}:{}),...(afterThread?{afterThread}:{}),...(threadId?{threadId}:{}),...(pending?{requestKey:pending.key}:{}),...page});const response=await fetch(`/api/work/messages?${q}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]),cache:'no-store'});if(!response.ok)throw Error();const next=await response.json() as Data;if(!controller.signal.aborted){
    selectedThread.current=next.threadId??'';
    const attempt=next.threadId?attempts.current[next.threadId]:undefined;
    if(attempt&&reconcileTextAttempt(attempt,next.receipt))setDrafts(d=>d[next.threadId!]?.trim()===attempt.body?{...d,[next.threadId!]:''}:d);
    const recent=next.messages.some(message=>Date.now()-Date.parse(message.created_at)<60000);
    delay=cadence.observe(next,!!pending?.busy||!!pending?.held||recent);
    setData({...next,scope});setError('');
   }
  }catch{delay=cadence.failed();if(!controller.signal.aborted)setError('Messages could not refresh. Your draft is still here.');}finally{inFlight=false;}}
  const poll=async()=>{await load();if(!controller.signal.aborted)timer=setTimeout(poll,delay);};
  const visible=()=>{if(!document.hidden&&!inFlight){clearTimeout(timer);delay=5000;void poll();}};
  const unsubscribe=subscribeWorkspaceChanges(visible);void poll();document.addEventListener('visibilitychange',visible);return()=>{controller.abort();unsubscribe();clearTimeout(timer);document.removeEventListener('visibilitychange',visible);};
 },[active,dealId,threadId,page,afterThread,refresh,scope,includeCalls]);
 const current=data?.scope===scope?data.threads.find(t=>t.id===data.threadId):undefined;
 useEffect(()=>{
  if(!active||!current||data?.scope!==scope||error)return;
  const candidates=data.messages.filter(m=>m.direction==='incoming'&&m.state==='received'&&!readIds.current.has(m.id)).map(m=>m.id);
  if(!candidates.length)return;
  const log=container.current?.querySelector<HTMLElement>('.message-history');if(!log)return;
  let alive=true;
  const save=async()=>{if(document.hidden||readInFlight.current)return;
   const bounds=log.getBoundingClientRect();
   const ids=candidates.filter(id=>{const node=log.querySelector<HTMLElement>(`[data-message-id="${id}"]`);if(!node)return false;const box=node.getBoundingClientRect();return box.width>0&&box.height>0&&box.bottom>Math.max(0,bounds.top)&&box.top<Math.min(window.innerHeight,bounds.bottom);});
   if(!ids.length)return;readInFlight.current=true;try{
    const response=await fetch('/api/work/messages/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({threadId:current.id,messageIds:ids}),signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error();ids.forEach(id=>readIds.current.add(id));if(alive)setReadError('');notifyWorkspaceChanges();
   }catch{if(alive)setReadError('Could not save read status. Your messages are still here.');}finally{readInFlight.current=false;}};
  let timer:ReturnType<typeof setTimeout>;
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>void save(),300);};
  schedule();document.addEventListener('visibilitychange',schedule);log.addEventListener('scroll',schedule);window.addEventListener('resize',schedule);
  return()=>{alive=false;clearTimeout(timer);document.removeEventListener('visibilitychange',schedule);log.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);};
 },[active,current,data,scope,error]);
 const firstMessage=data?.scope===scope&&data.firstMessage&&!data.messages.some(m=>m.id===data.firstMessage!.id)?data.firstMessage:null;
 function choose(id:string){setThreadId(id);setPage(null);setError('');}
 return <div ref={container} className="deal-texts" data-unsaved-draft={Object.values(drafts).some(d=>d.trim())?'true':undefined}>
 {readError&&<p className="conversation-read-error" role="status">{readError} <button type="button" className="workspace-quiet" onClick={()=>setRefresh(v=>v+1)}>Retry</button></p>}
 {error&&<p className="conversation-load-error" role="status">{error} <button className="workspace-quiet" onClick={()=>setRefresh(v=>v+1)}>Retry</button></p>}
 {data?.scope===scope&&!data.threads.length&&<div className="conversation-empty"><MessageCircle size={26}/><strong>No text conversation yet</strong><p>Choose a saved contact to start a conversation.</p></div>}
 <div className={`conversation-inbox${data?.threads.length===1&&!data.nextThread&&!afterThread?' single-contact':''}`}>
 {!!data?.threads.length&&(data.threads.length>1||data.nextThread||afterThread)&&<aside className="conversation-contacts" aria-label="Text contacts"><div className="conversation-contacts-title">Contacts</div>{data.threads.map(t=><button type="button" key={t.id} aria-pressed={(threadId||data.threadId)===t.id} onClick={()=>choose(t.id)}><span className="conversation-contact-avatar">{t.party==='buyer'?'B':'S'}</span><span><strong>{contactNames[t.recipient]??(t.party==='buyer'?'Buyer':'Seller')}</strong><small><PrivatePhone>{t.recipient}</PrivatePhone></small>{t.reply&&<><span className="conversation-contact-preview">{t.reply.preview||'Sent an attachment'}</span>{t.reply.unread_count>0&&<b className="text-unread-count">{t.reply.unread_count}</b>}</>}{drafts[t.id]?.trim()&&<em>Draft saved</em>}</span></button>)}<div className="history-pages">{afterThread&&<button onClick={()=>{setAfterThread('');setThreadId('');setPage(null);setData(null);}}>First contacts</button>}{data.nextThread&&<button onClick={()=>{setAfterThread(data.nextThread!);setThreadId('');setPage(null);setData(null);}}>More contacts</button>}</div></aside>}
 <div className="conversation-thread-pane">
 {!current&&(!data||data.scope!==scope)&&<p className="conversation-loading" role="status">Loading conversation…</p>}
 {current&&<><div className="conversation-thread-heading"><div><strong>{contactNames[current.recipient]??(current.party==='buyer'?'Buyer':'Seller')}</strong><span><PrivatePhone>{current.recipient}</PrivatePhone></span></div><label className="conversation-call-toggle"><input type="checkbox" checked={includeCalls} onChange={e=>setIncludeCalls(e.target.checked)}/>Include calls</label></div><div className="history-pages">{page&&<button onClick={()=>setPage(null)}>Latest activity</button>}{data?.next&&<button onClick={()=>setPage(data.next)}>Older messages</button>}</div><Conversation firstMessage={firstMessage} historyOnly={historyOnly} calls={active&&includeCalls?(data?.calls??[]).filter(c=>!c.voicemail):[]} callsUnavailable={includeCalls&&(data?.callsUnavailable??false)} onTakeover={onTakeover} key={current.id} attempts={attempts.current} stale={!!error||!active} draft={drafts[current.id]??''} onDraft={value=>setDrafts(d=>({...d,[current.id]:value}))} thread={current} messages={data?.messages.slice().reverse()??[]} onSent={()=>{setPage(null);setRefresh(v=>v+1);}}/></>}
 </div></div>
 </div>;
}
function Conversation({firstMessage,historyOnly=false,calls,callsUnavailable,onTakeover,thread,messages,onSent,draft,onDraft,attempts,stale}:{firstMessage:Message|null;historyOnly?:boolean;calls:ConversationCall[];callsUnavailable:boolean;onTakeover?:()=>void;thread:Thread;messages:Message[];onSent:()=>void;draft:string;onDraft:(value:string)=>void;attempts:Record<string,SendAttempt>;stale:boolean}){
 const timeline=conversationTimeline(messages,calls);
 const log=useRef<HTMLDivElement>(null),nearLatest=useRef(true),[showLatest,setShowLatest]=useState(false);
 useEffect(()=>{if(nearLatest.current&&log.current)log.current.scrollTop=log.current.scrollHeight;},[timeline.at(-1)?.key,timeline.length]);
 return <div className="conversation-body">{firstMessage&&<details className="conversation-first-message"><summary>First message · {safeLocalTime(firstMessage.created_at)}</summary><strong>{messageSpeaker(firstMessage.direction,thread.party,firstMessage.author)}</strong><p>{firstMessage.body}</p><small>{firstMessage.direction==='outgoing'?textStateLabel(firstMessage.state):'Received'}</small></details>}<div className="conversation-log-wrap"><div ref={log} className="message-history" role="log" aria-live="polite" aria-label="Conversation history" onScroll={()=>{const node=log.current;if(node){nearLatest.current=node.scrollHeight-node.scrollTop-node.clientHeight<64;setShowLatest(!nearLatest.current);}}}>
  {callsUnavailable&&<p role="status">Call history could not refresh. <button type="button" className="workspace-quiet" onClick={onSent}>Retry call history</button></p>}
  {!timeline.length&&<p>No conversation yet.</p>}
  {timeline.map((entry,index)=>{const day=new Date(entry.at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});const previous=index?new Date(timeline[index-1].at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):null;const divider=day!==previous?<div className="conversation-date"><span>{day}</span></div>:null;if(entry.kind==='call')return <Fragment key={entry.key}>{divider}<CallConversation {...entry.call} onRefreshRecording={onSent}/></Fragment>;const message=entry.message;return <Fragment key={entry.key}>{divider}<article data-message-id={message.id} className={`message-bubble ${message.direction==='outgoing'?'message-outgoing':'message-incoming'}`}>
   <strong className="message-speaker">{messageSpeaker(message.direction,thread.party,message.author)}</strong><p className="message-body" style={{whiteSpace:'pre-wrap'}}>{message.body}</p>
   {message.direction==='incoming'&&message.attachments?.map((attachment,index)=>{
    let safe=false;try{const url=new URL(attachment.url);safe=url.protocol==='https:'&&url.hostname==='api.contiguity.com'&&url.pathname.startsWith('/attachments/')&&!url.username&&!url.password;}catch{}
    return safe?<p key={index}><a href={attachment.url} target="_blank" rel="noopener noreferrer" style={{color:'inherit'}}>View attachment {index+1}</a></p>:<p key={index}>Attachment held for review</p>;
   })}
   <small>{message.direction==='outgoing'?textStateLabel(message.state):'Received'} · {safeLocalTime(message.created_at)}</small>
   {message.retryKey&&<button type="button" className="message-retry" disabled={stale||attempts[thread.id]?.busy||attempts[thread.id]?.held} onClick={()=>{if(draft.trim()&&draft.trim()!==message.body&&!window.confirm('Replace your draft with this unsent text?'))return;attempts[thread.id]={key:message.retryKey!,body:message.body,busy:false,held:false,retryable:true,status:''};onDraft(message.body);document.getElementById(`reply-${thread.id}`)?.focus();}}>Retry text</button>}
  </article></Fragment>;})}
  </div>{showLatest&&<button type="button" className="conversation-latest" onClick={()=>{nearLatest.current=true;setShowLatest(false);if(log.current)log.current.scrollTop=log.current.scrollHeight;}}><ArrowDown size={14}/>Latest activity</button>}</div>
  {historyOnly?<p>Automatic intake messages. Manual replies become available after the property is matched.</p>:<TextComposer onTakeover={onTakeover} attempts={attempts} stale={stale} thread={thread} message={draft} setMessage={onDraft} onSent={()=>{nearLatest.current=true;onSent();}}/>}
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
   const response=await fetch('/api/work/messages',{method:'POST',signal:AbortSignal.timeout(45000),headers:{'Content-Type':'application/json'},body:JSON.stringify({threadId:thread.id,requestKey:request.key,message:body})});const result=await response.json();
   if(result.manual===true)onTakeover?.();
   if(result.notSent){request.status=result.error||'Text not sent. Your draft is saved.';request.retryable=result.state==='ready';return;}
   if(!response.ok)throw Error();
   if(result.status==='message_accepted'){request.status=result.state==='delivered'?'Delivered.':'Sent. Delivery confirmation pending.';setMessage('');}
   else{request.status='Confirming delivery automatically…';request.held=true;request.retryable=true;}
  }catch{request.status='Confirming delivery automatically…';request.held=true;request.retryable=true;}finally{request.busy=false;update(n=>n+1);onSent();}
 }
 return <form aria-label="Send a text message" className="message-composer" data-unsaved-draft={message.trim()?'true':undefined} onSubmit={send}>
  <div className="message-composer-heading"><MessageCircle size={15} aria-hidden="true"/><label htmlFor={`reply-${thread.id}`}>Text message</label><span>To {thread.recipient}</span></div><div className="text-input-row"><textarea id={`reply-${thread.id}`} placeholder={`Text the ${thread.party==='buyer'?'buyer':'seller'}…`} value={message} onChange={event=>setMessage(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing&&window.matchMedia('(pointer: fine)').matches){event.preventDefault();void send(event);}}} maxLength={160} rows={2} required disabled={busy||held}/><button className="message-send" aria-label={busy?'Sending text':'Send text'} disabled={busy||held||stale||replyBlocked||!message.trim()||!length.fits}><ArrowUp size={16} aria-hidden="true"/><span>{busy?'Sending…':'Send'}</span></button></div>
  <div className="text-composer-meta"><small>Sending pauses the bot on this lead</small><small aria-live="polite">{length.units}/{maxLength}</small></div>
  {replyBlocked&&<p>{thread.sendReason??'Texting is unavailable for this contact.'} {thread.sendReason?.startsWith('Add credits')&&<button type="button" onClick={()=>{document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog=>dialog.close());document.getElementById('workspace-funding-toggle')?.click();}}>Add credits</button>}</p>}{status&&<p role="status">{status}</p>}
  {!length.fits&&<p>Shorten this draft to {maxLength} characters before sending.</p>}
 </form>;
}
