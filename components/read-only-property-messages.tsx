'use client';
import {useEffect,useState} from 'react';
import {webinarRequest} from '@/lib/webinar-client';
import {overviewTime} from '@/lib/owner-overview';
import styles from './read-only-property-messages.module.css';
type Messages={threads:{id:string;recipient:string;party:string}[];threadId:string|null;messages:{id:string;body:string;direction:string;state:string;created_at:string}[];next:{before:string;beforeId:string}|null;nextThread:string|null};
export function ReadOnlyPropertyMessages({base,screeningId}:{base:string;screeningId:string}){
 const [data,setData]=useState<Messages|null>(null),[error,setError]=useState(''),[query,setQuery]=useState<Record<string,string>>({}),[refresh,setRefresh]=useState(0);
 const key=JSON.stringify(query);
 useEffect(()=>{const controller=new AbortController();setData(null);setError('');void webinarRequest<Messages>(`${base}/messages?${new URLSearchParams({screeningId,...query})}`,{cache:'no-store',signal:controller.signal}).then(d=>{if(!controller.signal.aborted)setData(d);}).catch(()=>{if(!controller.signal.aborted)setError('Messages could not load.');});return()=>controller.abort();},[base,screeningId,key,refresh]);
 return <section aria-label="Customer text messages" className={styles.messages}><div className={styles.toolbar}><h3>Text messages</h3><button onClick={()=>setRefresh(n=>n+1)}>Refresh messages</button></div>
  {error&&<p role="alert">{error}</p>}{!data&&!error&&<p role="status">Loading messages…</p>}
  {data&&<>{data.threads.length>0&&<label>Conversation <select value={data.threadId??''} onChange={e=>setQuery({...query.afterThread?{afterThread:query.afterThread}:{},threadId:e.target.value})}>{data.threads.map(t=><option key={t.id} value={t.id}>{t.party} · {t.recipient}</option>)}</select></label>}
   {data.messages.length===0?<p>No saved messages in this conversation.</p>:<div className={styles.messageList}>{[...data.messages].reverse().map(m=><article key={m.id} data-direction={m.direction}><small>{m.direction==='incoming'?'Incoming':'Outgoing'} · {overviewTime(m.created_at)} CT · {m.state.replaceAll('_',' ')}</small><p>{m.body}</p></article>)}</div>}
   <div className={styles.messagePages}>{data.next&&<button onClick={()=>setQuery({...query,...data.next!,...(data.threadId?{threadId:data.threadId}:{})})}>Older messages</button>}{query.before&&<button onClick={()=>{const {before:_,beforeId:__,...rest}=query;setQuery(rest);}}>Latest messages</button>}{data.nextThread&&<button onClick={()=>setQuery({afterThread:data.nextThread!})}>More conversations</button>}{query.afterThread&&<button onClick={()=>setQuery({})}>First conversations</button>}</div>
  </>}
 </section>;
}
