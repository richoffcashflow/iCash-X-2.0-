'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {OperatorExceptions} from '@/components/operator-exceptions';
import {supportRequest} from '@/lib/support-client';
import type {SupportEvidence} from '@/lib/support-policy';
type Ticket={id:string;kind:'access'|'account';subject:string;status:string;updated_at:string;account_id?:string;email?:string;phone?:string|null};
type Message={id:string;role:string;content:string;created_at:string};
type CancelReview={id:string;account_id:string;mode:string;state:string;result:string|null;receipt_state?:string};
type Purchase={id:string;email:string;paid_at:string;email_status:string|null;email_delivery:string|null;text_status:string|null;text_delivery:string|null;reason:string};
type Queue={threads:Ticket[];cancellations:CancelReview[];deployment:{detail:string};error?:string};
type AccessQueue={requests:(Omit<Ticket,'kind'|'subject'>&{email:string})[];purchases:Purchase[];error?:string};
type Detail={thread?:Ticket;request?:Ticket;messages:Message[];evidence?:SupportEvidence[];error?:string};
const key=(t:Ticket)=>`${t.kind}:${t.id}`;
const when=(value:string)=>new Date(value).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true});
const label=(status:string)=>status==='resolved'?'Resolved':status==='waiting_on_customer'?'Waiting on customer':'Needs you';
const delivery=(state:string|null,receipt:string|null)=>receipt??(state==='sent'?'Accepted; delivery unconfirmed':state??'Not queued');
export function SupportDashboard(){
 const [tickets,setTickets]=useState<Ticket[]>([]),[selected,setSelected]=useState<Ticket|null>(null),[messages,setMessages]=useState<Message[]>([]),[evidence,setEvidence]=useState<SupportEvidence[]>([]);
 const [cancellations,setCancellations]=useState<CancelReview[]>([]),[purchases,setPurchases]=useState<Purchase[]>([]),[deployment,setDeployment]=useState('');
 const [filter,setFilter]=useState('needs'),[search,setSearch]=useState(''),[drafts,setDrafts]=useState<Record<string,string>>({}),[toolsOpen,setToolsOpen]=useState(false);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const sequence=useRef(0),queueSequence=useRef(0),working=useRef(false),selectedRef=useRef<Ticket|null>(null),pending=useRef<Record<string,{body:string;id:string}>>({});
 const clear=useCallback(()=>{sequence.current++;selectedRef.current=null;pending.current={};setTickets([]);setSelected(null);setMessages([]);setEvidence([]);setDrafts({});setPurchases([]);setCancellations([]);setDeployment('');setToolsOpen(false);setNotice('');},[]);
 const loadQueue=useCallback(async()=>{
  const seq=++queueSequence.current;
  try{
   const [a,b]=await Promise.all([supportRequest<Queue>('/api/support/admin',{cache:'no-store'}),supportRequest<AccessQueue>('/api/support/admin/access',{cache:'no-store'})]);
   if(seq!==queueSequence.current)return;
   if(a.status===403||b.status===403){clear();throw Error('Sign in with a support operator account to open this inbox.');}
   if(!a.ok||!b.ok)throw Error(a.data.error||b.data.error||'Could not refresh the inbox.');
   const items:Ticket[]=[...a.data.threads.map(t=>({...t,kind:'account' as const})),...b.data.requests.map(t=>({...t,kind:'access' as const,subject:t.email}))];
   setTickets(items.sort((a,b)=>new Date(b.updated_at).getTime()-new Date(a.updated_at).getTime()));setCancellations(a.data.cancellations);setPurchases(b.data.purchases);setDeployment(a.data.deployment?.detail??'');setError('');
  }catch(e){if(seq===queueSequence.current)setError(e instanceof Error?e.message:'Could not load support.');}finally{if(seq===queueSequence.current)setLoading(false);}
 },[clear]);
 const open=useCallback(async(ticket:Ticket,quiet=false)=>{
  const seq=++sequence.current;if(!quiet){setBusy(true);setNotice('');}setError('');
  try{
   const path=ticket.kind==='access'?'/api/support/admin/access?id=':'/api/support/admin?threadId=';
   const {ok,status,data}=await supportRequest<Detail>(path+ticket.id,{cache:'no-store'});
   if(seq!==sequence.current)return;
   if(status===403){clear();throw Error('Sign in with a support operator account to open this inbox.');}if(!ok)throw Error(data.error||'Could not open the conversation.');
   const current={...ticket,...(data.thread??data.request),kind:ticket.kind};selectedRef.current=current;setSelected(current);setMessages(data.messages);setEvidence(data.evidence??[]);
  }catch(e){if(seq===sequence.current||!selectedRef.current)setError(e instanceof Error?e.message:'Could not load the conversation.');}finally{if(!quiet)setBusy(false);}
 },[clear]);
 useEffect(()=>{void loadQueue();const refresh=()=>{if(!document.hidden&&!working.current){void loadQueue();if(selectedRef.current)void open(selectedRef.current,true);}};const timer=setInterval(refresh,20000);document.addEventListener('visibilitychange',refresh);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',refresh);queueSequence.current++;sequence.current++;};},[loadQueue,open]);
 const reply=selected?drafts[key(selected)]??'':'';
 async function save(status:string,send:boolean){
  if(!selected||working.current||busy||send&&!reply.trim())return;
  working.current=true;setBusy(true);setError('');setNotice('');const ticket=selected,k=key(ticket);
  const body=JSON.stringify({[ticket.kind==='access'?'id':'threadId']:ticket.id,status,...(send?{reply:reply.trim()}:{})});
  if(pending.current[k]?.body!==body)pending.current[k]={body,id:crypto.randomUUID()};
  try{
   const {ok,status:code,data}=await supportRequest<{saved?:boolean;error?:string}>('/api/support/admin'+(ticket.kind==='access'?'/access':''),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...JSON.parse(body),requestId:pending.current[k].id})});
   if(code===403){clear();throw Error('Sign in with a support operator account to reply.');}if(!ok||!data.saved)throw Error(data.error||'Could not confirm the update. Your draft is still here.');
   delete pending.current[k];if(send)setDrafts(current=>({...current,[k]:''}));await open(ticket,true);await loadQueue();setNotice(send?'Reply sent. The customer can read it in this conversation.':status==='resolved'?'Conversation resolved.':'Conversation reopened.');
  }catch(e){setError(e instanceof Error?e.message:'Could not save. Your draft is still here.');}finally{working.current=false;setBusy(false);}
 }
 const needs=tickets.filter(t=>!['resolved','waiting_on_customer'].includes(t.status)).length;
 const waiting=tickets.filter(t=>t.status==='waiting_on_customer').length;
 const visible=tickets.filter(t=>(filter==='all'||filter==='waiting'&&t.status==='waiting_on_customer'||filter==='needs'&&!['resolved','waiting_on_customer'].includes(t.status))&&`${t.subject} ${t.email??''}`.toLowerCase().includes(search.toLowerCase()));
 return <section className="support-shell support-admin support-desk" aria-label="Support inbox">
  <header className="desk-heading"><div><p className="support-eyebrow">iCash X</p><h1>Support</h1><p>Conversations, all in one place.</p></div><div><a href="/">Workspace ↗</a><button type="button" disabled={busy||loading} onClick={()=>{void loadQueue();if(selectedRef.current)void open(selectedRef.current,true);}}>Refresh</button></div></header>
  {error&&<p role="alert" className="support-error">{error}</p>}{notice&&<p role="status" className="support-notice">{notice}</p>}
  <div className={`desk-inbox${selected?' desk-has-selection':''}`}>
   <aside className="desk-sidebar">
    <div className="desk-filters" aria-label="Filter conversations">{[['needs','Needs you',needs],['waiting','Waiting',waiting],['all','All',tickets.length]].map(([value,title,count])=><button key={value} type="button" aria-pressed={filter===value} onClick={()=>setFilter(String(value))}>{title}<span>{count}</span></button>)}</div>
    <label className="desk-search"><span className="desk-sr">Search conversations</span><input type="search" placeholder="Search conversations…" value={search} onChange={e=>setSearch(e.target.value)}/></label>
    <nav aria-label="Conversations" className="desk-ticket-list">{loading?<p className="desk-empty">Loading conversations…</p>:visible.length===0?<div className="desk-empty"><strong>{filter==='needs'?'You’re all caught up':'No conversations here'}</strong><p>{filter==='needs'?'Automatic replies collect the details. Anything that needs you appears here.':'Try another filter or search.'}</p></div>:visible.map(t=><button type="button" key={key(t)} disabled={busy} aria-pressed={!!selected&&key(selected)===key(t)} onClick={()=>void open(t)}><span className="desk-ticket-top"><span>{t.kind==='access'?'Sign-in help':'Account support'}</span><span>{when(t.updated_at)}</span></span><strong>{t.subject}</strong><span className={`desk-badge ${t.status==='open'||t.status==='escalated'?'desk-badge-active':''}`}>{label(t.status)}</span></button>)}</nav>
    <p className="desk-automation">Automatic replies collect details.<br/>You handle anything that needs a person.</p>
   </aside>
   <section className="desk-conversation" aria-label="Selected conversation">
    {selected?<><header className="desk-conversation-heading"><button className="desk-back" type="button" onClick={()=>{sequence.current++;selectedRef.current=null;setSelected(null);setMessages([]);}}>← Inbox</button><div><p className="support-eyebrow">{selected.kind==='access'?'Sign-in help':'Account support'}</p><h2>{selected.subject}</h2></div><button type="button" disabled={busy} onClick={()=>void save(selected.status==='resolved'?'open':'resolved',false)}>{selected.status==='resolved'?'Reopen':'Mark resolved'}</button></header>
    <details className="desk-details"><summary>{label(selected.status)} · Customer details & checks</summary>{selected.kind==='access'?<p>This visitor’s email and phone are unverified. Keep replies to sign-in guidance; never post codes or private account information.{selected.phone&&<> Phone supplied: {selected.phone}.</>}</p>:<><p>Account: {selected.account_id}</p>{evidence.map(e=><p key={e.key}>{e.detail}<br/><small>{when(e.observedAt)}</small></p>)}</>}<p>Conversation: {selected.id}</p></details>
     <div className="desk-messages" role="log" aria-label="Conversation messages">{messages.filter(m=>m.role!=='system').map(m=><article key={m.id} className={`desk-message desk-message-${m.role}`}><div><strong>{m.role==='user'?'Customer':m.role==='assistant'?'Support assistant':'You · Support team'}</strong><time dateTime={m.created_at}>{when(m.created_at)}</time></div><p>{m.content}</p></article>)}</div>
     <form className="desk-composer" onSubmit={e=>{e.preventDefault();void save('waiting_on_customer',true);}}><label htmlFor="desk-reply">Reply to customer</label><textarea id="desk-reply" placeholder="Write a helpful reply…" value={reply} onChange={e=>setDrafts(current=>({...current,[key(selected)]:e.target.value}))} maxLength={2000} rows={3} disabled={busy}/><div><small>Replies appear in the customer’s support chat.</small><button className="support-primary" disabled={busy||!reply.trim()}>{busy?'Saving…':'Send reply ↗'}</button></div></form>
    </>:<div className="desk-welcome"><span aria-hidden="true">↖</span><h2>Your inbox is ready</h2><p>Choose a conversation to read the history and reply.</p><small>Sign-in help and account support live here together.</small></div>}
   </section>
  </div>
  <details className="desk-more" onToggle={e=>setToolsOpen(e.currentTarget.open)}><summary>More tools <span>Purchases, cancellations & diagnostics</span></summary>{toolsOpen&&<div className="desk-more-content"><a href="/support/buyer-reviews">Buyer evidence review ↗</a>
   <details><summary>Purchase access checks ({purchases.length})</summary><p>Check current delivery before contacting a buyer. Do not ask them to pay again.</p>{purchases.map(p=><article className="support-message" key={p.id}><strong>{p.email}</strong><p>Paid {when(p.paid_at)}<br/>Email: {delivery(p.email_status,p.email_delivery)}<br/>Text: {delivery(p.text_status,p.text_delivery)}</p><a href={'/access?purchase='+p.id} target="_blank" rel="noopener noreferrer">Buyer’s access page ↗</a></article>)}</details>
   <details><summary>Cancellation checks ({cancellations.length})</summary>{cancellations.map(c=><p key={c.id}>{c.state.replaceAll('_',' ')} ({c.mode}) · {c.result??'Check the cancellation status.'}<br/>Email receipt: {c.receipt_state??'Not available'}<br/>Account: {c.account_id} · Request: {c.id}</p>)}</details>
   <details><summary>Deployment diagnostics</summary><p>{deployment||'Unavailable'}</p></details><OperatorExceptions/></div>}</details>
 </section>;
}
