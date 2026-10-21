'use client';
import {useEffect,useState} from 'react';
import {webinarRequest} from '@/lib/webinar-client';
import {ownerViewSchema,ownerLeadsSchema,type OwnerView,type OwnerLeads} from '@/lib/owner-accounts';
import {overviewMoney,overviewTime} from '@/lib/owner-overview';
import {PropertyCallHistory} from '@/components/property-call-history';
import styles from './accounts.module.css';

type Lead=OwnerLeads['leads'][number];
export function CustomerAccountView({viewId}:{viewId:string}){
 const base=`/api/admin/accounts/view/${viewId}`;
 const [view,setView]=useState<OwnerView|null>(null),[loaded,setLoaded]=useState<{key:string;leads:OwnerLeads}|null>(null),[error,setError]=useState(''),[ended,setEnded]=useState(false),[returning,setReturning]=useState(false);
 const [search,setSearch]=useState(''),[query,setQuery]=useState(''),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0),[open,setOpen]=useState(''),[busy,setBusy]=useState(true);
 const key=JSON.stringify([viewId,query,page]),leads=loaded?.key===key?loaded.leads:null;
 useEffect(()=>{
  if(ended)return;const controller=new AbortController();let inFlight=false;
  async function load(){if(inFlight||document.hidden)return;inFlight=true;setBusy(true);try{
   const [detail,rows]=await Promise.all([webinarRequest<{view:unknown}>(base,{cache:'no-store',signal:controller.signal}),webinarRequest<unknown>(`${base}/leads?${new URLSearchParams({q:query,page:String(page)})}`,{cache:'no-store',signal:controller.signal})]);
   const next=ownerViewSchema.parse(detail.view),nextLeads=ownerLeadsSchema.parse(rows);
   if(next.id!==viewId||nextLeads.query!==query||nextLeads.page!==page)throw Error('Account view changed. Reopen it from Accounts.');
   if(!controller.signal.aborted){setView(next);setLoaded({key,leads:nextLeads});setError('');}
  }catch(e){if(!controller.signal.aborted){setError(e instanceof Error?e.message:'Could not refresh this account.');const status=(e as {status?:number}).status;if(status===401||status===403||status===410){setView(null);setLoaded(null);setEnded(true);}}}finally{inFlight=false;if(!controller.signal.aborted)setBusy(false);}}
  void load();const timer=setInterval(()=>void load(),30000);const visible=()=>void load();document.addEventListener('visibilitychange',visible);
  return()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[base,viewId,key,query,page,refresh,ended]);
 useEffect(()=>{if(!view)return;const timer=setTimeout(()=>{setView(null);setLoaded(null);setEnded(true);setError('This account view has expired. Open it again from Accounts.');},Math.max(0,Date.parse(view.expiresAt)-Date.now()));return()=>clearTimeout(timer);},[view?.expiresAt]);
 async function leave(){if(returning)return;setReturning(true);try{await webinarRequest(base,{method:'DELETE'});window.location.assign('/admin/accounts');}catch(e){setError(e instanceof Error?e.message:'Could not end this view.');setReturning(false);}}
 const account=view?.account;
 return <main className={styles.page}>
  <div className={styles.viewBanner} role="status"><div><strong>{account?`Viewing ${account.name}`:'Customer workspace'}</strong><span>Read-only support view{view?` · Ends ${overviewTime(view.expiresAt)} CT`:''}</span></div><button disabled={returning} onClick={()=>void leave()}>{returning?'Returning…':'Return to admin'}</button></div>
  {error&&<p className={styles.notice} role="alert">{error} {ended?<a href="/admin/accounts">Back to Accounts</a>:<button onClick={()=>setRefresh(n=>n+1)}>Retry</button>}</p>}
  {!account&&!ended&&<p role="status" className={styles.empty}>Opening customer workspace…</p>}
  {account&&<>
   <header className={styles.heading}><div><h1>{account.name}</h1><p>{account.email??'No email saved'}</p></div><span className={styles.badge}>{account.vip?'VIP':'Standard'}</span></header>
   <div className={styles.metrics}><article><span>Credits left</span><strong>{overviewMoney(account.balanceCents,'cents')}</strong><small>{overviewMoney(account.reservedCents,'cents')} in existing reservations</small></article><article><span>Funded total</span><strong>{overviewMoney(account.fundedCents,'cents')}</strong><small>Verified live credit purchases</small></article><article><span>Leads</span><strong>{account.leadCount.toLocaleString('en-US')}</strong><small>Saved properties and seller requests</small></article><article><span>{account.assistantName||'Bot'} controls</span><strong className={styles.statusText}>{account.paused?'Paused':'Run enabled'}</strong><small>{account.membership?account.membership.state==='active'&&Date.parse(account.membership.paidThrough??'')>Date.now()?'Membership active':'Membership inactive':account.billingModel==='membership_credits'?'No active membership':'Legacy account'}. Work still depends on credits and eligibility.</small></article></div>
   <section className={styles.leadSection} aria-label="Customer leads"><div className={styles.toolbar}><div><h2>Properties & seller requests</h2><p className={styles.caption}>Interested sellers and responses first</p></div><form role="search" onSubmit={e=>{e.preventDefault();setQuery(search.trim());setPage(1);setOpen('');}}><label className={styles.srOnly} htmlFor="customer-property-search">Search customer properties</label><input id="customer-property-search" type="search" maxLength={100} value={search} placeholder="Street, city or ZIP" onChange={e=>setSearch(e.target.value)}/><button>Search</button></form></div>
   {leads?.leads.map(lead=><article className={styles.lead} key={lead.id}><button className={styles.leadToggle} aria-expanded={open===lead.id} onClick={()=>setOpen(open===lead.id?'':lead.id)}><span><strong>{lead.address}</strong><small>{lead.optedOut?'Do not contact':lead.interested?'Interested seller':lead.responded?'Seller responded':lead.state==='awaiting_address'?'Collecting address':lead.financialStatus==='eligible'?'Financially eligible':'Saved property'} · {overviewTime(lead.createdAt)} CT</small></span><span>{open===lead.id?'Close':'View details'}</span></button>{open===lead.id&&<LeadDetails key={`${viewId}:${lead.id}`} base={base} lead={lead}/>}</article>)}
   {!leads&&<p role="status">{error?'Lead list unavailable.':'Loading properties…'}</p>}{leads?.leads.length===0&&<p className={styles.empty}>No properties or seller requests match this search.</p>}
   {leads&&<nav className={styles.pagination} aria-label="Customer property pages"><span>{leads.total.toLocaleString('en-US')} leads · Page {page} of {Math.max(1,Math.ceil(leads.total/12))}</span><div><button disabled={busy||page===1} onClick={()=>{setPage(n=>n-1);setOpen('');}}>Previous</button><button disabled={busy||page*12>=leads.total} onClick={()=>{setPage(n=>n+1);setOpen('');}}>Next</button></div></nav>}
   </section><p className={styles.note}>You are signed in as the platform owner. Viewing is recorded. Customer settings, credits, messages and work controls stay unchanged.</p>
  </>}
 </main>;
}

type Details={conversations:Parameters<typeof PropertyCallHistory>[0]['conversations'];contacts:{name?:string|null;phones?:{number?:string|null;type?:string|null}[]}[]};
function LeadDetails({base,lead}:{base:string;lead:Lead}){
 const [data,setData]=useState<Details|null>(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 useEffect(()=>{const controller=new AbortController();setError('');void webinarRequest<Details>(`${base}/details?screeningId=${lead.id}`,{cache:'no-store',signal:controller.signal}).then(d=>{if(!controller.signal.aborted)setData(d);}).catch(()=>{if(!controller.signal.aborted)setError('Saved contact details could not load.');});return()=>controller.abort();},[base,lead.id,refresh]);
 return <div className={styles.details}>{error&&<p role="alert">{error} <button onClick={()=>setRefresh(n=>n+1)}>Retry</button></p>}
  {data&&data.contacts.length>0&&<section aria-label="Saved contacts"><h3>Saved contacts</h3>{data.contacts.map((c,i)=><p key={i}>{c.name||'Contact'}{c.phones?.map((p,j)=><span key={j}> · {p.number||'Number unavailable'}{p.type?` (${p.type})`:''}</span>)}</p>)}</section>}
  <PropertyCallHistory apiBase={base} screeningId={lead.id} conversations={data?.conversations??[]}/>
  <ReadOnlyMessages base={base} screeningId={lead.id}/>
 </div>;
}
type Messages={threads:{id:string;recipient:string;party:string}[];threadId:string|null;messages:{id:string;body:string;direction:string;state:string;created_at:string}[];next:{before:string;beforeId:string}|null;nextThread:string|null};
function ReadOnlyMessages({base,screeningId}:{base:string;screeningId:string}){
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
