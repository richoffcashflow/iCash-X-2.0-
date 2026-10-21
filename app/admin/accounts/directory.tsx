'use client';
import {OwnerWorkspaceTabs} from '@/components/owner-workspace-tabs';
import {useEffect,useState} from 'react';
import {webinarRequest} from '@/lib/webinar-client';
import {ownerAccountsSchema,type OwnerAccounts} from '@/lib/owner-accounts';
import {overviewMoney,overviewTime} from '@/lib/owner-overview';
import styles from './accounts.module.css';
export function AccountDirectory(){
 const [sort,setSort]=useState<'funded'|'leads'|'newest'>('funded'),[search,setSearch]=useState(''),[query,setQuery]=useState(''),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0);
 const [loaded,setLoaded]=useState<{key:string;report:OwnerAccounts}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(true),[opening,setOpening]=useState('');
 const key=JSON.stringify([sort,query,page]),report=loaded?.key===key?loaded.report:null;
 useEffect(()=>{const abort=new AbortController();setBusy(true);setError('');
  void webinarRequest<{report:unknown}>(`/api/admin/accounts?${new URLSearchParams({sort,q:query,page:String(page)})}`,{cache:'no-store',signal:abort.signal}).then(data=>{
   const value=ownerAccountsSchema.parse(data.report);if(value.sort!==sort||value.query!==query||value.page!==page)throw Error('Account list changed. Refresh to continue.');
   if(!abort.signal.aborted)setLoaded({key,report:value});
  }).catch(e=>{if(!abort.signal.aborted){setLoaded(null);setError(e instanceof Error?e.message:'Accounts could not load.');}}).finally(()=>{if(!abort.signal.aborted)setBusy(false);});
  return()=>abort.abort();
 },[sort,query,page,key,refresh]);
 async function open(accountId:string){if(opening)return;setOpening(accountId);setError('');try{
  const result=await webinarRequest<{url:string}>('/api/admin/accounts/view',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId})});
  if(!/^\/admin\/accounts\/[0-9a-f-]{36}$/.test(result.url))throw Error('Could not open the account.');window.location.assign(result.url);
 }catch(e){setError(e instanceof Error?e.message:'Could not open the account.');setOpening('');}}
 return <main className={styles.page}>
  <nav className={styles.nav} aria-label="Admin navigation"><a href="/admin">← Overview</a><a href="/">My workspace</a><span>iCash X · Owner</span></nav>
  <OwnerWorkspaceTabs active="accounts"/>
  <header className={styles.heading}><div><h1>Accounts</h1><p>Find a customer and open their workspace.</p></div><button disabled={busy} onClick={()=>setRefresh(n=>n+1)}>Refresh</button></header>
  <div className={styles.toolbar}><form role="search" onSubmit={e=>{e.preventDefault();setQuery(search.trim());setPage(1);}}><label className={styles.srOnly} htmlFor="account-search">Search accounts by name or email</label><input id="account-search" type="search" placeholder="Name or email" maxLength={100} value={search} onChange={e=>setSearch(e.target.value)}/><button>Search</button></form><label className={styles.sort}>Sort by <select value={sort} onChange={e=>{setSort(e.target.value as typeof sort);setPage(1);}}><option value="funded">Most funded</option><option value="leads">Highest leads</option><option value="newest">Newest accounts</option></select></label></div>
  {error&&<p role="alert" className={styles.notice}>{error} <a href="/dashboard-unlock?next=/admin/accounts">Unlock admin</a></p>}
  <p className={styles.caption} role="status">{busy?'Loading accounts…':report?`${report.total.toLocaleString('en-US')} accounts${query?` matching “${query}”`:''}`:'Account list unavailable'}</p>
  <div className={styles.tableWrap}><table className={styles.table}><caption className={styles.srOnly}>Customer accounts sorted by {sort==='funded'?'funding':sort==='leads'?'lead count':'creation date'}</caption><thead><tr><th scope="col">Account</th><th scope="col">Funded total</th><th scope="col">Credits left</th><th scope="col">Leads</th><th scope="col"><span className={styles.srOnly}>Open account</span></th></tr></thead><tbody>{report?.accounts.map(account=><tr key={account.id}>
   <td><strong>{account.name}</strong><span>{account.email??'No email saved'}</span><small>{account.ownAccount?'Your account · ':''}{account.vip?'VIP':'Standard'} · {account.paused?'Bot paused':'Run enabled'}</small></td>
   <td data-label="Funded total">{overviewMoney(account.fundedCents,'cents')}</td><td data-label="Credits left">{overviewMoney(account.balanceCents,'cents')}</td><td data-label="Leads">{account.leadCount.toLocaleString('en-US')}</td>
   <td>{account.ownAccount?<a className={styles.button} href="/">My workspace</a>:<button disabled={!!opening} onClick={()=>void open(account.id)} aria-label={`Open workspace for ${account.name}`}>{opening===account.id?'Opening…':'Open workspace'}</button>}<small>Joined {overviewTime(account.createdAt)} CT</small></td>
  </tr>)}</tbody></table>{report?.accounts.length===0&&<p className={styles.empty}>No accounts match this search.</p>}</div>
  {report&&<nav className={styles.pagination} aria-label="Account pages"><span>Page {page} of {Math.max(1,Math.ceil(report.total/25))}</span><div><button disabled={busy||page===1} onClick={()=>setPage(n=>n-1)}>Previous</button><button disabled={busy||page*25>=report.total} onClick={()=>setPage(n=>n+1)}>Next</button></div></nav>}
  <p className={styles.note}>Funded total is verified live work-credit purchases credited to the account. Subscription fees, test payments and grants are excluded. Credits left is the current spendable balance. Leads are saved properties and seller requests; practice and archived records are excluded.</p>
 </main>;
}
