'use client';
import {useEffect,useState} from 'react';
import {Check,EyeOff,RefreshCw} from 'lucide-react';
import {webinarRequest} from '@/lib/webinar-client';
type ReviewMessage={id:string;text:string;display_name:string;created_at:string;webinar_revision:number};
export function WebinarChatModeration({webinarId,version}:{webinarId:string;version:'day'|'night'}){
 const [status,setStatus]=useState<'pending'|'approved'|'hidden'>('pending'),[preview,setPreview]=useState(false),[messages,setMessages]=useState<ReviewMessage[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[before,setBefore]=useState('');
 useEffect(()=>{setBefore('');},[webinarId,version,status,preview]);
 useEffect(()=>{
  let disposed=false,running=false;const controller=new AbortController();setMessages([]);setError('');
  async function load(){if(running||document.hidden)return;running=true;setLoading(true);try{
   const d=await webinarRequest<{messages:ReviewMessage[]}>(`/api/webinar/chat/moderation?webinarId=${webinarId}&version=${version}&status=${status}&preview=${preview}${before?`&before=${encodeURIComponent(before)}`:''}`,{cache:'no-store',signal:controller.signal});
   if(!disposed){if(!Array.isArray(d.messages))throw Error('Could not load chat.');setMessages(d.messages);setError('');}
  }catch(e){if(!disposed)setError(e instanceof Error?e.message:'Could not load chat.');}finally{running=false;if(!disposed)setLoading(false);}}
  void load();const timer=setInterval(()=>void load(),10000);return()=>{disposed=true;controller.abort();clearInterval(timer);};
 },[webinarId,version,status,preview,before,refresh]);
 async function moderate(id:string,action:'approve'|'hide'){
  if(busy)return;setBusy(id);setError('');
  try{await webinarRequest('/api/webinar/chat/moderation',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,action})});setMessages(rows=>rows.filter(row=>row.id!==id));}
  catch(e){setError(e instanceof Error?e.message:'Could not update this message.');}finally{setBusy('');}
 }
 return <section className="ws-card ws-chat-moderation" aria-label="Viewer chat moderation"><div className="ws-card-heading"><div><h2>Viewer messages</h2><p>Only messages you approve appear for other viewers. You can hide them again anytime.</p></div><button className="ws-secondary" onClick={()=>setRefresh(n=>n+1)} disabled={loading} aria-label="Refresh viewer messages"><RefreshCw size={16}/></button></div>
  <div className="ws-moderation-filters"><label className="wb-label">Show<select value={status} onChange={e=>setStatus(e.target.value as typeof status)}><option value="pending">Needs review</option><option value="approved">Approved</option><option value="hidden">Hidden</option></select></label><label className="wb-check"><input type="checkbox" checked={preview} onChange={e=>setPreview(e.target.checked)}/>Preview messages only</label></div>
  {preview&&<p className="ws-hint">Preview messages stay inside owner previews and never appear to customers.</p>}
  {error&&<p role="alert" className="ws-alert">{error}</p>}
  {!messages.length&&<p role="status" className="ws-hint">{loading?'Loading viewer messages…':status==='pending'?'No messages waiting for review.':`No ${status} messages.`}</p>}
  <div className="ws-moderation-list">{messages.map(message=><article key={message.id}><div><b>{message.display_name||'Viewer'}</b><small>{new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(message.created_at))} · Version {message.webinar_revision}</small><p>{message.text}</p></div><div className="ws-row-actions">{status!=='approved'&&<button className="ws-secondary" disabled={!!busy} onClick={()=>void moderate(message.id,'approve')}><Check size={15}/>{busy===message.id?'Saving…':'Approve'}</button>}{status!=='hidden'&&<button className="ws-secondary" disabled={!!busy} onClick={()=>void moderate(message.id,'hide')}><EyeOff size={15}/>{busy===message.id?'Saving…':'Hide'}</button>}</div></article>)}</div>
  <div className="ws-row-actions">{before&&<button className="wb-text" onClick={()=>setBefore('')}>Newest messages</button>}{messages.length===50&&<button className="wb-text" onClick={()=>setBefore(messages[messages.length-1].created_at)}>Older messages</button>}</div>
 </section>;
}
