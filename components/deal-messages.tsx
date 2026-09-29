'use client';
import {useEffect,useRef,useState} from 'react';
type Thread={id:string;recipient:string;paused:boolean};
type Message={id:string;thread_id:string;direction:string;body:string;state:string;created_at:string;attachments?:{url:string;filename?:string}[]};
type Data={threads:Thread[];messages:Message[]};
export function DealMessages({dealId}:{dealId:string}){
 const [open,setOpen]=useState(false),[data,setData]=useState<Data|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  if(!open)return;
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
  setData(null);setError('');
  const refresh=async()=>{
   try{
    if(document.visibilityState==='hidden')return;
    const response=await fetch(`/api/work/messages?dealId=${dealId}`,{signal:controller.signal,cache:'no-store'});
    if(!response.ok)throw Error();
    const next=await response.json() as Data;
    if(!controller.signal.aborted){setData(next);setError('');}
   }catch{if(!controller.signal.aborted)setError('Messages could not refresh. We’ll try again shortly.');}
   finally{if(!controller.signal.aborted)timer=setTimeout(refresh,10000);}
  };
  void refresh();return()=>{controller.abort();clearTimeout(timer);};
 },[open,dealId]);
 return <details onToggle={e=>{if(e.target===e.currentTarget)setOpen(e.currentTarget.open);}}>
  <summary>💬 Text messages</summary>
  {open&&<>{error&&<p role="status">{error}</p>}{!data&&!error&&<p>Loading…</p>}
  {data&&!data.threads.length&&<p>No contacts linked to this deal yet.</p>}
  {data?.threads.map(thread=><Conversation key={`${dealId}:${thread.id}`} thread={thread} messages={data.messages.filter(message=>message.thread_id===thread.id).slice().reverse()}/>)}</>}
 </details>;
}
function Conversation({thread,messages}:{thread:Thread;messages:Message[]}){
 return <details><summary style={{minHeight:44,padding:'12px 0'}}>Conversation with {thread.recipient}</summary>
  {!messages.length&&<p>No messages yet.</p>}
  {messages.map(message=><article key={message.id} style={{margin:'8px 0',padding:12,borderRadius:16,background:message.direction==='outgoing'?'#111':'#f1f1f1',color:message.direction==='outgoing'?'#fff':'#111',maxWidth:'90%',marginLeft:message.direction==='outgoing'?'auto':0,overflowWrap:'anywhere'}}>
   <p style={{whiteSpace:'pre-wrap'}}>{message.body}</p>
   {message.direction==='incoming'&&message.attachments?.map((attachment,index)=>{
    let safe=false;try{const url=new URL(attachment.url);safe=url.protocol==='https:'&&url.hostname==='api.contiguity.com'&&url.pathname.startsWith('/attachments/')&&!url.username&&!url.password;}catch{}
    return safe?<p key={index}><a href={attachment.url} target="_blank" rel="noopener noreferrer" style={{color:'inherit'}}>View attachment {index+1}</a></p>:<p key={index}>Attachment held for review</p>;
   })}
   <small>{message.direction==='outgoing'?message.state==='accepted'?'Accepted by provider':message.state.replaceAll('_',' '):'Received'} · {new Date(message.created_at).toLocaleString()}</small>
  </article>)}
  <TextComposer thread={thread}/>
 </details>;
}
function TextComposer({thread}:{thread:Thread}){
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[held,setHeld]=useState(false);
 const request=useRef<{key:string;body:string}|null>(null);
 return <form onSubmit={async event=>{
  event.preventDefault();if(busy||held||thread.paused)return;setBusy(true);setStatus('');
  const body=message.trim();if(!body){setBusy(false);return;}
  if(!request.current||request.current.body!==body)request.current={key:crypto.randomUUID(),body};
  try{
   const response=await fetch('/api/work/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({threadId:thread.id,requestKey:request.current.key,message:body})});const result=await response.json();
   if(!response.ok)throw Error();
   if(result.status==='message_accepted'){setStatus('Accepted by the provider. Delivery is not confirmed yet.');setMessage('');request.current=null;}
   else{setStatus('Message held. Contact permission, sender setup or available budget needs review.');setHeld(true);}
  }catch{setStatus('Send status is uncertain. Check the conversation before sending again.');setHeld(true);}finally{setBusy(false);}
 }}>
  <label>Reply to {thread.recipient}<textarea value={message} onChange={event=>setMessage(event.target.value)} maxLength={160} required disabled={busy||held||thread.paused} style={{display:'block',width:'100%',minHeight:88,boxSizing:'border-box'}}/></label>
  <button disabled={busy||held||thread.paused||!message.trim()} style={{minHeight:44}}>{busy?'Sending…':'Send text'}</button>
  {thread.paused&&<p>Messaging is paused for this contact.</p>}{status&&<p role="status">{status}</p>}
  <small>Sending uses credits and respects contact hours.</small>
 </form>;
}
