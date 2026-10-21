'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {supportRequest} from '@/lib/support-client';
type RequestRow={id:string;email:string;phone:string|null;status:string;created_at:string;updated_at:string};
type Investigation={checkedAt:string;recovery:string;emailConfigured:boolean;textConfigured:boolean;textSenderAvailable:boolean;receiptEmailMatch:boolean;purchaseEmail:{status:string;delivery:string|null}|null;phoneChallenge:{status:string;hasReceipt:boolean;requestedAt:string}|null};
type Message={id:string;role:string;content:string;created_at:string;access_investigation?:Investigation|null};
type Purchase={id:string;email:string;paid_at:string;email_status:string|null;email_delivery:string|null;text_status:string|null;text_delivery:string|null;reason:string};
const when=(value:string)=>new Date(value).toLocaleString('en-US',{hour12:true});
const delivery=(state:string|null,receipt:string|null)=>receipt==='delivered'?'Delivered to provider destination':receipt??(state==='sent'?'Accepted; delivery unconfirmed':state??'Not queued');
export function AccessSupportDashboard(){
 const [requests,setRequests]=useState<RequestRow[]>([]),[purchases,setPurchases]=useState<Purchase[]>([]),[selected,setSelected]=useState<RequestRow|null>(null),[messages,setMessages]=useState<Message[]>([]);
 const [status,setStatus]=useState('open'),[reply,setReply]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const pending=useRef<{body:string;id:string}|null>(null),working=useRef(false);
 const investigation=messages.findLast(message=>message.access_investigation)?.access_investigation;
 const clear=()=>{setRequests([]);setPurchases([]);setSelected(null);setMessages([]);setReply('');};
 const load=useCallback(async()=>{
  try{const {data,ok,status:code}=await supportRequest<{requests:RequestRow[];purchases:Purchase[];error?:string}>('/api/support/admin/access',{cache:'no-store'});if(code===403)clear();if(!ok)throw Error(data.error);setRequests(data.requests);setPurchases(data.purchases);setError('');}
  catch(e){setError(e instanceof Error?e.message:'Access support could not load.');}
 },[]);
 useEffect(()=>{void load();},[load]);
 async function open(id:string){
  setBusy(true);setError('');try{const {data,ok,status:code}=await supportRequest<{request:RequestRow;messages:Message[];error?:string}>('/api/support/admin/access?id='+id,{cache:'no-store'});if(code===403)clear();if(!ok)throw Error(data.error);setSelected(data.request);setMessages(data.messages);setStatus(data.request.status);setReply('');pending.current=null;}
  catch(e){setError(e instanceof Error?e.message:'Request could not load.');}finally{setBusy(false);}
 }
 async function save(event:React.FormEvent){
  event.preventDefault();if(!selected||working.current)return;working.current=true;setBusy(true);setError('');setNotice('');
  const body=JSON.stringify({id:selected.id,status,...(reply.trim()?{reply:reply.trim()}:{})});if(!pending.current||pending.current.body!==body)pending.current={body,id:crypto.randomUUID()};
  try{const {ok,data,status:code}=await supportRequest<{saved?:boolean;error?:string}>('/api/support/admin/access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...JSON.parse(body),requestId:pending.current.id})});if(code===403)clear();if(!ok||!data.saved)throw Error(data.error||'Could not confirm the reply.');await open(selected.id);await load();setNotice('Saved. The buyer can read your reply on their access-help page without signing in.');}
  catch(e){setError(e instanceof Error?e.message:'Could not save. Your draft is still here.');}finally{working.current=false;setBusy(false);}
 }
 return <section aria-label="Paid access support" className="support-notice">
  <h2>Paid access support</h2><p>{requests.length}{requests.length===100?'+':''} open help requests · {purchases.length}{purchases.length===100?'+':''} paid purchases to check</p>
  <button type="button" disabled={busy} onClick={()=>void load()}>Refresh access queue</button>
  <p>Buyers who cannot sign in can contact you at <a href="/access/help">geticashx.com/access/help</a>. Their replies stay on that page in their browser.</p>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {purchases.length>0&&<details><summary>Paid purchases needing follow-up</summary><p>These purchases have no linked account yet. Delivery receipts do not prove the buyer signed in. Check current status before contacting them; do not ask them to pay again.</p>{purchases.map(p=><article key={p.id} className="support-message"><strong>{p.email}</strong><p>{p.reason==='delivery_problem'?'Access message needs delivery review':p.reason==='delivery_pending'?'First access email has not been confirmed':'Account not linked yet'} · Paid {when(p.paid_at)}</p><p>Email: {delivery(p.email_status,p.email_delivery)}<br/>Text: {delivery(p.text_status,p.text_delivery)}</p><a href={'/access?purchase='+p.id} target="_blank" rel="noopener noreferrer">Buyer’s access link</a></article>)}</details>}
  {requests.length>0&&<nav className="support-ticket-list" aria-label="Access help requests">{requests.map(request=><button key={request.id} disabled={busy} aria-pressed={selected?.id===request.id} onClick={()=>void open(request.id)}>{request.email}<small>{request.status.replaceAll('_',' ')} · {when(request.updated_at)}</small></button>)}</nav>}
  {selected&&<><h3>{selected.email}</h3><p>Email and phone are supplied by the visitor and are not identity verification. {selected.phone&&<>Phone supplied: {selected.phone}.</>} Never post account details, sign-in codes, or private documents here.</p>
  {investigation&&<details><summary>Sign-in checks · {when(investigation.checkedAt)}</summary><p>Private support findings. A matching email does not verify this visitor’s identity.</p><ul>
   <li>Email sign-in: {investigation.emailConfigured?'Configured; code delivery unverified':'Unavailable'}</li>
   <li>Text sign-in: {investigation.textConfigured&&investigation.textSenderAvailable?'Configured; recipient eligibility still required':'Unavailable'}</li>
   <li>Paid receipt with supplied email: {investigation.receiptEmailMatch?'Found':'Not found; this does not prove no payment'}</li>
   <li>Purchase welcome email: {investigation.purchaseEmail?delivery(investigation.purchaseEmail.status,investigation.purchaseEmail.delivery):'No matching record'}. This is not a sign-in code receipt.</li>
   <li>Recent text-code attempt: {investigation.phoneChallenge?`${investigation.phoneChallenge.status} · ${investigation.phoneChallenge.hasReceipt?'Accepted; delivery unconfirmed':'No provider receipt'} · ${when(investigation.phoneChallenge.requestedAt)}`:'No matching record in the last 7 days'}</li>
   <li>Safe account-link check: {investigation.recovery==='checked'?'Completed; access restoration not confirmed':'Could not complete'}</li>
  </ul></details>}
  <div className="support-messages">{messages.map(message=><article key={message.id} className="support-message"><strong>{message.role==='user'?'Visitor':'Support team'} · {when(message.created_at)}</strong><p>{message.content}</p></article>)}</div><form onSubmit={save}><label>Reply about access<textarea aria-label="Reply about access" value={reply} onChange={event=>setReply(event.target.value)} maxLength={2000} disabled={busy}/></label><label>Access request status<select aria-label="Access request status" value={status} onChange={event=>setStatus(event.target.value)} disabled={busy}>{['open','waiting_on_customer','resolved'].map(value=><option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label><button disabled={busy} className="support-primary">{busy?'Saving…':'Save access reply'}</button></form></>}
 </section>;
}
