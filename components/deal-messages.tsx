'use client';
import type {AssistantDraft} from '@/lib/workspace-assistant-coach';
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
type Message={author?:'bot'|'you'|'contact'|'customer'|'operator';id:string;thread_id:string;direction:string;body:string;state:string;created_at:string;retryKey?:string|null;attachments?:{url:string;filename?:string}[]};
type Data={availabilityRequired?:boolean;threads:Thread[];messages:Message[];firstMessage?:Message|null;calls?:ConversationCall[];callsUnavailable?:boolean;receipt?:TextReceipt|null;threadId?:string;nextThread:string|null;next:{before:string;beforeId:string}|null};
export function DealMessages({apiBase='/api/work',markRead=true,draftRequest,dealId,initialThreadId='',contactNames={},active=true,onTakeover,historyOnly=false,onRecipientChange}:{apiBase?:string;markRead?:boolean;draftRequest?:AssistantDraft;dealId:string;historyOnly?:boolean;initialThreadId?:string;contactNames?:Record<string,string>;active?:boolean;onTakeover?:()=>void;onRecipientChange?:(phone:string)=>void}){
 const [data,setData]=useState<(Data&{scope:string})|null>(null),[error,setError]=useState(''),[threadId,setThreadId]=useState(initialThreadId),[afterThread,setAfterThread]=useState(''),[page,setPage]=useState<{before:string;beforeId:string}|null>(null),[refresh,setRefresh]=useState(0),[drafts,setDrafts]=useState<Record<string,string>>({});
 const [includeCalls,setIncludeCalls]=useState(true);
 const container=useRef<HTMLDivElement>(null);
 const readIds=useRef(new Set<string>()),readInFlight=useRef(false);
 const attempts=useRef<Record<string,SendAttempt>>({});
 const selectedThread=useRef(initialThreadId);
 useEffect(()=>{if(active){selectedThread.current=initialThreadId;setThreadId(initialThreadId);setPage(null);setAfterThread('');}},[active,initialThreadId]);
 const scope=JSON.stringify([dealId,threadId,afterThread,page,draftRequest?.nonce??0]);
 useEffect(()=>{if(!Object.values(drafts).some(d=>d.trim()))return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[drafts]);
 useEffect(()=>{
  if(!active)return;const controller=new AbortController(),cadence=createPollCadence();let inFlight=false,timer:ReturnType<typeof setTimeout>|undefined,delay=5000;
  async function load(){if(document.hidden||inFlight)return;inFlight=true;try{
   const pending=attempts.current[threadId||selectedThread.current];
   const q=new URLSearchParams({dealId,...(afterThread?{afterThread}:{}),...((threadId||selectedThread.current)?{threadId:threadId||selectedThread.current}:{}),...(pending?{requestKey:pending.key}:{}),...page});const response=await fetch(`${apiBase}/messages?${q}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]),cache:'no-store'});if(!response.ok)throw Error();const next=await response.json() as Data;if(!controller.signal.aborted){
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
 },[apiBase,active,dealId,threadId,page,afterThread,refresh,scope]);
 const current=data?.scope===scope?data.threads.find(t=>t.id===data.threadId):undefined;
 useEffect(()=>{if(active)onRecipientChange?.(current?.recipient??'');},[active,current?.recipient,onRecipientChange]);
 const [callHistory,setCallHistory]=useState<{scope:string;calls:ConversationCall[];unavailable:boolean}|null>(null);
 const callScope=current?JSON.stringify([apiBase,dealId,current.id,page]):'';
 useEffect(()=>{
  if(!active||!includeCalls||!current?.id)return;
  const controller=new AbortController(),id=current.id,cadence=createPollCadence();let timer:ReturnType<typeof setTimeout>|undefined;
  async function loadCalls(){
   let delay=10000;
   try{if(document.hidden)return;
    const q=new URLSearchParams({dealId,threadId:id,includeCalls:'true',...page});
    const r=await fetch(`${apiBase}/messages?${q}`,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])});
    const next=await r.json() as Data;if(!r.ok||next.threadId!==id||!Array.isArray(next.calls))throw Error();
    if(!controller.signal.aborted){setCallHistory({scope:callScope,calls:next.calls,unavailable:next.callsUnavailable===true});delay=cadence.observe(next.calls,next.calls.some(c=>c.recordingReceipt&&['starting','recording','stopping','processing'].includes(c.recordingReceipt.status)));}
   }catch{delay=cadence.failed();if(!controller.signal.aborted)setCallHistory(previous=>previous?.scope===callScope?{...previous,unavailable:true}:{scope:callScope,calls:[],unavailable:true});}
   finally{if(!controller.signal.aborted)timer=setTimeout(()=>void loadCalls(),delay);}
  }
  void loadCalls();return()=>{controller.abort();clearTimeout(timer);};
 },[apiBase,active,includeCalls,dealId,current?.id,callScope,page,refresh]);
 const [availability,setAvailability]=useState<{scope:string;sendReason:string|null;manualReply:boolean}|null>(null);
 const availabilityScope=current?`${dealId}:${current.id}`:'';
 useEffect(()=>{
  if(!active||historyOnly||!data?.availabilityRequired||!current?.id)return;
  setAvailability(null);
  const controller=new AbortController(),id=current.id;let timer:ReturnType<typeof setTimeout>|undefined;
  async function check(){
   if(document.hidden){timer=setTimeout(()=>void check(),10000);return;}
   try{
    const response=await fetch(`${apiBase}/messages/availability?threadId=${encodeURIComponent(id)}`,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
    const next=await response.json();
    if(!response.ok||next.threadId!==id||next.manualReply!==true||(next.sendReason!==null&&typeof next.sendReason!=='string'))throw Error();
    if(!controller.signal.aborted)setAvailability({scope:availabilityScope,sendReason:next.sendReason,manualReply:true});
   }catch{if(!controller.signal.aborted)setAvailability({scope:availabilityScope,sendReason:'Text sending is temporarily unavailable. Your conversation and draft are saved.',manualReply:false});}
   if(!controller.signal.aborted)timer=setTimeout(()=>void check(),10000);
  }
  void check();return()=>{controller.abort();clearTimeout(timer);};
 },[apiBase,active,historyOnly,data?.availabilityRequired,current?.id,availabilityScope,refresh]);
 const conversationThread=current&&data?.availabilityRequired&&!historyOnly?{...current,
  manualReply:availability?.scope===availabilityScope&&availability.manualReply,
  sendReason:availability?.scope===availabilityScope?availability.sendReason:'Checking text availability…'}:current;
 useEffect(()=>{
  if(!markRead||!active||!current||data?.scope!==scope||error)return;
  const candidates=data.messages.filter(m=>m.direction==='incoming'&&m.state==='received'&&!readIds.current.has(m.id)).map(m=>m.id);
  if(!candidates.length)return;
  const log=container.current?.querySelector<HTMLElement>('.message-history');if(!log)return;
  const save=async()=>{if(document.hidden||readInFlight.current)return;
   const bounds=log.getBoundingClientRect();
   const ids=candidates.filter(id=>{const node=log.querySelector<HTMLElement>(`[data-message-id="${id}"]`);if(!node)return false;const box=node.getBoundingClientRect();return box.width>0&&box.height>0&&box.bottom>Math.max(0,bounds.top)&&box.top<Math.min(window.innerHeight,bounds.bottom);});
   if(!ids.length)return;readInFlight.current=true;try{
    const response=await fetch(`${apiBase}/messages/read`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({threadId:current.id,messageIds:ids}),signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error();ids.forEach(id=>readIds.current.add(id));notifyWorkspaceChanges();
   }catch{/* Keep unconfirmed messages unread; the next view or refresh can retry. */}finally{readInFlight.current=false;}};
  let timer:ReturnType<typeof setTimeout>;
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>void save(),300);};
  schedule();document.addEventListener('visibilitychange',schedule);log.addEventListener('scroll',schedule);window.addEventListener('resize',schedule);
  return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',schedule);log.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);};
 },[apiBase,markRead,active,current,data,scope,error]);
 const handledSuggestion=useRef(0);
 const [suggestion,setSuggestion]=useState<AssistantDraft|null>(null);
 useEffect(()=>{if(!draftRequest||draftRequest.nonce===handledSuggestion.current||!active||historyOnly||!current||current.id!==draftRequest.threadId||data?.scope!==scope||error)return;
  handledSuggestion.current=draftRequest.nonce;
  const unchanged=(data.messages[0]?.id??null)===draftRequest.latestMessageId;
  if(unchanged&&!drafts[current.id]?.trim()&&!attempts.current[current.id]?.held&&!attempts.current[current.id]?.busy){setDrafts(d=>({...d,[current.id]:draftRequest.body}));setSuggestion(null);}
  else setSuggestion(draftRequest);
 },[draftRequest,active,historyOnly,current,data,scope,error,drafts]);
 const firstMessage=data?.scope===scope&&data.firstMessage&&!data.messages.some(m=>m.id===data.firstMessage!.id)?data.firstMessage:null;
 function choose(id:string){selectedThread.current=id;setThreadId(id);setPage(null);setError('');}
 return <div ref={container} className="deal-texts" data-unsaved-draft={Object.values(drafts).some(d=>d.trim())?'true':undefined}>
 {error&&data?.scope!==scope&&<button type="button" className="workspace-quiet" onClick={()=>setRefresh(v=>v+1)}>Refresh messages</button>}
 {data?.scope===scope&&!data.threads.length&&<div className="conversation-empty"><MessageCircle size={26}/><strong>No text conversation yet</strong><p>Choose a saved contact to start a conversation.</p></div>}
 <div className={`conversation-inbox${data?.threads.length===1&&!data.nextThread&&!afterThread?' single-contact':''}`}>
 {!!data?.threads.length&&(data.threads.length>1||data.nextThread||afterThread)&&<aside className="conversation-contacts" aria-label="Text contacts"><div className="conversation-contacts-title">Contacts</div>{data.threads.map(t=><button type="button" key={t.id} aria-pressed={(threadId||data.threadId)===t.id} onClick={()=>choose(t.id)}><span className="conversation-contact-avatar">{t.party==='buyer'?'B':'S'}</span><span><strong>{contactNames[t.recipient]??(t.party==='buyer'?'Buyer':'Seller')}</strong><small><PrivatePhone>{t.recipient}</PrivatePhone></small>{t.reply&&<><span className="conversation-contact-preview">{t.reply.preview||'Sent an attachment'}</span>{t.reply.unread_count>0&&<b className="text-unread-count">{t.reply.unread_count}</b>}</>}{drafts[t.id]?.trim()&&<em>Draft saved</em>}</span></button>)}<div className="history-pages">{afterThread&&<button onClick={()=>{selectedThread.current='';setAfterThread('');setThreadId('');setPage(null);setData(null);}}>First contacts</button>}{data.nextThread&&<button onClick={()=>{selectedThread.current='';setAfterThread(data.nextThread!);setThreadId('');setPage(null);setData(null);}}>More contacts</button>}</div></aside>}
 <div className="conversation-thread-pane">
 {suggestion&&current?.id===suggestion.threadId&&<section className="assistant-draft-review" aria-label="Suggested reply"><strong>Review your suggested reply</strong><p>The conversation changed or you already have a draft. Read the latest messages before using this suggestion.</p><blockquote>{suggestion.body}</blockquote><button type="button" disabled={!!error||!active||!!attempts.current[current.id]?.busy||!!attempts.current[current.id]?.held} onClick={()=>{if(drafts[current.id]?.trim()&&!window.confirm('Replace your unsent draft with this suggested reply?'))return;setDrafts(d=>({...d,[current.id]:suggestion.body}));setSuggestion(null);}}>Use suggested reply</button><button type="button" onClick={()=>setSuggestion(null)}>Keep my draft</button></section>}
 {!current&&!error&&(!data||data.scope!==scope)&&<p className="conversation-loading" role="status">Loading conversation…</p>}
 {current&&<><div className="conversation-thread-heading"><div><strong>{contactNames[current.recipient]??(current.party==='buyer'?'Buyer':'Seller')}</strong><span><PrivatePhone>{current.recipient}</PrivatePhone></span></div><label className="conversation-call-toggle"><input type="checkbox" checked={includeCalls} onChange={e=>setIncludeCalls(e.target.checked)}/>Include calls</label></div><div className="history-pages">{page&&<button onClick={()=>setPage(null)}>Latest activity</button>}{data?.next&&<button onClick={()=>setPage(data.next)}>Older messages</button>}</div><Conversation apiBase={apiBase} active={active} firstMessage={firstMessage} historyOnly={historyOnly} calls={active&&includeCalls&&callHistory?.scope===callScope?callHistory.calls.filter(c=>!c.voicemail):[]} callsUnavailable={includeCalls&&callHistory?.scope===callScope&&callHistory.unavailable} onTakeover={onTakeover} key={current.id} attempts={attempts.current} stale={!!error||!active} draft={drafts[current.id]??''} onDraft={value=>setDrafts(d=>({...d,[current.id]:value}))} thread={conversationThread!} messages={data?.messages.slice().reverse()??[]} onSent={()=>{setPage(null);setRefresh(v=>v+1);}}/></>}
 </div></div>
 </div>;
}
function Conversation({apiBase,active,firstMessage,historyOnly=false,calls,callsUnavailable,onTakeover,thread,messages,onSent,draft,onDraft,attempts,stale}:{apiBase:string;active:boolean;firstMessage:Message|null;historyOnly?:boolean;calls:ConversationCall[];callsUnavailable:boolean;onTakeover?:()=>void;thread:Thread;messages:Message[];onSent:()=>void;draft:string;onDraft:(value:string)=>void;attempts:Record<string,SendAttempt>;stale:boolean}){
 const timeline=conversationTimeline(messages,calls);
 const log=useRef<HTMLDivElement>(null),nearLatest=useRef(true),followReply=useRef(true),[showLatest,setShowLatest]=useState(false);
 useEffect(()=>{
  const node=log.current;if(!active){followReply.current=true;return;}if(!node)return;
  const follow=()=>{
   if(!node.clientHeight)return;
   if(followReply.current){
    const reply=Array.from(node.querySelectorAll<HTMLElement>('[data-message-id].message-incoming')).at(-1);
    node.scrollTop=reply?node.scrollTop+reply.getBoundingClientRect().top-node.getBoundingClientRect().top-12:node.scrollHeight;
    nearLatest.current=node.scrollHeight-node.scrollTop-node.clientHeight<64;setShowLatest(!nearLatest.current);
   }else if(nearLatest.current){node.scrollTop=node.scrollHeight;setShowLatest(false);}
  };
  follow();const observer=new ResizeObserver(follow);observer.observe(node);Array.from(node.children).forEach(child=>observer.observe(child));
  return()=>observer.disconnect();
 },[active,timeline.at(-1)?.key,timeline.length]);
 return <div className="conversation-body">{firstMessage&&<details className="conversation-first-message"><summary>First message · {safeLocalTime(firstMessage.created_at)}</summary><strong>{messageSpeaker(firstMessage.direction,thread.party,firstMessage.author)}</strong><p>{firstMessage.body}</p><small>{firstMessage.direction==='outgoing'?textStateLabel(firstMessage.state):'Received'}</small></details>}<div className="conversation-log-wrap"><div ref={log} className="message-history" role="log" aria-live="polite" aria-label="Conversation history" onWheel={()=>{followReply.current=false;}} onTouchMove={()=>{followReply.current=false;}} onPointerDown={()=>{followReply.current=false;}} onKeyDown={()=>{followReply.current=false;}} onScroll={()=>{const node=log.current;if(active&&node?.clientHeight){nearLatest.current=node.scrollHeight-node.scrollTop-node.clientHeight<64;setShowLatest(!nearLatest.current);}}}>
  {!timeline.length&&!callsUnavailable&&<p>No conversation yet.</p>}
  {timeline.map((entry,index)=>{const day=new Date(entry.at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});const previous=index?new Date(timeline[index-1].at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):null;const divider=day!==previous?<div className="conversation-date"><span>{day}</span></div>:null;if(entry.kind==='call')return <Fragment key={entry.key}>{divider}<CallConversation apiBase={entry.call.source==='personal'?apiBase:apiBase.replace(/\/contact$/,'')} {...entry.call} onRefreshRecording={onSent}/></Fragment>;const message=entry.message;return <Fragment key={entry.key}>{divider}<article data-message-id={message.id} className={`message-bubble ${message.direction==='outgoing'?'message-outgoing':'message-incoming'}`}>
   <strong className="message-speaker">{messageSpeaker(message.direction,thread.party,message.author)}</strong><p className="message-body" style={{whiteSpace:'pre-wrap'}}>{message.body}</p>
   {message.direction==='incoming'&&message.attachments?.map((attachment,index)=>{
    let safe=false;try{const url=new URL(attachment.url);safe=url.protocol==='https:'&&url.hostname==='api.contiguity.com'&&url.pathname.startsWith('/attachments/')&&!url.username&&!url.password;}catch{}
    return safe?<p key={index}><a href={attachment.url} target="_blank" rel="noopener noreferrer" style={{color:'inherit'}}>View attachment {index+1}</a></p>:<p key={index}>Attachment held for review</p>;
   })}
   <small>{message.direction==='outgoing'?textStateLabel(message.state):'Received'} · {safeLocalTime(message.created_at)}</small>
   {message.retryKey&&<button type="button" className="message-retry" disabled={stale||attempts[thread.id]?.busy||attempts[thread.id]?.held} onClick={()=>{if(draft.trim()&&draft.trim()!==message.body&&!window.confirm('Replace your draft with this unsent text?'))return;attempts[thread.id]={key:message.retryKey!,body:message.body,busy:false,held:false,retryable:true,status:''};onDraft(message.body);document.getElementById(`reply-${thread.id}`)?.focus();}}>Retry text</button>}
  </article></Fragment>;})}
  </div>{showLatest&&<button type="button" className="conversation-latest" onClick={()=>{followReply.current=false;nearLatest.current=true;setShowLatest(false);if(log.current)log.current.scrollTop=log.current.scrollHeight;}}><ArrowDown size={14}/>Latest activity</button>}</div>
  {historyOnly?<p>Automatic intake messages. Manual replies become available after the property is matched.</p>:<TextComposer apiBase={apiBase} onTakeover={onTakeover} attempts={attempts} stale={stale} thread={thread} message={draft} setMessage={onDraft} onSent={()=>{followReply.current=false;nearLatest.current=true;onSent();}}/>}
 </div>;
}
function TextComposer({apiBase,onTakeover,thread,message,setMessage,onSent,attempts,stale}:{apiBase:string;onTakeover?:()=>void;thread:Thread;message:string;setMessage:(value:string)=>void;onSent:()=>void;attempts:Record<string,SendAttempt>;stale:boolean}){
 const [,update]=useState(0),input=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{const node=input.current;if(node){node.style.height='0px';node.style.height=`${Math.min(104,Math.max(44,node.scrollHeight))}px`;}},[message]);
 const attempt=attempts[thread.id],busy=attempt?.busy??false,held=attempt?.held??false,status=attempt?.status??'';
 const replyBlocked=!!thread.sendReason||(thread.paused&&!thread.manualReply);
 const length=smsLength(message),maxLength=length.limit;
 async function send(event:Pick<React.FormEvent,'preventDefault'>){
  event.preventDefault();const body=message.trim();if(attempts[thread.id]?.busy||attempts[thread.id]?.held||stale||replyBlocked||!body||!length.fits)return;
  // One attempt per contact survives tab changes. The synchronous lock prevents double submits.
  const prior=attempts[thread.id];
  const request:SendAttempt={key:prior?.retryable&&prior.body===body?prior.key:crypto.randomUUID(),body,busy:true,held:false,status:''};attempts[thread.id]=request;update(n=>n+1);
  try{
   const response=await fetch(`${apiBase}/messages`,{method:'POST',signal:AbortSignal.timeout(45000),headers:{'Content-Type':'application/json'},body:JSON.stringify({threadId:thread.id,requestKey:request.key,message:body})});const result=await response.json();
   if(result.manual===true)onTakeover?.();
   if(result.notSent){request.status=result.error||'Text not sent. Your draft is saved.';request.retryable=result.state==='ready';return;}
   if(!response.ok)throw Error();
   if(result.status==='message_accepted'){request.status=result.state==='delivered'?'Delivered.':'Sent. Delivery confirmation pending.';setMessage('');}
   else{request.status='Confirming delivery automatically…';request.held=true;request.retryable=true;}
  }catch{request.status='Confirming delivery automatically…';request.held=true;request.retryable=true;}finally{request.busy=false;update(n=>n+1);onSent();}
 }
 return <form aria-label="Send a text message" className="message-composer" data-unsaved-draft={message.trim()?'true':undefined} onSubmit={send}>
  <div className="message-composer-heading"><MessageCircle size={15} aria-hidden="true"/><label htmlFor={`reply-${thread.id}`}>Text message</label><span>To {thread.recipient}</span></div><div className="text-input-row"><textarea ref={input} id={`reply-${thread.id}`} placeholder={`Text the ${thread.party==='buyer'?'buyer':'seller'}…`} value={message} onChange={event=>setMessage(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing&&window.matchMedia('(pointer: fine)').matches){event.preventDefault();void send(event);}}} maxLength={160} rows={1} required disabled={busy||held}/><button className="message-send" aria-label={busy?'Sending text':'Send text'} disabled={busy||held||stale||replyBlocked||!message.trim()||!length.fits}><ArrowUp size={16} aria-hidden="true"/><span>{busy?'Sending…':'Send'}</span></button></div>
  <div className="text-composer-meta"><small>Sending pauses the bot on this lead</small><small aria-live="polite">{length.units}/{maxLength}</small></div>
  {replyBlocked&&<p>{thread.sendReason??'Texting is unavailable for this contact.'} {thread.sendReason?.startsWith('Add credits')&&<button type="button" onClick={()=>{document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog=>dialog.close());document.getElementById('workspace-funding-toggle')?.click();}}>Add credits</button>}</p>}{status&&<p role="status">{status}</p>}
  {!length.fits&&<p>Shorten this draft to {maxLength} characters before sending.</p>}
 </form>;
}
