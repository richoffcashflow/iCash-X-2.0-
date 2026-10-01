'use client';
import {useCallback,useEffect,useState,useRef,type CSSProperties} from 'react';
import Image from 'next/image';
import {SetupWorkspaceBackdrop} from '@/components/setup-workspace-backdrop';
import {workspaceStatus,workspaceNextAction,workspaceActionDisabled} from '@/lib/workspace-status';
import {DealExplainer} from '@/components/deal-explainer';
import {Plus,X} from 'lucide-react';
import {FundingCheckout} from '@/components/funding-checkout';
import {AccountAccess} from '@/components/account-access';
import {CustomerIdentity} from '@/components/customer-identity';
import type {CustomerIdentity as Identity} from '@/lib/customer-identity';
import {AuthorityReviewPanel} from '@/components/dashboard/authority-review-panel';
import type {OutreachCampaignStatus} from '@/components/outreach-campaign-state';
import {OutreachCampaignAcknowledgment} from '@/components/outreach-campaign-acknowledgment';
import {AttentionNotificationPreferences} from '@/components/attention-notification-preferences';
import {BudgetSummary} from '@/components/budget-summary';
import {LiveWorkspace} from '@/components/live-workspace';
import {BotSetupFlow} from '@/components/bot-setup';
import {BotBrand} from '@/components/bot-brand';
import {setupThemes,type BotProfile} from '@/lib/bot-setup';
type Account={identity?:Identity|null;botSetup?:{profile:BotProfile;stage:number}|null;signedIn:boolean;signInReady?:boolean;mode?:'test'|'live';email?:string;phone?:string;balanceCents?:number;assistantName?:string;paused?:boolean;billingActive?:boolean;billingReview?:boolean;workReady?:boolean;smsWorkReady?:boolean;activeWork?:boolean};
export default function Home(){
 const [account,setAccount]=useState<Account|null>(null),[accountError,setAccountError]=useState(false),[signInOpen,setSignInOpen]=useState(false),[fundingOpen,setFundingOpen]=useState(false),[fundingCode,setFundingCode]=useState('budget_ten'),[controlBusy,setControlBusy]=useState(false),[controlError,setControlError]=useState(''),[draftBrand,setDraftBrand]=useState<BotProfile|null>(null);
 const [campaign,setCampaign]=useState<OutreachCampaignStatus|null>(null);
 const refreshInFlight=useRef(false);
 const updateBrand=useCallback((profile:BotProfile)=>setDraftBrand(profile),[]);
 async function refreshAccount(){if(refreshInFlight.current)return;refreshInFlight.current=true;try{const r=await fetch('/api/account',{cache:'no-store'});if(!r.ok)throw Error();setAccount(await r.json());setAccountError(false);setSignInOpen(false);}catch{setAccountError(true);}finally{refreshInFlight.current=false;}}
 useEffect(()=>{void refreshAccount();if(new URLSearchParams(window.location.search).get('payment')==='funded')setFundingOpen(true);},[]);
 useEffect(()=>{if(account?.signedIn&&new URLSearchParams(window.location.search).get('notifications')==='1'){const node=document.getElementById('account-details') as HTMLDetailsElement|null;if(node){node.open=true;document.getElementById('notification-settings')?.scrollIntoView({block:'start'});}}},[account?.signedIn]);
 useEffect(()=>{if(!account?.signedIn)return;const update=()=>{if(!document.hidden)void refreshAccount();};const timer=setInterval(update,30000);document.addEventListener('visibilitychange',update);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',update);};},[account?.signedIn]);
 async function toggleBot(action:'pause'|'resume'){setControlBusy(true);setControlError('');try{const r=await fetch('/api/work/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});const result=await r.json();if(!r.ok)throw Error(result.error||'Could not update your bot. Please retry.');await refreshAccount();}catch(e){setControlError(e instanceof Error?e.message:'Could not update your bot. Please retry.');await refreshAccount();}finally{setControlBusy(false);}}
 async function signOut(){if(document.querySelector('[data-unsaved-draft="true"]')&&!window.confirm('Sign out and discard unsaved work in this view?'))return;const r=await fetch('/api/auth/logout',{method:'POST'});if(r.ok){setAccount({signedIn:false});setCampaign(null);setDraftBrand(null);setFundingOpen(false);}else setAccountError(true);}
 function openFunding(code='budget_ten'){setFundingCode(code);setFundingOpen(true);requestAnimationFrame(()=>document.getElementById('inline-funding')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'}));}
 const status=workspaceStatus(account??{});
 const nextAction=workspaceNextAction(account??{},campaign);
 function showDetails(id:string){const details=document.getElementById(id) as HTMLDetailsElement|null;if(!details)return;details.open=true;details.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});details.querySelector<HTMLElement>('summary')?.focus();}
 function doNextAction(){if(nextAction.kind==='identity')showDetails('account-details');else if(nextAction.kind==='campaign')showDetails('outreach-campaign-details');else if(nextAction.kind==='funding')openFunding();else if(nextAction.kind==='resume')void toggleBot('resume');else if(nextAction.kind==='pause')void toggleBot('pause');else if(nextAction.kind==='work')document.getElementById('workspace-properties')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});}
 const guest=!account?.signedIn;const profile=account?.signedIn?account.botSetup?.profile:draftBrand;const theme=setupThemes[profile?.theme??'ink'];
 return <div className={`console-shell ${guest?'setup-shell':'personalized-workspace'}`} style={{'--bot-color':theme.color,'--bot-soft':theme.soft} as CSSProperties}>
  {guest&&<SetupWorkspaceBackdrop/>}
  <header className="console-header"><div>{profile?.displayName?<BotBrand profile={profile} compact/>:<><Image src="/icash-x-logo.png" alt="iCash X" width={111} height={62} priority/><b className="brand-version">2.0</b></>}</div><div className="workspace-header-links"><a className="workspace-help" href="/support" target="_blank" rel="noopener noreferrer" aria-label="Help and support (opens in a new tab)"><span aria-hidden="true">?</span> Help</a>{account?.signedIn?<button className="header-access" onClick={()=>void signOut()}>Sign out</button>:<button id="balance-sign-in" className="header-access" aria-expanded={signInOpen} aria-controls="inline-sign-in" onClick={()=>setSignInOpen(v=>!v)}>Sign in</button>}</div></header>
  <main className="console-main">
   {accountError&&<p role="alert">Could not load your account. <button onClick={()=>void refreshAccount()}>Retry</button></p>}
   {signInOpen&&guest&&<section className="inline-sign-in setup-sign-in" id="inline-sign-in" aria-labelledby="sign-in-title"><div className="sign-in-heading"><h2 id="sign-in-title">Welcome back</h2><button aria-label="Close sign-in" onClick={()=>{setSignInOpen(false);document.getElementById('balance-sign-in')?.focus();}}><X size={19}/></button></div><AccountAccess ready={account?.signInReady===true} onSignedIn={()=>void refreshAccount()}/></section>}
   {!account?<section className="account-loading" role="status"><h1 className="sr-only">iCash X workspace</h1><p>{accountError?'Your account could not load. Retry above to continue.':'Opening your workspace…'}</p></section>:guest?<BotSetupFlow onBrand={updateBrand} onSignedIn={()=>void refreshAccount()}/>:<>
    <h1 className="sr-only">{profile?.displayName||'iCash X'} AI real estate workspace</h1>
    <section className="balance-panel" aria-labelledby="balance-label"><div className="balance-heading"><span id="balance-label">Your balance</span></div><div className="balance-top"><strong>${((account!.balanceCents??0)/100).toFixed(2)}<span>{account!.mode==='test'?'test balance':'available'}</span></strong><button className="fund-button" aria-expanded={fundingOpen} aria-controls="inline-funding" onClick={()=>setFundingOpen(v=>!v)}>Fund my AI bot<Plus size={18}/></button></div>
     {fundingOpen&&<div className="inline-funding" id="inline-funding"><div><strong>Fund your account</strong><span>Review availability and terms below</span></div><FundingCheckout key={fundingCode} initialCode={fundingCode} onSignedIn={()=>{setFundingOpen(false);void refreshAccount();}}/></div>}
    </section>
    <section className="operation-panel" aria-label="Your AI real estate bot"><div className="operation-top"><span className="bot-icon">X</span><div><h2>{profile?.displayName||account!.assistantName||'Your bot'}</h2><span>Your AI real estate bot</span></div><span className="mode-badge">{status.label}</span></div><div className="operation-empty"><div className="workspace-mode"><strong>{account!.mode==='test'?'Test workspace':'Your account records'}</strong><span>{account!.mode==='test'?'Test activity and test balances are not live results or real earnings.':'Only recorded activity appears below. Your bot status shows whether new live work can start.'}</span></div><h3>{status.title}</h3><p>{status.detail}</p><p className="workspace-next-action" id="workspace-next-action">{nextAction.reason}</p><div className="workspace-primary-actions">{nextAction.kind==='support'?<a className="fund-button" href="/support" target="_blank" rel="noopener noreferrer">{nextAction.label}</a>:<button className="fund-button" disabled={workspaceActionDisabled(nextAction.kind,controlBusy,accountError)} aria-describedby="workspace-next-action" onClick={doNextAction}>{controlBusy?'Saving…':nextAction.label}</button>}{nextAction.kind!=='pause'&&(!account!.paused||account!.billingActive)&&<button className="demo-button" disabled={controlBusy} onClick={()=>void toggleBot('pause')}>{controlBusy?'Stopping…':'Stop bot & daily billing'}</button>}{controlError&&<p role="alert">{controlError}</p>}</div><OutreachCampaignAcknowledgment onStatus={setCampaign}/><BudgetSummary onFund={openFunding}/><details className="setup-details"><summary>How a deal works</summary><DealExplainer/></details><LiveWorkspace principal={account!.identity?.principal??''}/><details id="account-details"><summary>Account details</summary><p>{account!.email}</p>{account!.phone&&<p>{account!.phone}</p>}<CustomerIdentity identity={account!.identity??null} onSaved={()=>void refreshAccount()}/><details id="authority-settings"><summary>Permissions & reviews</summary><AuthorityReviewPanel/></details><div id="notification-settings"><AttentionNotificationPreferences/></div><p>Manage daily billing from your budget. Stop bot cancels future daily renewals.</p></details></div></section>
   </>}
  </main>
  <footer className="product-disclosure"><p>Paid usage. Results aren’t guaranteed. Real estate involves risk.</p><a href="/costs-and-disclosures">Costs, risks & disclosures</a></footer>

 </div>;
}
