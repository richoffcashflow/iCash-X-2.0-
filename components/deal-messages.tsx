'use client';
import {useEffect,useRef,useState} from 'react';
type Thread={id:string;recipient:string;paused:boolean;manualReply?:boolean;party?:string};
type Message={id:string;thread_id:string;direction:string;body:string;state:string;created_at:string;attachments?:{url:string;filename?:string}[]};
type Ai={id:string;thread_id:string;state:string;reply:string|null;analysis:{summary?:string;callbackRequested?:boolean;facts?:{kind:string;quote:string}[]}|null};
type Data={threads:Thread[];messages:Message[];ai?:Ai[];threadId?:string;nextThread:string|null;next:{before:string;beforeId:string}|null};
export function DealMessages({dealId,active=true}:{dealId:string;active?:boolean}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[threadId,setThreadId]=useState(''),[afterThread,setAfterThread]=useState(''),[page,setPage]=useState<{before:string;beforeId:string}|null>(null),[refresh,setRefresh]=useState(0);
 useEffect(()=>{
  if(!active)return;const controller=new AbortController();let inFlight=false;
  async function load(){if(document.hidden||inFlight)return;inFlight=true;try{
   const q=new URLSearchParams({dealId,...(afterThread?{afterThread}:{}),...(threadId?{threadId}:{}),...page});const response=await fetch(`/api/work/messages?${q}`,{signal:controller.signal,cache:'no-store'});if(!response.ok)throw Error();const next=await response.json() as Data;if(!controller.signal.aborted){setData(next);setError('');}
  }catch{if(!controller.signal.aborted)setError('Messages could not refresh. Your draft is still here.');}finally{inFlight=false;}}
  void load();const timer=setInterval(load,15000);document.addEventListener('visibilitychange',load);return()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',load);};
 },[active,dealId,threadId,page,afterThread,refresh]);
 const current=data?.threads.find(t=>t.id===data.threadId);
 return <div className="deal-texts">{error&&<p role="status">{error}</p>}{!data&&!error&&<p role="status">Loading texts…</p>}
 {data&&!data.threads.length&&<p>No text conversation linked to this property yet.</p>}
 {data&&data.threads.length>1&&<label>Contact<select value={data.threadId} onChange={e=>{setThreadId(e.target.value);setPage(null);}}>{data.threads.map(t=><option key={t.id} value={t.id}>{t.party==='buyer'?'Buyer':'Seller'} · {t.recipient}</option>)}</select></label>}
 <div className="history-pages">{afterThread&&<button onClick={()=>{setAfterThread('');setThreadId('');setPage(null);setData(null);}}>First contacts</button>}{data?.nextThread&&<button onClick={()=>{setAfterThread(data.nextThread!);setThreadId('');setPage(null);setData(null);}}>More contacts</button>}</div>
 {current&&<Conversation key={current.id} thread={current} ai={data?.ai?.[0]} messages={data?.messages.slice().reverse()??[]} onSent={()=>{setPage(null);setRefresh(v=>v+1);}}/>}
 <div className="history-pages">{page&&<button onClick={()=>setPage(null)}>Latest texts</button>}{data?.next&&<button onClick={()=>setPage(data.next)}>Older texts</button>}</div>
 </div>;
}
function Conversation({thread,messages,ai,onSent}:{thread:Thread;messages:Message[];ai?:Ai;onSent:()=>void}){
 const [draft,setDraft]=useState('');
 return <div><p className="conversation-recipient">{thread.party==='buyer'?'Buyer':'Seller'} · {thread.recipient}</p><div className="message-history" aria-label="Text history">
  {!messages.length&&<p>No messages yet.</p>}
  {messages.map(message=><article key={message.id} className={`message-bubble ${message.direction==='outgoing'?'message-outgoing':'message-incoming'}`}>
   <p className="message-body" style={{whiteSpace:'pre-wrap'}}>{message.body}</p>
   {message.direction==='incoming'&&message.attachments?.map((attachment,index)=>{
    let safe=false;try{const url=new URL(attachment.url);safe=url.protocol==='https:'&&url.hostname==='api.contiguity.com'&&url.pathname.startsWith('/attachments/')&&!url.username&&!url.password;}catch{}
    return safe?<p key={index}><a href={attachment.url} target="_blank" rel="noopener noreferrer" style={{color:'inherit'}}>View attachment {index+1}</a></p>:<p key={index}>Attachment held for review</p>;
   })}
   <small>{message.direction==='outgoing'?message.state==='accepted'?'Accepted by provider':message.state.replaceAll('_',' '):'Received'} · {new Date(message.created_at).toLocaleString()}</small>
  </article>)}
  </div>
  <TextComposer thread={thread} draft={draft} onSent={onSent}/>
  {ai&&<details className="message-ai-note"><summary>{ai.state==='handoff'?'A person was requested':ai.state==='needs_review'?'Review AI reply':'AI conversation notes'}</summary>{ai.analysis?.summary&&<p>{ai.analysis.summary}</p>}{ai.analysis?.callbackRequested&&<p>Callback requested. Not booked yet.</p>}{ai.reply&&<><p>{ai.reply}</p><button type="button" onClick={()=>setDraft(ai.reply!)}>Use as my draft</button></>}</details>}
 </div>;
}
function TextComposer({thread,draft,onSent}:{thread:Thread;draft:string;onSent:()=>void}){
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[held,setHeld]=useState(false);
 const request=useRef<{key:string;body:string}|null>(null);
 useEffect(()=>{if(draft)setMessage(draft);},[draft]);
 const replyBlocked=thread.paused&&!thread.manualReply;
 const maxLength=/[^A-Za-z0-9 .,!?]/.test(message)?35:160;
 return <form className="message-composer" onSubmit={async event=>{
  event.preventDefault();if(busy||held||replyBlocked)return;setBusy(true);setStatus('');
  const body=message.trim();if(!body){setBusy(false);return;}
  if(!request.current||request.current.body!==body)request.current={key:crypto.randomUUID(),body};
  try{
   const response=await fetch('/api/work/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({threadId:thread.id,requestKey:request.current.key,message:body})});const result=await response.json();
   if(!response.ok)throw Error();
   if(result.status==='message_accepted'){setStatus('Accepted by the provider. Delivery is not confirmed yet.');setMessage('');request.current=null;}
   else{setStatus('Message held. Contact permission, sender setup or available budget needs review.');setHeld(true);}
  }catch{setStatus('Send status is uncertain. Check the conversation before sending again.');setHeld(true);}finally{setBusy(false);onSent();}
 }}>
  <label>Your message<textarea placeholder="Type your reply…" value={message} onChange={event=>setMessage(event.target.value)} maxLength={160} required disabled={busy||held||replyBlocked} style={{display:'block',width:'100%',minHeight:88,boxSizing:'border-box'}}/></label>
  <button className="message-send" disabled={busy||held||replyBlocked||!message.trim()||message.length>maxLength}>{busy?'Sending…':'Send text'}</button>
  {replyBlocked&&<p>Messaging is paused for this contact.</p>}{status&&<p role="status">{status}</p>}
  {message.length>maxLength&&<p>Shorten this draft to {maxLength} characters before sending.</p>}
  <small>Sending uses credits and respects contact hours.</small>
 </form>;
}
