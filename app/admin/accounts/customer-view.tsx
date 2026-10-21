'use client';
import {useCallback,useEffect,useState} from 'react';
import dynamic from 'next/dynamic';
import {webinarRequest} from '@/lib/webinar-client';
import {ownerViewSchema,type OwnerView} from '@/lib/owner-accounts';
import {overviewTime} from '@/lib/owner-overview';
import {BotRunBar} from '@/components/bot-run-bar';
import {BudgetSummary} from '@/components/budget-summary';
import {OwnerWorkspaceTabs} from '@/components/owner-workspace-tabs';
import '@/app/icash-brand.css';
import '@/app/workspace-course.css';
import workspaceStyles from '@/app/workspace-easy.module.css';
import styles from './accounts.module.css';
const LiveWorkspace=dynamic(()=>import('@/components/live-workspace').then(m=>m.LiveWorkspace));
const noAction=()=>{};

export function CustomerAccountView({viewId}:{viewId:string}){
 const base=`/api/admin/accounts/view/${viewId}`;
 const [view,setView]=useState<OwnerView|null>(null),[error,setError]=useState(''),[ended,setEnded]=useState(false),[returning,setReturning]=useState(false),[refresh,setRefresh]=useState(0),[hasLeads,setHasLeads]=useState<boolean|undefined>();
 const accessLost=useCallback(()=>{setView(null);setEnded(true);setError('This account view has ended. Open the account again from Accounts.');},[]);
 useEffect(()=>{
  if(ended)return;const controller=new AbortController();let inFlight=false;
  async function load(){if(inFlight||document.hidden)return;inFlight=true;try{
   const detail=await webinarRequest<{view:unknown}>(base,{cache:'no-store',signal:controller.signal});
   const next=ownerViewSchema.parse(detail.view);
   if(next.id!==viewId||Date.parse(next.expiresAt)<=Date.now())throw Object.assign(Error('Account view expired.'),{status:410});
   if(!controller.signal.aborted){setView(next);setError('');}
  }catch(e){if(!controller.signal.aborted){if([401,403,410].includes((e as {status?:number}).status??0))accessLost();else setError(e instanceof Error?e.message:'Could not refresh this account.');}}finally{inFlight=false;}}
  void load();const timer=setInterval(()=>void load(),30000);const visible=()=>void load();document.addEventListener('visibilitychange',visible);
  return()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[base,viewId,refresh,ended,accessLost]);
 useEffect(()=>{if(!view)return;const timer=setTimeout(accessLost,Math.max(0,Date.parse(view.expiresAt)-Date.now()));return()=>clearTimeout(timer);},[view?.expiresAt,accessLost]);
 async function leave(destination:string){if(returning)return;setReturning(true);try{await webinarRequest(base,{method:'DELETE'});window.location.assign(destination);}catch(e){if([401,403,410].includes((e as {status?:number}).status??0)){window.location.assign(destination);return;}setError(e instanceof Error?e.message:'Could not end this view.');setReturning(false);}}
 const account=view?.account;
 const paymentRequired=account?.billingModel==='membership_credits'&&!(account.membership?.state==='active'&&Date.parse(account.membership.paidThrough??'')>Date.now());
 const running=!!account&&!account.paused&&account.balanceCents>0&&!paymentRequired;
 return <div className={`console-shell personalized-workspace minimal-workspace assistant-workspace icash-brand-workspace ${workspaceStyles.workspace}${account?.vip?' '+workspaceStyles.vip:''} ${styles.customerWorkspace}`}>
  <div className={styles.viewBanner} role="region" aria-label="Customer account view"><div><strong>{account?`Viewing ${account.name}`:'Customer workspace'}</strong><span>{account?.email}{account?.email?' · ':''}Read-only{view?` · Ends ${overviewTime(view.expiresAt)} CT`:''}</span></div><div className={styles.viewActions}><button disabled={returning} onClick={()=>void leave('/admin/accounts')}>Switch account</button><button disabled={returning} onClick={()=>void leave('/')}>{returning?'Returning…':'Back to my workspace'}</button></div></div>
  <header className="console-header"><span className={styles.viewTitle}>Customer workspace</span>{account&&<span className={styles.badge}>{account.vip?'VIP':'Standard'}</span>}</header>
  <OwnerWorkspaceTabs active="accounts" onNavigate={url=>void leave(url)}/>
  <main className="console-main">
   {error&&<p className={styles.notice} role="alert">{error} {ended?<a href="/admin/accounts">Back to Accounts</a>:<button onClick={()=>setRefresh(n=>n+1)}>Retry</button>}</p>}
   {!account&&!ended&&<p role="status" className={styles.empty}>Opening customer workspace…</p>}
   {account&&<>
    <h1 className="sr-only">{account.name}’s workspace</h1>
    <BotRunBar key={`bot:${viewId}`} apiBase={base} readOnly hasLeads={hasLeads} botName={account.assistantName??undefined} vip={account.vip} running={running} paymentRequired={paymentRequired} stopped={account.paused&&account.balanceCents>0} busy={false} stale={!!error} balanceCents={account.balanceCents} hasCreditHistory={account.fundedCents>0} canPause={!account.paused&&account.balanceCents>0} principalKey={viewId} onBudget={noAction} onPause={noAction} onResume={noAction}/>
    <div className={workspaceStyles.activity}><BudgetSummary key={`report:${viewId}`} apiBase={base} vip={account.vip}/></div>
    <section className="operation-panel" aria-label="Your AI real estate bot"><LiveWorkspace key={`work:${viewId}`} apiBase={base} readOnly onAccessLost={accessLost} onLeadPresenceChange={setHasLeads} principal={account.name} botPaused={account.paused} botAvailable={running} accountStale={!!error} showCoach={false}/></section>
   </>}
  </main>
 </div>;
}
