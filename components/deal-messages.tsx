'use client';
import {useEffect,useRef,useState} from 'react';
type Data={threads:{id:string;recipient:string;paused:boolean}[];messages:{id:string;direction:string;body:string;state:string;created_at:string;attachments?:{url:string;filename?:string}[]}[]};
export function DealMessages({dealId}:{dealId:string}){
 const [open,setOpen]=useState(false),[data,setData]=useState<Data|null>(null),[error,setError]=useState('');
 useEffect(()=>{if(!open)return;const a=new AbortController();setData(null);setError('');fetch(`/api/work/messages?dealId=${dealId}`,{signal:a.signal,cache:'no-store'}).then(async r=>{if(!r.ok)throw Error();const v=await r.json();if(!a.signal.aborted)setData(v);}).catch(()=>{if(!a.signal.aborted)setError('Could not load messages. Close and reopen to retry.');});return()=>a.abort();},[open,dealId]);
 return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary>💬 Text messages</summary>{error&&<p role="alert">{error}</p>}{open&&!data&&!error&&<p>Loading…</p>}{data&&!data.messages.length&&<p>No text messages linked to this deal yet.</p>}{data?.messages.slice().reverse().map(m=><article key={m.id} style={{margin:'8px 0',padding:12,borderRadius:16,background:m.direction==='outgoing'?'#111':'#f1f1f1',color:m.direction==='outgoing'?'#fff':'#111',maxWidth:'90%',marginLeft:m.direction==='outgoing'?'auto':0,overflowWrap:'anywhere'}}><p style={{whiteSpace:'pre-wrap'}}>{m.body}</p>{m.direction==='incoming'&&m.attachments?.map((a,i)=>{let safe=false;try{const u=new URL(a.url);safe=u.protocol==='https:'&&u.hostname==='api.contiguity.com'&&u.pathname.startsWith('/attachments/')&&!u.username&&!u.password;}catch{}return safe?<p key={i}><a href={a.url} target="_blank" rel="noopener noreferrer" style={{color:'inherit'}}>View attachment {i+1}</a></p>:<p key={i}>Attachment held for review</p>;})}<small>{m.direction==='outgoing'?m.state==='accepted'?'Accepted by provider':m.state.replaceAll('_',' '):'Received'} · {new Date(m.created_at).toLocaleString()}</small></article>)}{data?.threads.map(t=><TextComposer key={t.id} thread={t}/>)}</details>;
}

function TextComposer({thread}:{thread:Data['threads'][number]}){
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[held,setHeld]=useState(false);
 const request=useRef<{key:string;body:string}|null>(null);
 return <details><summary>Reply to {thread.recipient}</summary><form onSubmit={async e=>{e.preventDefault();if(busy||held)return;setBusy(true);setStatus('');
 const body=message.trim();if(!request.current||request.current.body!==body)request.current={key:crypto.randomUUID(),body};
 try{const r=await fetch('/api/work/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({threadId:thread.id,requestKey:request.current.key,message:body})});const result=await r.json();if(!r.ok)throw Error(result.error);
 if(result.status==='message_accepted'){setStatus('Accepted by the provider. Delivery is not confirmed yet.');setMessage('');request.current=null;}
 else{setStatus('Message held. Review sender setup, contact permission and budget before trying again.');setHeld(true);}
 }catch{setStatus('Send status needs review. Reopen the conversation before sending anything else.');setHeld(true);}finally{setBusy(false);}
 }}><label>Message<textarea value={message} onChange={e=>setMessage(e.target.value)} maxLength={160} required disabled={busy||held||thread.paused} style={{display:'block',width:'100%',minHeight:88,boxSizing:'border-box'}}/></label><button disabled={busy||held||thread.paused||!message.trim()} style={{minHeight:44}}>{busy?'Sending…':'Send text'}</button>{thread.paused&&<p>Messaging is paused for this contact.</p>}{status&&<p role="status">{status}</p>}<small>Keep it brief. Sending uses credits and respects contact hours.</small></form></details>;
}
