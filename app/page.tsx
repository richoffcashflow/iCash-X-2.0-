'use client';
import OwnerRecordingTestLink from '@/components/owner-recording-test-link';
import {useCallback,useEffect,useState,useRef,type CSSProperties} from 'react';
import Image from 'next/image';
import {SetupWorkspaceBackdrop} from '@/components/setup-workspace-backdrop';
import {workspaceStatus,workspaceNextAction,workspaceActionDisabled} from '@/lib/workspace-status';
import {DealExplainer} from '@/components/deal-explainer';
import {X} from 'lucide-react';
import {FundingCheckout} from '@/components/funding-checkout';
import {DailyFundingCheckout} from '@/components/daily-funding-checkout';
import {AccountAccess} from '@/components/account-access';
import {CustomerIdentity} from '@/components/customer-identity';
import type {CustomerIdentity as Identity} from '@/lib/customer-identity';
import type {OutreachCampaignStatus} from '@/components/outreach-campaign-state';
import {OutreachCampaignAcknowledgment} from '@/components/outreach-campaign-acknowledgment';
import {BudgetSummary} from '@/components/budget-summary';
import {CreditsWallet,DailyBudgetBar} from '@/components/daily-budget-control';
import {MembershipSettings} from '@/components/membership-settings';
import {SupportLauncher} from '@/components/support-launcher';
import {WorkspaceUpdates,BotUpdatePreferences} from '@/components/workspace-updates';
import {nextWorkFunding} from '@/lib/workspace-progress';
import {SpendActivationReview} from '@/components/spend-activation-review';
import {LiveWorkspace} from '@/components/live-workspace';
import {BotSetupFlow} from '@/components/bot-setup';
import {BotBrand} from '@/components/bot-brand';
import {setupThemes,type BotProfile} from '@/lib/bot-setup';
type Account={billingModel?:string;membershipActive?:boolean;isBillingOwner?:boolean;identity?:Identity|null;botSetup?:{profile:BotProfile;stage:number}|null;signedIn:boolean;signInReady?:boolean;mode?:'test'|'live';email?:string;phone?:string;balanceCents?:number;reservedCents?:number;dailyLimitCents?:number;assistantName?:string;paused?:boolean;billingActive?:boolean;billingReview?:boolean;workReady?:boolean;smsWorkReady?:boolean;discoveryWorkReady?:boolean;discoveryBlocker?:string|null;contactWorkReady?:boolean;contactQuote?:{chargeCents:number;maxContacts:number}|null;discoveryQuote?:{chargeCents:number;maxProperties:number}|null;activeWork?:boolean};
export default function Home(){
 const [account,setAccount]=useState<Account|null>(null),[accountError,setAccountError]=useState(false),[signInOpen,setSignInOpen]=useState(false),[fundingOpen,setFundingOpen]=useState(false),[fundingCode,setFundingCode]=useState(''),[controlBusy,setControlBusy]=useState(false),[controlError,setControlError]=useState(''),[draftBrand,setDraftBrand]=useState<BotProfile|null>(null);
 const [settingsOpen,setSettingsOpen]=useState(false);
 const [campaign,setCampaign]=useState<OutreachCampaignStatus|null>(null);
 const refreshInFlight=useRef(false);
 const [activationAvailability,setActivationAvailability]=useState<{key:string;available:boolean}|null>(null);
 const activationKey=`${account?.email}:${account?.balanceCents}:${account?.dailyLimitCents}:${account?.paused}`;
 const updateActivationAvailability=useCallback((available:boolean)=>setActivationAvailability(current=>current?.key===activationKey&&current.available===available?current:{key:activationKey,available}),[activationKey]);
 const spendingActivationAvailable=account?.signedIn===true&&account.mode==='live'&&activationAvailability?.key===activationKey&&activationAvailability.available===true;
 const updateBrand=useCallback((profile:BotProfile)=>setDraftBrand(profile),[]);
 async function refreshAccount(){if(refreshInFlight.current)return;refreshInFlight.current=true;try{const r=await fetch('/api/account',{cache:'no-store'});if(!r.ok)throw Error();setAccount(await r.json());setAccountError(false);setSignInOpen(false);}catch{setAccountError(true);}finally{refreshInFlight.current=false;}}
 useEffect(()=>{void refreshAccount();const syncFunding=()=>setFundingOpen(window.location.hash==='#funding');syncFunding();if(new URLSearchParams(window.location.search).get('payment')==='funded')setFundingOpen(true);window.addEventListener('hashchange',syncFunding);window.addEventListener('popstate',syncFunding);return()=>{window.removeEventListener('hashchange',syncFunding);window.removeEventListener('popstate',syncFunding);};},[]);
 useEffect(()=>{if(account?.signedIn&&new URLSearchParams(window.location.search).get('settings')==='billing'){if(account.billingModel==='membership_credits')showDetails('membership-settings');else setFundingOpen(true);}if(account?.signedIn&&new URLSearchParams(window.location.search).get('notifications')==='1'){setSettingsOpen(true);const node=document.getElementById('notification-settings') as HTMLDetailsElement|null;if(node){node.open=true;document.getElementById('notification-settings')?.scrollIntoView({block:'start'});}}},[account?.signedIn]);
 useEffect(()=>{if(!account?.signedIn)return;const update=()=>{if(!document.hidden)void refreshAccount();};const timer=setInterval(update,30000);document.addEventListener('visibilitychange',update);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',update);};},[account?.signedIn]);
 async function toggleBot(action:'pause'|'resume'){setControlBusy(true);setControlError('');try{const r=await fetch('/api/work/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});const result=await r.json();if(!r.ok)throw Error(result.error||'Could not update your bot. Please retry.');await refreshAccount();}catch(e){setControlError(e instanceof Error?e.message:'Could not update your bot. Please retry.');await refreshAccount();}finally{setControlBusy(false);}}
 async function signOut(){if(document.querySelector('[data-unsaved-draft="true"]')&&!window.confirm('Sign out and discard unsaved work in this view?'))return;const r=await fetch('/api/auth/logout',{method:'POST'});if(r.ok){setAccount({signedIn:false});setCampaign(null);setDraftBrand(null);setFundingOpen(false);}else setAccountError(true);}
 function closeFunding(){setFundingOpen(false);if(window.location.hash==='#funding')window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search);document.getElementById('workspace-funding-toggle')?.focus();}
 function openFunding(code=''){if(account?.billingModel==='membership_credits'&&!account.membershipActive){showDetails('membership-settings');return;}setFundingCode(code);setFundingOpen(true);if(window.location.hash!=='#funding')window.history.pushState(window.history.state,'','#funding');requestAnimationFrame(()=>document.getElementById('inline-funding')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'}));}
 const status=workspaceStatus({...account,spendingActivationAvailable});
 const funding=nextWorkFunding(account??{},accountError);
 const suggestedAction=workspaceNextAction({...account,spendingActivationAvailable},campaign);
 const nextAction=funding.needsFunding&&suggestedAction.kind==='resume'?{kind:'funding' as const,label:'Review funding',reason:'There are not enough available credits for the next eligible task. Your saved progress stays here.'}:suggestedAction;
 function showDetails(id:string){setSettingsOpen(true);requestAnimationFrame(()=>{const details=document.getElementById(id) as HTMLDetailsElement|null;if(!details)return;details.open=true;details.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});details.querySelector<HTMLElement>('summary')?.focus();});}
 function doNextAction(){if(nextAction.kind==='membership')showDetails('membership-settings');else if(nextAction.kind==='identity')showDetails('account-details');else if(nextAction.kind==='campaign')showDetails('outreach-campaign-details');else if(nextAction.kind==='activation'){const review=document.getElementById('spending-activation-review');review?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});review?.focus();}else if(nextAction.kind==='funding')openFunding();else if(nextAction.kind==='resume')void toggleBot('resume');else if(nextAction.kind==='pause')void toggleBot('pause');else if(nextAction.kind==='work')document.getElementById('workspace-properties')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});}
 const dailyBilling=account?.billingModel!=='membership_credits'&&account?.billingModel!=='prepaid';
 const guest=!account?.signedIn;const profile=account?.signedIn?account.botSetup?.profile:draftBrand;const theme=setupThemes[profile?.theme??'ink'];
 return <div className={`console-shell ${guest?'setup-shell':'personalized-workspace'}`} style={{'--bot-color':theme.color,'--bot-soft':theme.soft} as CSSProperties}>
  {guest&&<SetupWorkspaceBackdrop/>}
  <header className="console-header"><div>{profile?.displayName?<BotBrand profile={profile} compact/>:<><Image src="/icash-x-logo.png" alt="iCash X" width={111} height={62} priority/><b className="brand-version">2.0</b></>}</div><div className="workspace-header-links">{account?.signedIn?<SupportLauncher key={account.email??'account'}/>:<a className="workspace-help" href="/support">Help</a>}{account?.signedIn?<><WorkspaceUpdates onPreferences={()=>showDetails('notification-settings')} onBudget={()=>openFunding()}/><button className="header-access" aria-expanded={settingsOpen} onClick={()=>setSettingsOpen(v=>!v)}>Settings</button><button className="header-access" onClick={()=>void signOut()}>Sign out</button></>:<button id="balance-sign-in" className="header-access" aria-expanded={signInOpen} aria-controls="inline-sign-in" onClick={()=>setSignInOpen(v=>!v)}>Sign in</button>}</div></header>
  <main className="console-main">
   {accountError&&<p role="alert">Could not load your account. <button onClick={()=>void refreshAccount()}>Retry</button></p>}
   {signInOpen&&guest&&<section className="inline-sign-in setup-sign-in" id="inline-sign-in" aria-labelledby="sign-in-title"><div className="sign-in-heading"><h2 id="sign-in-title">Welcome back</h2><button aria-label="Close sign-in" onClick={()=>{setSignInOpen(false);document.getElementById('balance-sign-in')?.focus();}}><X size={19}/></button></div><AccountAccess ready={account?.signInReady===true} onSignedIn={()=>void refreshAccount()}/></section>}
   {!account?<section className="account-loading" role="status"><h1 className="sr-only">iCash X workspace</h1><p>{accountError?'Your account could not load. Retry above to continue.':'Opening your workspace…'}</p></section>:guest?<BotSetupFlow onBrand={updateBrand} onSignedIn={()=>void refreshAccount()}/>:<>
    <h1 className="sr-only">{profile?.displayName||'iCash X'} AI real estate workspace</h1>
    {dailyBilling?<DailyBudgetBar budgetCents={account.dailyLimitCents} balanceCents={account.balanceCents} reservedCents={account.reservedCents} active={account.billingActive} stale={accountError} onChange={openFunding}/>:<CreditsWallet balanceCents={account.balanceCents} reservedCents={account.reservedCents} stale={accountError} onChange={openFunding}/>}
    <section className="workspace-funding-container" aria-label="Funding">
     {fundingOpen&&<div className="inline-funding" id="inline-funding"><div className="funding-review-heading"><div><strong>{dailyBilling?'Your daily budget':'Add work credits'}</strong><span>{dailyBilling?'Choose your pace. Review the renewal before confirming.':'One-time funding. No daily charge or automatic refill.'}</span></div><button type="button" className="workspace-quiet" aria-label="Close funding" onClick={closeFunding}><X size={18}/></button></div>{dailyBilling?<DailyFundingCheckout key={fundingCode} initialCode={fundingCode||undefined} onSignedIn={()=>{closeFunding();void refreshAccount();}}/>:<FundingCheckout key={fundingCode} initialCode={fundingCode||undefined} onSignedIn={()=>{closeFunding();void refreshAccount();}}/>}</div>}
    </section>
    <div hidden={!settingsOpen} className="workspace-settings" aria-label="Workspace settings"><div className="workspace-section-heading"><h2>Settings</h2>{account.isBillingOwner&&<><a href="/owner-pricing">Pricing settings</a><a href="/seller-operations">Seller ads</a></>}<button className="workspace-quiet" onClick={()=>setSettingsOpen(false)}>Done</button></div><OutreachCampaignAcknowledgment onStatus={setCampaign}/><OwnerRecordingTestLink/><details className="setup-details"><summary>How a deal works</summary><DealExplainer/></details><details id="notification-settings"><summary>Email &amp; text updates</summary><BotUpdatePreferences phone={account.phone}/></details>{account.billingModel==='membership_credits'&&<details id="membership-settings"><summary>Software subscription</summary><MembershipSettings/></details>}<details id="account-details"><summary>Account details</summary><p>{account!.email}</p>{account!.phone&&<p>{account!.phone}</p>}<CustomerIdentity identity={account!.identity??null} onSaved={()=>void refreshAccount()}/><p>{dailyBilling?'Pause stops new work and cancels future daily renewals. Unused credits remain.':'Work credits are prepaid. Pause your bot to stop new work.'}</p></details></div>
    <section className="operation-panel" aria-label="Your AI real estate bot">
     <div className="workspace-status-hero"><div><span className="workspace-eyebrow">{profile?.displayName||account.assistantName||'Your AI bot'}</span><h2>{status.title}</h2></div><span className={`workspace-status-label tone-${accountError?'amber':status.label==='WORKING'?'green':status.label==='PAUSED'?'gray':'amber'}`}><span className="ai-status-dot" aria-hidden="true"/>{accountError?'CHECKING':status.label}</span></div>
     <p className="workspace-status-detail">{status.detail}</p>
     {account.mode==='test'&&<p className="workspace-test-label">Test workspace · test balances and activity</p>}
     <div className="workspace-run-controls">
      {nextAction.kind==='pause'?<button className="workspace-quiet stop-bot" disabled={controlBusy} onClick={()=>void toggleBot('pause')}>{controlBusy?'Stopping…':'Pause bot'}</button>:nextAction.kind==='work'?<button className="workspace-quiet" onClick={doNextAction}>View current work</button>:null}
      {nextAction.kind!=='pause'&&(!account.paused||account.billingActive)&&<button className="workspace-quiet stop-bot" disabled={controlBusy} onClick={()=>void toggleBot('pause')}>{controlBusy?'Stopping…':'Pause bot'}</button>}
     </div>
     {controlError&&<p role="alert">{controlError}</p>}
     {!['pause','work'].includes(nextAction.kind)&&<div className="workspace-next-step deal-coach"><span className="workspace-eyebrow">Your next step</span><h3>{nextAction.label}</h3><p id="workspace-next-action">{nextAction.reason}</p><div className="workspace-primary-actions">{nextAction.kind==='support'?<a className="fund-button" href="/support" target="_blank" rel="noopener noreferrer">{nextAction.label}</a>:<button className="fund-button" disabled={workspaceActionDisabled(nextAction.kind,controlBusy,accountError)} aria-describedby="workspace-next-action" onClick={doNextAction}>{controlBusy?'Saving…':nextAction.label}</button>}</div>{funding.detail&&<details className="next-step-details"><summary>Work & funding details</summary><p>{funding.detail}</p></details>}</div>}
     {account.mode==='live'&&account.billingModel==='legacy'&&<SpendActivationReview key={activationKey} onAvailabilityChange={updateActivationAvailability} onSaved={()=>void refreshAccount()}/>}
     <BudgetSummary/>
     <LiveWorkspace principal={account.identity?.principal??''} botPaused={account.paused===true} botAvailable={(account.billingModel!=='membership_credits'||account.membershipActive===true)&&!account.billingReview&&!!account.identity&&(account.balanceCents??0)>0&&!!(account.workReady||account.smsWorkReady||account.discoveryWorkReady||account.contactWorkReady)} accountStale={accountError} showCoach={['pause','work'].includes(nextAction.kind)}/>
    </section>
   </>}
  </main>
  <footer className="product-disclosure"><p>Paid usage. Results aren’t guaranteed. Real estate involves risk.</p><a href="/costs-and-disclosures">Costs, risks & disclosures</a></footer>

 </div>;
}
