'use client';
import {useEffect,useRef,useState} from 'react';
import {webinarRequest} from '@/lib/webinar-client';
import type {NetworkWorkspace} from '@/lib/buyer-network';

/** Open the selected response in place, using the same account-scoped inbox as the network. */
export function BuyerResponseDetails({dealId,matchId,onHandled}:{dealId:string;matchId:string;onHandled:()=>void}){
 const [buyer,setBuyer]=useState<NetworkWorkspace['buyers'][number]|null>(null),[error,setError]=useState(''),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[refresh,setRefresh]=useState(0);
 const locked=useRef(false);
 useEffect(()=>{const abort=new AbortController();setLoaded(false);setBuyer(null);setDone(false);setError('');void webinarRequest<NetworkWorkspace>(`/api/work/buyer-network?dealId=${encodeURIComponent(dealId)}`,{cache:'no-store',signal:abort.signal}).then(data=>{if(!abort.signal.aborted){setBuyer(data.buyers.find(b=>b.id===matchId)??null);setLoaded(true);}}).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Could not load this reply.');});return()=>abort.abort();},[dealId,matchId,refresh]);
 async function handled(){if(locked.current||!buyer)return;locked.current=true;setBusy(true);setError('');try{await webinarRequest('/api/work/buyer-network',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({matchId:buyer.id})});setDone(true);onHandled();}catch(e){setError(e instanceof Error?e.message:'Could not save.');}finally{locked.current=false;setBusy(false);}}
 return <div className="buyer-response-actions">
  {error&&<p role="alert">{error} <button type="button" disabled={busy} onClick={()=>setRefresh(v=>v+1)}>Refresh buyer</button></p>}{!loaded&&!error&&<p role="status">Loading buyer contact…</p>}
  {done?<p role="status">Marked handled. A new reply will appear for review.</p>:buyer?<><a href={`mailto:${encodeURIComponent(buyer.email)}`}>Email {buyer.name}</a><button type="button" className="workspace-quiet" disabled={busy} onClick={()=>void handled()}>{busy?'Saving…':'Mark handled'}</button></>:loaded&&<p>This response is no longer waiting for review. Refresh buyer activity to see the latest replies.</p>}
 </div>;
}
