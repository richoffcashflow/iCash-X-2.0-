'use client';
import {useEffect,useState} from 'react';
import {ClosingProgress} from './closing-progress';
import type {ClosingUpdate} from '@/lib/closing-progress';
import {TitleTasks,type TitleTask} from './title-tasks';
type Progress={closingUpdates?:ClosingUpdate[];titleTasks?:TitleTask[];titleReplies?:{id:string;sender:string;subject:string;body_text:string;received_at:string;needs_review:boolean}[];title?:string|null;titleReady?:boolean;candidates?:{id:string;name:string}[];job?:{state:string;updated_at:string;result?:{buyerStatus:string;buyerCount:number}};documents:{id:string;kind:string}[];buyers:{buyer_id:string;name:string;rank:number;ready:boolean}[]};
export function FulfillmentDetails({dealId}:{dealId:string}){
 const [refresh,setRefresh]=useState(0);
 const [open,setOpen]=useState(false),[data,setData]=useState<Progress|null>(null),[error,setError]=useState(''),[sending,setSending]=useState(false),[titleMessage,setTitleMessage]=useState('');
 useEffect(()=>{if(!open)return;const abort=new AbortController();let inFlight=false;
 async function load(){if(document.hidden||inFlight)return;inFlight=true;try{const r=await fetch(`/api/work/fulfillment?dealId=${dealId}`,{signal:abort.signal,cache:'no-store'});if(!r.ok)throw Error();const next=await r.json();if(!abort.signal.aborted){setData(next);setError('');}}catch{if(!abort.signal.aborted)setError('Could not refresh progress. Your saved work is unchanged.');}finally{inFlight=false;}}
 void load();const timer=setInterval(load,30000);document.addEventListener('visibilitychange',load);return()=>{abort.abort();clearInterval(timer);document.removeEventListener('visibilitychange',load);};},[open,dealId,refresh]);
 async function download(doc:Progress['documents'][number]){try{const response=await fetch(`/api/work/documents?id=${doc.id}`,{cache:'no-store'});if(!response.ok)throw Error();const file=await response.json();const url=URL.createObjectURL(new Blob([file.html],{type:'text/html'}));const a=document.createElement('a');a.href=url;a.download=file.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{setError('Could not open the document. Please retry.');}}

 return <details onToggle={e=>{if(e.target===e.currentTarget)setOpen(e.currentTarget.open);}}><summary>🤝 Buyers & closing</summary>{error&&<p role="alert">{error}</p>}{open&&!data&&!error&&<p role="status">Loading…</p>}{open&&data&&<>
 <p>{data.job?.state==='complete'?'Your deal documents are prepared.':'Preparation starts after verified purchase signatures and resumes when your bot is running.'}</p>
 {data.documents.map(doc=><button key={doc.id} onClick={()=>download(doc)}>{doc.kind==='buyer_package'?'View buyer package':'View title request'}</button>)}
 <p>{data.job?.result?.buyerStatus==='marketing_review_required'?'Marketing permission and buyer pricing need review.':data.job?.result?.buyerStatus==='buyer_sourcing_required'?'No stored buyers currently match. Buyer sourcing is still needed.':data.buyers.length?`${data.buyers.length} buyer matches found. Open activity to see outreach progress.`:''}</p>
 {data.buyers.length>0&&data.job&&<small>Matches checked {new Date(data.job.updated_at).toLocaleString()}</small>}{data.buyers.length>0&&<ol>{data.buyers.slice(0,5).map(b=><li key={b.buyer_id}>{b.name} — {b.ready?'Funds and authority verified at last check':'Funds or authority need review'}</li>)}</ol>}
 {data.buyers.length>5&&<p>{data.buyers.length-5} more matches saved.</p>}
 {!!data.candidates?.length&&<details><summary>{data.candidates.length} potential buyers found</summary><p>Found through ownership records. Buying interest, funds and contact permission are not yet confirmed.</p><ul>{data.candidates.slice(0,5).map(c=><li key={c.id}>{c.name}</li>)}</ul></details>}
 {data.title==='sent'?<p>📨 Title opening requested. Awaiting the closing office’s confirmation.</p>:data.titleReady&&(!data.title||data.title==='ready')?<button disabled={sending} onClick={async()=>{setSending(true);try{const r=await fetch('/api/work/title',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dealId,confirmed:true})});const d=await r.json();if(!r.ok)throw Error(d.error);setTitleMessage(d.status==='title_request_sent'?'Title request sent. Awaiting confirmation.':'Request held for review.');setRefresh(v=>v+1);}catch(e){setTitleMessage(e instanceof Error?e.message:'Request needs review.');}finally{setSending(false);}}}>{sending?'Sending…':'Send signed agreement to verified title contact'}</button>:data.title&&<p>Title request needs review.</p>}
 <ClosingProgress dealId={dealId} updates={data.closingUpdates??[]} replies={data.titleReplies??[]} onSaved={()=>setRefresh(v=>v+1)}/>
 {data.titleTasks&&<TitleTasks key={dealId+data.titleTasks.map(t=>`${t.id}:${t.state}:${t.email_state}`).join(',')} initialTasks={data.titleTasks}/>}
 {!!data.titleReplies?.length&&<details><summary>📩 Title replies ({data.titleReplies.length})</summary>{data.titleReplies.map(reply=><article key={reply.id}><p><strong>{reply.sender}</strong> · {new Date(reply.received_at).toLocaleString()}</p><p>{reply.subject}</p><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:240,overflowY:'auto'}}>{reply.body_text}</p></article>)}<small>Messages are shown as received. Verify deadlines and payment instructions with your closer.</small></details>}
 {titleMessage&&<p role="status">{titleMessage}</p>}
 {data.documents.length>0&&<small>Downloaded packages are drafts. Closing and deposit status require confirmation from the closing office.</small>}
 </>}</details>;
}
