'use client';
import {useCallback,useEffect,useState,useRef,type CSSProperties} from 'react';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import {workspaceNextAction,workspaceActionDisabled} from '@/lib/workspace-status';
import {X} from 'lucide-react';
import {FundingCheckout} from '@/components/funding-checkout';
import {FundingDialog} from '@/components/funding-dialog';
import {CreditActionGate} from '@/components/credit-action-gate';
import {AccountAccess} from '@/components/account-access';
import {CustomerIdentity} from '@/components/customer-identity';
import type {CustomerIdentity as Identity} from '@/lib/customer-identity';
import type {OutreachCampaignStatus} from '@/components/outreach-campaign-state';
import {OutreachCampaignAcknowledgment} from '@/components/outreach-campaign-acknowledgment';
import {BudgetSummary} from '@/components/budget-summary';
import {MembershipCheckout} from '@/components/membership-checkout';
import {MembershipSettings} from '@/components/membership-settings';
import {SupportLauncher} from '@/components/support-launcher';
import {WorkspaceUpdates,BotUpdatePreferences} from '@/components/workspace-updates';
import {nextWorkFunding} from '@/lib/workspace-progress';
import {SpendActivationReview} from '@/components/spend-activation-review';
import {LiveWorkspace} from '@/components/live-workspace';
import {PostPaymentBotName} from '@/components/post-payment-bot-name';
import type {AssistantRequest} from '@/components/workspace-assistant';
const WorkspaceAssistant=dynamic(()=>import('@/components/workspace-assistant').then(m=>m.WorkspaceAssistant),{ssr:false});
import type {AssistantAction} from '@/lib/workspace-assistant-policy';
import {BotRunBar} from '@/components/bot-run-bar';
import {BotBrand} from '@/components/bot-brand';
import {setupThemes,type BotProfile} from '@/lib/bot-setup';
type Account={readinessPending?:boolean;billingModel?:string;membershipActive?:boolean;isBillingOwner?:boolean;identity?:Identity|null;botSetup?:{profile:BotProfile;stage:number}|null;signedIn:boolean;signInReady?:boolean;mode?:'test'|'live';email?:string;phone?:string;balanceCents?:number;reservedCents?:number;dailyLimitCents?:number;assistantName?:string;paused?:boolean;billingActive?:boolean;billingReview?:boolean;workReady?:boolean;smsWorkReady?:boolean;discoveryWorkReady?:boolean;discoveryBlocker?:string|null;contactWorkReady?:boolean;contactQuote?:{chargeCents:number;maxContacts:number}|null;discoveryQuote?:{chargeCents:number;maxProperties:number}|null;activeWork?:boolean};
export default function Home(){
 const [account,setAccount]=useState<Account|null>(null),[accountError,setAccountError]=useState(false),[signInOpen,setSignInOpen]=useState(false),[fundingOpen,setFundingOpen]=useState(false),[fundingCode,setFundingCode]=useState(''),[controlBusy,setControlBusy]=useState(false),[controlError,setControlError]=useState(''),[draftBrand,setDraftBrand]=useState<BotProfile|null>(null);
 const [assistantRequest,setAssistantRequest]=useState<AssistantRequest|null>(null),[propertyRequest,setPropertyRequest]=useState<{id:string;nonce:number}|null>(null);
 const [settingsOpen,setSettingsOpen]=useState(false),[preferencesOpen,setPreferencesOpen]=useState(false);
 const [campaign,setCampaign]=useState<OutreachCampaignStatus|null>(null);
 const refreshInFlight=useRef(false),accountGeneration=useRef(0),accountRequest=useRef<AbortController|null>(null),readinessRequest=useRef<AbortController|null>(null);
 const [activationAvailability,setActivationAvailability]=useState<{key:string;available:boolean}|null>(null);
 const activationKey=`${account?.email}:${account?.balanceCents}:${account?.dailyLimitCents}:${account?.paused}`;
 const updateActivationAvailability=useCallback((available:boolean)=>setActivationAvailability(current=>current?.key===activationKey&&current.available===available?current:{key:activationKey,available}),[activationKey]);
 const spendingActivationAvailable=account?.signedIn===true&&account.mode==='live'&&activationAvailability?.key===activationKey&&activationAvailability.available===true;
 const updateBrand=useCallback((profile:BotProfile)=>setDraftBrand(profile),[]);
 async function refreshAccount(){
  if(refreshInFlight.current)return false;refreshInFlight.current=true;const generation=++accountGeneration.current;readinessRequest.current?.abort();const coreController=new AbortController();accountRequest.current=coreController;
  try{
   const r=await fetch('/api/account?view=core',{cache:'no-store',signal:AbortSignal.any([coreController.signal,AbortSignal.timeout(25000)])});if(!r.ok)throw Error();const next:Account=await r.json();
   if(generation!==accountGeneration.current)return false;
   setAccount(next);setAccountError(false);setSignInOpen(false);
   if(next.signedIn&&next.readinessPending){
    const controller=new AbortController();readinessRequest.current=controller;
    void fetch('/api/account',{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])}).then(async response=>{
     if(!response.ok)throw Error();const details:Account=await response.json();
     if(generation===accountGeneration.current&&!controller.signal.aborted&&details.signedIn&&details.email===next.email)setAccount(details);
    }).catch(()=>{/* Optional checks never erase a successfully loaded account. Work APIs still authorize every action. */});
   }
   return true;
  }catch{if(generation===accountGeneration.current)setAccountError(true);return false;}finally{if(generation===accountGeneration.current)refreshInFlight.current=false;}
 }
 useEffect(()=>()=>{accountGeneration.current++;accountRequest.current?.abort();readinessRequest.current?.abort();refreshInFlight.current=false;},[]);
 useEffect(()=>{
  if(!accountError)return;
  let stopped=false,recovering=false,attempt=0,timer:ReturnType<typeof setTimeout>|undefined;
  const delays=[5000,15000,30000];
  const schedule=()=>{if(!stopped&&attempt<delays.length)timer=setTimeout(recover,delays[attempt]);};
  const recover=async()=>{
   if(stopped||recovering||document.hidden||!navigator.onLine)return;
   clearTimeout(timer);attempt++;recovering=true;
   const recovered=await refreshAccount();
   recovering=false;
   if(!recovered)schedule();
  };
  schedule();window.addEventListener('online',recover);document.addEventListener('visibilitychange',recover);
  return()=>{stopped=true;clearTimeout(timer);window.removeEventListener('online',recover);document.removeEventListener('visibilitychange',recover);};
 },[accountError]);
 useEffect(()=>{void refreshAccount();const syncFunding=()=>setFundingOpen(window.location.hash==='#funding');syncFunding();if(new URLSearchParams(window.location.search).get('payment')==='funded')setFundingOpen(true);window.addEventListener('hashchange',syncFunding);window.addEventListener('popstate',syncFunding);return()=>{window.removeEventListener('hashchange',syncFunding);window.removeEventListener('popstate',syncFunding);};},[]);
 useEffect(()=>{if(account?.signedIn&&new URLSearchParams(window.location.search).get('settings')==='billing'){if(account.billingModel==='membership_credits')showDetails('membership-settings');else setFundingOpen(true);}if(account?.signedIn&&new URLSearchParams(window.location.search).get('notifications')==='1'){setPreferencesOpen(true);}},[account?.signedIn]);
 useEffect(()=>{if(!account?.signedIn)return;const update=()=>{if(!document.hidden)void refreshAccount();};const timer=setInterval(update,30000);document.addEventListener('visibilitychange',update);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',update);};},[account?.signedIn]);
 async function toggleBot(action:'pause'|'resume'){if(action==='resume'&&creditsExhausted){openFunding();return false;}setControlBusy(true);setControlError('');try{const r=await fetch('/api/work/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});const result=await r.json();if(!r.ok)throw Error(result.error||'Could not update your bot. Please retry.');await refreshAccount();return true;}catch(e){setControlError(e instanceof Error?e.message:'Could not update your bot. Please retry.');await refreshAccount();return false;}finally{setControlBusy(false);}}
 async function signOut(){if(document.querySelector('[data-unsaved-draft="true"]')&&!window.confirm('Sign out and discard unsaved work in this view?'))return;accountGeneration.current++;accountRequest.current?.abort();readinessRequest.current?.abort();refreshInFlight.current=false;const r=await fetch('/api/auth/logout',{method:'POST'});if(r.ok){setAccount({signedIn:false});setCampaign(null);setDraftBrand(null);setFundingOpen(false);}else setAccountError(true);}
 function closeFunding(){setFundingOpen(false);if(window.location.hash==='#funding')window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search);document.getElementById('workspace-funding-toggle')?.focus();}
 async function membershipChanged(stopped=false){if(stopped){accountGeneration.current++;accountRequest.current?.abort();readinessRequest.current?.abort();refreshInFlight.current=false;setSettingsOpen(false);setAccount(current=>current?{...current,billingModel:'membership_credits',membershipActive:false,paused:true}:current);}return refreshAccount();}
 function openFunding(code=''){if(account?.billingModel==='membership_credits'&&!account.membershipActive){showDetails('membership-settings');return;}setFundingCode(code);setFundingOpen(true);if(window.location.hash!=='#funding')window.history.pushState(window.history.state,'','#funding');}
 const funding=nextWorkFunding(account??{},accountError);
 const suggestedAction=workspaceNextAction({...account,spendingActivationAvailable},campaign);
 const nextAction=funding.needsFunding&&suggestedAction.kind==='resume'?{kind:'funding' as const,label:'Review funding',reason:'There are not enough available credits for the next eligible task. Your saved progress stays here.'}:suggestedAction;
 function showDetails(id:string){if(id==='notification-settings'){setPreferencesOpen(true);return;}setSettingsOpen(true);requestAnimationFrame(()=>document.getElementById(id)?.scrollIntoView({block:'start'}));}
 function doNextAction(){if(nextAction.kind==='membership')openFunding();else if(nextAction.kind==='identity')showDetails('account-details');else if(nextAction.kind==='campaign')showDetails('outreach-campaign-details');else if(nextAction.kind==='activation'){const review=document.getElementById('spending-activation-review');review?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});review?.focus();}else if(nextAction.kind==='funding')openFunding();else if(nextAction.kind==='resume')void toggleBot('resume');else if(nextAction.kind==='pause')void toggleBot('pause');else if(nextAction.kind==='work')document.getElementById('workspace-properties')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});}
 async function assistantAction(action:AssistantAction){
  if(action.kind==='funding'){openFunding();return;}
  if(creditsExhausted&&action.kind!=='pause'&&action.kind!=='support'){openFunding();return;}
  if(action.kind==='pause'||action.kind==='resume'){if(!await toggleBot(action.kind))throw Error('Could not confirm the bot update. Please check its status above.');return;}
  if(action.kind==='property'&&action.screeningId){setPropertyRequest({id:action.screeningId,nonce:Date.now()});return;}
  if(action.kind==='attention'){const section=document.getElementById('workspace-attention');if(section){section.scrollIntoView({behavior:'smooth',block:'center'});section.focus();}else throw Error('The request list is refreshing. Check Needs you in a moment.');return;}
  if(action.kind==='support')window.location.assign('/support');
 }
 const botRunning=(account?.billingModel!=='membership_credits'||account?.membershipActive===true)&&account?.paused===false&&(account.billingActive===true||account.billingModel==='prepaid'||account.billingModel==='membership_credits')&&!account?.billingReview&&!!account?.identity&&!!(account.workReady||account.smsWorkReady||account.discoveryWorkReady||account.contactWorkReady||account.activeWork);
 const workspaceLocked=account?.signedIn===true&&account.billingModel==='membership_credits'&&account.membershipActive!==true;
 // The account API already returns spendable credits, net of reservations.
 const creditsExhausted=account?.signedIn===true&&!workspaceLocked&&!accountError&&typeof account.balanceCents==='number'&&account.balanceCents<=0;
 const guest=!account?.signedIn;const profile=account?.signedIn?account.botSetup?.profile:draftBrand;const theme=setupThemes.ink;
 const needsIdentity=account?.signedIn===true&&!workspaceLocked&&!account.identity;
 const needsBotName=account?.signedIn===true&&((account.balanceCents??0)>0||account.billingModel==='prepaid'||account.membershipActive===true)&&!account.botSetup?.profile.displayName?.trim();
 return <div className="console-shell personalized-workspace minimal-workspace assistant-workspace" style={{'--bot-color':theme.color,'--bot-soft':theme.soft} as CSSProperties}>
  <header className="console-header"><div>{profile?.displayName?<BotBrand profile={profile} compact/>:<><Image src="/icash-x-logo.png" alt="iCash X" width={111} height={62} priority/><b className="brand-version">2.0</b></>}</div><div className="workspace-header-links">{account?.signedIn?<SupportLauncher key={account.email??'account'}/>:<a className="workspace-help" href="/support">Help</a>}{account?.signedIn?<>{!workspaceLocked&&<><WorkspaceUpdates onPreferences={()=>showDetails('notification-settings')} onBudget={()=>openFunding()}/><button className="header-access" aria-expanded={settingsOpen} onClick={()=>setSettingsOpen(v=>!v)}>Settings</button></>}<button className="header-access" onClick={()=>void signOut()}>Sign out</button></>:<button id="balance-sign-in" className="header-access" aria-expanded={signInOpen} aria-controls="inline-sign-in" onClick={()=>setSignInOpen(v=>!v)}>Sign in</button>}</div></header>
  <main className="console-main">
   {accountError&&<p role="alert">Could not load your account. <button onClick={()=>void refreshAccount()}>Retry</button></p>}
   {signInOpen&&guest&&<section className="inline-sign-in setup-sign-in" id="inline-sign-in" aria-labelledby="sign-in-title"><div className="sign-in-heading"><h2 id="sign-in-title">Welcome back</h2><button aria-label="Close sign-in" onClick={()=>{setSignInOpen(false);document.getElementById('balance-sign-in')?.focus();}}><X size={19}/></button></div><AccountAccess ready={account?.signInReady===true} onSignedIn={()=>void refreshAccount()}/></section>}
   {!account?<section className="account-loading" role="status"><h1 className="sr-only">iCash X workspace</h1><p>{accountError?'Your account could not load. Retry above to continue.':'Opening your workspace…'}</p></section>:<>
    <h1 className="sr-only">{profile?.displayName||'iCash X'} AI real estate workspace</h1>
    {workspaceLocked?<section className="subscription-lock" aria-label="Restore access"><h1>Renew subscription</h1><p>Your workspace is locked. Your unused credits are saved.</p><MembershipSettings locked onChanged={membershipChanged}/><button className="workspace-quiet" onClick={()=>void refreshAccount()}>Check payment</button></section>:<>
    <BotRunBar running={botRunning} paymentRequired={account.billingModel==='membership_credits'&&!account.membershipActive} stopped={account.paused===true&&(account.balanceCents??0)>0} busy={controlBusy} stale={accountError} balanceCents={guest?undefined:account.balanceCents} canPause={account.paused===false&&((account.balanceCents??0)>0||account.billingActive===true)} principalKey={account.email} onBudget={()=>openFunding()} onPause={()=>void toggleBot('pause')} onResume={()=>void toggleBot('resume')}/>
    {fundingOpen&&<FundingDialog title={guest||account.billingModel==='membership_credits'&&!account.membershipActive?'iCash X 2.0':creditsExhausted?'Out of credits':'Add money'} onClose={closeFunding}>{guest||account.billingModel==='membership_credits'&&!account.membershipActive?<MembershipCheckout onSignedIn={()=>{closeFunding();void refreshAccount();}}/>:<FundingCheckout outOfCredits={creditsExhausted} initialCode={fundingCode||undefined} onSignedIn={()=>{closeFunding();void refreshAccount();}}/>}</FundingDialog>}
    {!guest&&settingsOpen&&<FundingDialog title="Account details" onClose={()=>setSettingsOpen(false)}><div className="simple-account-settings" aria-label="Workspace settings"><section id="account-details"><p className="account-email">{account.email}</p>{account.phone&&<p className="account-phone">{account.phone}</p>}<CustomerIdentity key={account.identity?.principal??'new'} identity={account.identity??null} onSaved={()=>void refreshAccount()}/></section><section id="membership-settings"><MembershipSettings onChanged={membershipChanged}/></section></div></FundingDialog>}
    {!guest&&preferencesOpen&&<FundingDialog title="Email & text updates" onClose={()=>setPreferencesOpen(false)}><BotUpdatePreferences phone={account.phone}/></FundingDialog>}
    {!guest&&<div hidden><OutreachCampaignAcknowledgment onStatus={setCampaign}/></div>}
    <section className="operation-panel" aria-label="Your AI real estate bot">
     {guest?<div className="workspace-first-visit"><h2>Your properties</h2><p>Join for $50/month, then add money to start your bot.</p></div>:<>
     {needsIdentity&&<section className="identity-onboarding"><CustomerIdentity identity={null} onboarding onSaved={()=>void refreshAccount()}/></section>}
     {!needsIdentity&&needsBotName&&<PostPaymentBotName onBrand={updateBrand} onCreated={async()=>{await refreshAccount();}}/>}
     {!account.readinessPending&&(nextAction.kind==='activation'||nextAction.kind==='support'&&account.billingReview)&&<div className="workspace-state-row">
      {nextAction.kind==='support'?<a className="fund-button" href="/support">{nextAction.label}</a>:<button className="fund-button" disabled={workspaceActionDisabled(nextAction.kind,controlBusy,accountError)} onClick={doNextAction}>{controlBusy?'Saving…':nextAction.label}</button>}
     </div>}
     {account.mode==='test'&&<p className="workspace-test-label">Test workspace</p>}
     {controlError&&<p role="alert">{controlError}</p>}
     {account.mode==='live'&&account.billingModel==='legacy'&&<SpendActivationReview key={activationKey} onAvailabilityChange={updateActivationAvailability} onSaved={()=>void refreshAccount()}/>}
     <CreditActionGate blocked={creditsExhausted} onRequireCredits={()=>openFunding()}>
     <BudgetSummary/>
     <LiveWorkspace propertyRequest={propertyRequest} onAsk={(screeningId,address)=>setAssistantRequest({screeningId,address,nonce:Date.now()})} principal={account.identity?.principal??''} botPaused={account.paused===true} botAvailable={(account.billingModel!=='membership_credits'||account.membershipActive===true)&&!account.billingReview&&!!account.identity&&(account.balanceCents??0)>0&&!!(account.workReady||account.smsWorkReady||account.discoveryWorkReady||account.contactWorkReady)} accountStale={accountError} showCoach={false}/>
     </CreditActionGate>
     </>}
    </section>
    {!guest&&<CreditActionGate blocked={creditsExhausted} onRequireCredits={()=>openFunding()}><WorkspaceAssistant key={account.email} request={assistantRequest} stale={accountError} onAction={assistantAction}/></CreditActionGate>}
    </>}
   </>}
  </main>
  <footer className="product-disclosure"><p>Paid usage. Results aren’t guaranteed. Real estate involves risk.</p><a href="/costs-and-disclosures">Costs, risks & disclosures</a></footer>

 </div>;
}
