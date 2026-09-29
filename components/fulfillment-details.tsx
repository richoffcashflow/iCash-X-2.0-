'use client';
import {useEffect,useState} from 'react';
type Progress={job?:{state:string;updated_at:string;result?:{buyerStatus:string;buyerCount:number}};documents:{id:string;kind:string;html:string}[];buyers:{buyer_id:string;name:string;rank:number;ready:boolean}[]};
export function FulfillmentDetails({dealId}:{dealId:string}){
 const [open,setOpen]=useState(false),[data,setData]=useState<Progress|null>(null),[error,setError]=useState('');
 useEffect(()=>{if(!open)return;const abort=new AbortController();setData(null);setError('');void fetch(`/api/work/fulfillment?dealId=${dealId}`,{signal:abort.signal,cache:'no-store'}).then(async r=>{if(!r.ok)throw Error();const next=await r.json();if(!abort.signal.aborted)setData(next);}).catch(()=>{if(!abort.signal.aborted)setError('Could not load progress. Close and reopen to retry.');});return()=>abort.abort();},[open,dealId]);
 function download(doc:Progress['documents'][number]){const url=URL.createObjectURL(new Blob([doc.html],{type:'text/html'}));const a=document.createElement('a');a.href=url;a.download=`icash-${doc.kind}-draft.html`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary>🤝 Buyers & closing preparation</summary>{error&&<p role="alert">{error}</p>}{open&&!data&&!error&&<p role="status">Loading…</p>}{data&&<>
 <p>{data.job?.state==='complete'?'Your deal documents are prepared.':'Preparation starts after verified purchase signatures and resumes when your bot is running.'}</p>
 {data.documents.map(doc=><button key={doc.id} onClick={()=>download(doc)}>{doc.kind==='buyer_package'?'View buyer package':'View title request'}</button>)}
 <p>{data.job?.result?.buyerStatus==='marketing_review_required'?'Marketing permission and buyer pricing need review.':data.job?.result?.buyerStatus==='buyer_sourcing_required'?'No stored buyers currently match. Buyer sourcing is still needed.':data.buyers.length?`${data.buyers.length} buyer matches found. Outreach has not been sent.`:''}</p>
 {data.buyers.length>0&&data.job&&<small>Matches checked {new Date(data.job.updated_at).toLocaleString()}</small>}{data.buyers.length>0&&<ol>{data.buyers.slice(0,5).map(b=><li key={b.buyer_id}>{b.name} — {b.ready?'Funds and authority verified at last check':'Funds or authority need review'}</li>)}</ol>}
 {data.buyers.length>5&&<p>{data.buyers.length-5} more matches saved.</p>}
 {data.documents.length>0&&<small>Drafts only. No title request has been sent, deposit received, or closing confirmed.</small>}
 </>}</details>;
}
