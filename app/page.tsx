'use client';
import {useCallback,useEffect,useState,useRef,type CSSProperties} from 'react';
import {webinarRequest as workspaceRequest} from '@/lib/webinar-client';
import dynamic from 'next/dynamic';
import {workspaceNextAction,workspaceActionDisabled} from '@/lib/workspace-status';
import {BookOpen,Menu,X} from 'lucide-react';
import styles from './workspace-easy.module.css';
import './icash-brand.css';
import './workspace-course.css';
import {WorkspaceAcknowledgment} from '@/components/workspace-acknowledgment';
import {FundingDialog} from '@/components/funding-dialog';
import {AccountAccess} from '@/components/account-access';
import type {CustomerIdentity as Identity} from '@/lib/customer-identity';
import type {OutreachCampaignStatus} from '@/components/outreach-campaign-state';
import {OutreachCampaignAcknowledgment} from '@/components/outreach-campaign-acknowledgment';
import {MembershipCheckout} from '@/components/membership-checkout';
import {WebinarExpressCheckout} from '@/components/webinar-express-checkout';
import {nextWorkFunding} from '@/lib/workspace-progress';
import type {AssistantRequest} from '@/components/workspace-assistant';
import type {AssistantAction} from '@/lib/workspace-assistant-policy';
import {BotRunBar} from '@/components/bot-run-bar';
import {FundingOutreachNotice} from '@/components/funding-outreach-notice';
import {AdminPlanToggle,type AccountPlan} from '@/components/workspace-vip-banner';
import {setupThemes,type BotProfile} from '@/lib/bot-setup';
// Load private workspace tools only when their signed-in controls are rendered.
const WorkspaceWalkthrough=dynamic(()=>import('@/components/workspace-walkthrough').then(m=>m.WorkspaceWalkthrough));
const WorkspaceConversion=dynamic(()=>import('@/components/workspace-conversion').then(m=>m.WorkspaceConversion));
const FundingCheckout=dynamic(()=>import('@/components/funding-checkout').then(m=>m.FundingCheckout));
const CreditActionGate=dynamic(()=>import('@/components/credit-action-gate').then(m=>m.CreditActionGate));
const CustomerIdentity=dynamic(()=>import('@/components/customer-identity').then(m=>m.CustomerIdentity));
const BudgetSummary=dynamic(()=>import('@/components/budget-summary').then(m=>m.BudgetSummary));
const SpendingAllowance=dynamic(()=>import('@/components/spending-allowance').then(m=>m.SpendingAllowance));
const MembershipSettings=dynamic(()=>import('@/components/membership-settings').then(m=>m.MembershipSettings));
const SupportLauncher=dynamic(()=>import('@/components/support-launcher').then(m=>m.SupportLauncher));
const WorkspaceUpdates=dynamic(()=>import('@/components/workspace-updates').then(m=>m.WorkspaceUpdates));
const BotUpdatePreferences=dynamic(()=>import('@/components/workspace-updates').then(m=>m.BotUpdatePreferences));
const SpendActivationReview=dynamic(()=>import('@/components/spend-activation-review').then(m=>m.SpendActivationReview));
const LiveWorkspace=dynamic(()=>import('@/components/live-workspace').then(m=>m.LiveWorkspace));
const PostPaymentBotName=dynamic(()=>import('@/components/post-payment-bot-name').then(m=>m.PostPaymentBotName));
const WorkspaceAssistant=dynamic(()=>import('@/components/workspace-assistant').then(m=>m.WorkspaceAssistant),{ssr:false});
const PlatformBuyerNetwork=dynamic(()=>import('@/components/platform-buyer-network').then(m=>m.PlatformBuyerNetwork));
const BotCustomization=dynamic(()=>import('@/components/bot-customization').then(m=>m.BotCustomization));
type Account={workspaceAcknowledged?:boolean;vip?:boolean;vipFeatures?:boolean;adminPlan?:AccountPlan|null;readinessPending?:boolean;billingModel?:string;membershipActive?:boolean;isBillingOwner?:boolean;identity?:Identity|null;botSetup?:{profile:BotProfile;stage:number}|null;signedIn:boolean;signInReady?:boolean;mode?:'test'|'live';email?:string;pendingEmail?:string|null;phone?:string;hasCreditHistory?:boolean;balanceCents?:number;reservedCents?:number;dailyLimitCents?:number;assistantName?:string;paused?:boolean;billingActive?:boolean;billingReview?:boolean;workReady?:boolean;smsWorkReady?:boolean;discoveryWorkReady?:boolean;discoveryBlocker?:string|null;contactWorkReady?:boolean;contactQuote?:{chargeCents:number;maxContacts:number}|null;discoveryQuote?:{chargeCents:number;maxProperties:number}|null;activeWork?:boolean};
export default function Home(){
 const [account,setAccount]=useState<Account|null>(null),[accountError,setAccountError]=useState(false),[signInOpen,setSignInOpen]=useState(false),[fundingOpen,setFundingOpen]=useState(false),[fundingCode,setFundingCode]=useState(''),[controlBusy,setControlBusy]=useState(false),[controlError,setControlError]=useState(''),[draftBrand,setDraftBrand]=useState<BotProfile|null>(null);
 const [reviewVip,setReviewVip]=useState(false);
 const [fundingNotice,setFundingNotice]=useState<{email:string;accountAtFunding:Account}|null>(null);
 useEffect(()=>{
  if(!account?.signedIn||!account.email){setFundingNotice(null);return;}
  const funded=()=>setFundingNotice({email:account.email!,accountAtFunding:account});
  window.addEventListener('icash:credits-funded',funded);
  return()=>window.removeEventListener('icash:credits-funded',funded);
 },[account]);
 const [walkthroughRequest,setWalkthroughRequest]=useState<{email?:string;nonce:number}>({nonce:0}),[walkthroughOpen,setWalkthroughOpen]=useState(false);
 const [assistantOpenRequest,setAssistantOpenRequest]=useState(0);
 const [assistantAccount,setAssistantAccount]=useState<string|null>(null);
 const [fundingSuggestion,setFundingSuggestion]=useState<{amountCents:number;reason:string}|null>(null);
 const [assistantRequest,setAssistantRequest]=useState<AssistantRequest|null>(null),[propertyRequest,setPropertyRequest]=useState<{id:string;nonce:number}|null>(null);
 const [settingsOpen,setSettingsOpen]=useState(false),[preferencesOpen,setPreferencesOpen]=useState(false);
 const [cancellationOpen,setCancellationOpen]=useState(false);
 const accountMenu=useRef<HTMLDetailsElement>(null);
 function closeAccountMenu(restoreFocus=false){const menu=accountMenu.current;if(!menu)return;menu.open=false;if(restoreFocus)menu.querySelector('summary')?.focus();}
 useEffect(()=>{
  const dismiss=(event:PointerEvent)=>{const menu=accountMenu.current;if(menu?.open&&event.target instanceof Node&&!menu.contains(event.target))closeAccountMenu();};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&accountMenu.current?.open){event.preventDefault();closeAccountMenu(true);}};
  document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',escape);};
 },[]);
 useEffect(()=>{if(!account?.signedIn||!account.workspaceAcknowledged||new URLSearchParams(window.location.search).get('upgrade')!=='vip')return;const url=new URL(window.location.href);if(url.searchParams.get('upgrade')==='vip'){setReviewVip(true);url.searchParams.delete('upgrade');window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);}},[account?.signedIn,account?.workspaceAcknowledged]);
 const [campaign,setCampaign]=useState<OutreachCampaignStatus|null>(null);
 const refreshInFlight=useRef(false),accountGeneration=useRef(0),accountRequest=useRef<AbortController|null>(null),readinessRequest=useRef<AbortController|null>(null);
 const controlInFlight=useRef(false);
 const [activationAvailability,setActivationAvailability]=useState<{key:string;available:boolean}|null>(null);
 const [customizeOpen,setCustomizeOpen]=useState(false);
 const [attentionPending,setAttentionPending]=useState(true);
 const [leadPresence,setLeadPresence]=useState<{email?:string;hasLeads:boolean|undefined}|null>(null);
 const updateLeadPresence=useCallback((hasLeads:boolean|undefined)=>setLeadPresence(current=>current?.email===account?.email&&current?.hasLeads===hasLeads?current:{email:account?.email,hasLeads}),[account?.email]);
 const activationKey=`${account?.email}:${account?.balanceCents}:${account?.dailyLimitCents}:${account?.paused}`;
 const updateActivationAvailability=useCallback((available:boolean)=>setActivationAvailability(current=>current?.key===activationKey&&current.available===available?current:{key:activationKey,available}),[activationKey]);
 const spendingActivationAvailable=account?.signedIn===true&&account.mode==='live'&&activationAvailability?.key===activationKey&&activationAvailability.available===true;
 const updateBrand=useCallback((profile:BotProfile)=>setDraftBrand(profile),[]);
 async function refreshAccount(force=false,requireAcknowledged=false){
  if(refreshInFlight.current&&!force)return false;accountRequest.current?.abort();refreshInFlight.current=true;const generation=++accountGeneration.current;readinessRequest.current?.abort();const coreController=new AbortController();accountRequest.current=coreController;
  try{
   const next=await workspaceRequest<Account>('/api/account?view=core',{cache:'no-store',signal:coreController.signal});
   if(generation!==accountGeneration.current)return false;
   setAccount(next);setAccountError(false);setSignInOpen(false);
   if(next.signedIn&&next.readinessPending){
    const controller=new AbortController();readinessRequest.current=controller;
    void workspaceRequest<Account>('/api/account',{cache:'no-store',signal:controller.signal}).then(details=>{
     if(generation===accountGeneration.current&&!controller.signal.aborted&&details.signedIn&&details.email===next.email)setAccount(details);
    }).catch(()=>{/* Optional checks never erase a successfully loaded account. Work APIs still authorize every action. */});
   }
   return !requireAcknowledged||next.workspaceAcknowledged===true;
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
 useEffect(()=>{const returned=new URLSearchParams(window.location.hash.slice(1));if(returned.get('type')==='email_change'){window.history.replaceState(window.history.state,'',window.location.pathname+'?settings=account');}void refreshAccount();const syncFunding=()=>setFundingOpen(window.location.hash==='#funding');syncFunding();if(new URLSearchParams(window.location.search).get('payment')==='funded')setFundingOpen(true);window.addEventListener('hashchange',syncFunding);window.addEventListener('popstate',syncFunding);return()=>{window.removeEventListener('hashchange',syncFunding);window.removeEventListener('popstate',syncFunding);};},[]);
 useEffect(()=>{if(account?.signedIn&&new URLSearchParams(window.location.search).get('settings')==='account')setSettingsOpen(true);if(account?.signedIn&&new URLSearchParams(window.location.search).get('settings')==='billing'){if(account.billingModel==='membership_credits')showDetails('membership-settings');else setFundingOpen(true);}if(account?.signedIn&&new URLSearchParams(window.location.search).get('notifications')==='1'){setPreferencesOpen(true);}},[account?.signedIn]);
 useEffect(()=>{if(!account?.signedIn)return;const update=()=>{if(!document.hidden)void refreshAccount();};const timer=setInterval(update,30000);document.addEventListener('visibilitychange',update);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',update);};},[account?.signedIn]);
 async function toggleBot(action:'pause'|'resume'){if(controlInFlight.current)return false;if(action==='resume'&&creditsExhausted){openFunding();return false;}controlInFlight.current=true;setControlBusy(true);setControlError('');try{await workspaceRequest('/api/work/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});await refreshAccount(true);return true;}catch(e){setControlError(e instanceof Error?e.message:'Could not confirm the bot update. Check its status before trying again.');await refreshAccount(true);return false;}finally{controlInFlight.current=false;setControlBusy(false);}}
 async function changePlan(plan:AccountPlan){
  if(controlInFlight.current||!canSwitchPlan)return;
  controlInFlight.current=true;setControlBusy(true);setControlError('');
  try{await workspaceRequest('/api/account/admin-plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan})});if(!await refreshAccount(true))setControlError('Plan saved. Reconnect to confirm your account status.');}
  catch(e){setControlError(e instanceof Error?e.message:'Could not switch your account plan. Refresh and try again.');await refreshAccount(true);}
  finally{controlInFlight.current=false;setControlBusy(false);}
 }
 async function signOut(){if(document.querySelector('[data-unsaved-draft="true"]')&&!window.confirm('Sign out and discard unsaved work in this view?'))return;accountGeneration.current++;accountRequest.current?.abort();readinessRequest.current?.abort();refreshInFlight.current=false;try{await workspaceRequest('/api/auth/logout',{method:'POST'});accountGeneration.current++;accountRequest.current?.abort();readinessRequest.current?.abort();refreshInFlight.current=false;setAccount({signedIn:false});setCustomizeOpen(false);setCampaign(null);setDraftBrand(null);setFundingOpen(false);}catch{setAccountError(true);}}
 function closeFunding(){setFundingOpen(false);if(window.location.hash==='#funding')window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search);document.getElementById('workspace-funding-toggle')?.focus();}
 async function membershipChanged(stopped=false){if(stopped){accountGeneration.current++;accountRequest.current?.abort();readinessRequest.current?.abort();refreshInFlight.current=false;setSettingsOpen(false);setAccount(current=>current?{...current,billingModel:'membership_credits',membershipActive:false,paused:true}:current);}return refreshAccount(true);}
 function openFunding(code='',suggestion:{amountCents:number;reason:string}|null=null){setFundingSuggestion(suggestion);if(account?.billingModel==='membership_credits'&&!account.membershipActive){showDetails('membership-settings');return;}setFundingCode(code);setFundingOpen(true);if(window.location.hash!=='#funding')window.history.pushState(window.history.state,'','#funding');}
 const funding=nextWorkFunding(account??{},accountError);
 const suggestedAction=workspaceNextAction({...account,spendingActivationAvailable},campaign);
 const nextAction=funding.needsFunding&&suggestedAction.kind==='resume'?{kind:'funding' as const,label:'Review funding',reason:'There are not enough available credits for the next eligible task. Your saved progress stays here.'}:suggestedAction;
 function showDetails(id:string){if(id==='notification-settings'){setPreferencesOpen(true);return;}setSettingsOpen(true);requestAnimationFrame(()=>{const section=document.getElementById(id);if(section instanceof HTMLDetailsElement)section.open=true;section?.scrollIntoView({block:'start'});});}
 function doNextAction(){if(nextAction.kind==='membership')openFunding();else if(nextAction.kind==='identity')showDetails('account-details');else if(nextAction.kind==='campaign')showDetails('outreach-campaign-details');else if(nextAction.kind==='activation'){const review=document.getElementById('spending-activation-review');review?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});review?.focus();}else if(nextAction.kind==='funding')openFunding();else if(nextAction.kind==='resume')void toggleBot('resume');else if(nextAction.kind==='pause')void toggleBot('pause');else if(nextAction.kind==='work')document.getElementById('workspace-properties')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});}
 function openNextWork(reason:string){
  const attention=reason==='review'?document.getElementById('workspace-attention'):null;
  const target=attention??document.getElementById('workspace-properties');
  if(attention instanceof HTMLDetailsElement)attention.open=true;
  target?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
  if(attention)attention.focus();
 }
 function openAssistant(request?:AssistantRequest){
  if(accountError)return;
  if(!featureVip){setReviewVip(true);return;}
  setAssistantAccount(account?.email??null);
  if(request)setAssistantRequest(request);else setAssistantOpenRequest(v=>v+1);
 }
 async function assistantAction(action:AssistantAction){
  if(action.kind==='funding'){openFunding();return;}
  if(creditsExhausted&&action.kind!=='pause'&&action.kind!=='support'){openFunding();return;}
  if(action.kind==='pause'||action.kind==='resume'){if(!await toggleBot(action.kind))throw Error('Could not confirm the bot update. Please check its status above.');return;}
  if(action.kind==='property'&&action.screeningId){setPropertyRequest({id:action.screeningId,nonce:Date.now()});return;}
  if(action.kind==='attention'){const section=document.getElementById('workspace-attention');if(section){if(section instanceof HTMLDetailsElement)section.open=true;section.scrollIntoView({behavior:'smooth',block:'center'});section.focus();}else throw Error('The request list is refreshing. Check Needs you in a moment.');return;}
  if(action.kind==='support')window.location.assign('/support');
 }
 const botRunning=(account?.billingModel!=='membership_credits'||account?.membershipActive===true)&&account?.paused===false&&(account.billingActive===true||account.billingModel==='prepaid'||account.billingModel==='membership_credits')&&!account?.billingReview&&!!account?.identity&&!!(account.workReady||account.smsWorkReady||account.discoveryWorkReady||account.contactWorkReady||account.activeWork);
 const workspaceLocked=account?.signedIn===true&&account.billingModel==='membership_credits'&&account.membershipActive!==true;
 const canSwitchPlan=account?.signedIn===true&&account.isBillingOwner===true&&!workspaceLocked&&!accountError;
 const featureVip=!workspaceLocked&&!accountError&&(account?.vipFeatures??account?.vip)===true;
 useEffect(()=>{setAssistantRequest(null);setAssistantOpenRequest(0);setAssistantAccount(null);},[featureVip,account?.email]);
 const displayVip=!workspaceLocked&&!accountError&&account?.vip===true;
 // The account API already returns spendable credits, net of reservations.
 const creditsExhausted=account?.signedIn===true&&!workspaceLocked&&!accountError&&typeof account.balanceCents==='number'&&account.balanceCents<=0;
 const returningWithoutCredits=creditsExhausted&&account.hasCreditHistory===true;
 const guest=!account?.signedIn;const profile=account?.signedIn?account.botSetup?.profile:draftBrand;const theme=setupThemes.ink;
 const needsIdentity=account?.signedIn===true&&!workspaceLocked&&!account.identity;
 // Older accounts can already have a working, named assistant without a setup
 // profile. Missing branding is not evidence that their bot needs creating.
 const needsBotName=account?.signedIn===true&&!account.readinessPending&&!accountError&&!botRunning&&!account.activeWork&&((account.balanceCents??0)>0||account.billingModel==='prepaid'||account.membershipActive===true)&&!account.assistantName?.trim()&&!account.botSetup?.profile.displayName?.trim();
 if(guest)return <WebinarExpressCheckout showFeatures checkingAccount={!account} accountError={accountError} signInReady={account?.signInReady??true} onRetry={()=>void refreshAccount()} onSignedIn={()=>void refreshAccount(true)}/>;
 if(account.workspaceAcknowledged!==true)return <main className="workspace-ack-shell"><span className="workspace-ack-brand">iCash X</span><WorkspaceAcknowledgment key={account.email} onAccepted={()=>refreshAccount(true,true)}/>{accountError&&<p role="alert">Your account could not refresh. <button onClick={()=>void refreshAccount(true)}>Retry</button></p>}<div className="workspace-ack-actions"><SupportLauncher onMembershipChanged={membershipChanged}/>{account.paused===false&&<button type="button" disabled={controlBusy} onClick={()=>void toggleBot('pause')}>{controlBusy?'Pausing…':'Pause bot'}</button>}<button type="button" onClick={()=>void signOut()}>Sign out</button>{account.billingModel==='membership_credits'&&<button type="button" onClick={()=>setCancellationOpen(true)}>Cancel subscription</button>}</div>{controlError&&<p role="alert">{controlError}</p>}{cancellationOpen&&<MembershipSettings cancellationOnly onClosed={()=>setCancellationOpen(false)} onChanged={membershipChanged}/>}</main>;
 return <div className={`console-shell personalized-workspace minimal-workspace assistant-workspace icash-brand-workspace ${styles.workspace}${displayVip&&!workspaceLocked?' '+styles.vip:''}`} style={{'--bot-color':theme.color,'--bot-soft':theme.soft} as CSSProperties}>
  <header className="console-header">
   <a href="/course" id="workspace-tour-course" className="workspace-course-launcher"><BookOpen size={17} aria-hidden="true"/>Course</a>
   <div className="workspace-header-links">
    {!workspaceLocked&&<WorkspaceUpdates onPreferences={()=>showDetails('notification-settings')} onBudget={()=>openFunding()}/>}
    <details ref={accountMenu} className="workspace-account-menu" onBlur={event=>{if(event.relatedTarget instanceof Node&&!event.currentTarget.contains(event.relatedTarget))closeAccountMenu();}}>
     <summary id="workspace-tour-menu" aria-label="Account menu" title="Account menu"><Menu size={21} aria-hidden="true"/></summary>
     <div className="workspace-account-options">
      <SupportLauncher key={account.email??'account'} onMembershipChanged={membershipChanged} onOpen={()=>closeAccountMenu(true)} onClose={()=>accountMenu.current?.querySelector('summary')?.focus()}/>
      {!workspaceLocked&&<button type="button" onClick={()=>{closeAccountMenu(true);setWalkthroughRequest({email:account.email,nonce:Date.now()});}}>Take a walkthrough</button>}
      {account.isBillingOwner&&<><a href="/admin" onClick={()=>closeAccountMenu()}>Admin</a><a href="/admin/accounts" onClick={()=>closeAccountMenu()}>View accounts</a></>}
      {canSwitchPlan&&<button type="button" disabled={controlBusy} onClick={()=>{closeAccountMenu(true);setReviewVip(true);}}>Switch account plan</button>}
      {!workspaceLocked&&!displayVip&&!canSwitchPlan&&account.billingModel==='membership_credits'&&<button type="button" className="workspace-vip-menu" aria-haspopup="dialog" disabled={controlBusy||accountError} onClick={()=>{closeAccountMenu(true);setReviewVip(true);}}>Explore VIP</button>}
      {!workspaceLocked&&<button type="button" onClick={()=>{closeAccountMenu(true);setCustomizeOpen(true);}}>Customize bot</button>}
      {!workspaceLocked&&<button type="button" aria-expanded={settingsOpen} onClick={()=>{closeAccountMenu(true);setSettingsOpen(v=>!v);}}>Settings</button>}
      <a href="/api/account/workspace-acknowledgment" download>My workspace acknowledgment</a>
      <button type="button" onClick={()=>{closeAccountMenu(true);void signOut();}}>Sign out</button>
      {account.billingModel==='membership_credits'&&<button type="button" className="workspace-cancel-subscription" onClick={()=>{closeAccountMenu(true);setCancellationOpen(true);}}>Cancel subscription</button>}
     </div>
    </details>
   </div>
  </header>
  {cancellationOpen&&<MembershipSettings cancellationOnly onClosed={()=>{setCancellationOpen(false);accountMenu.current?.querySelector('summary')?.focus();}} onChanged={membershipChanged}/>}
  <main className="console-main">
   {accountError&&<p role="alert">Could not load your account. <button onClick={()=>void refreshAccount()}>Retry</button></p>}
   {signInOpen&&guest&&<section className="inline-sign-in setup-sign-in" id="inline-sign-in" aria-labelledby="sign-in-title"><div className="sign-in-heading"><h2 id="sign-in-title">Welcome back</h2><button aria-label="Close sign-in" onClick={()=>{setSignInOpen(false);document.getElementById('balance-sign-in')?.focus();}}><X size={19}/></button></div><AccountAccess ready={account?.signInReady===true} onSignedIn={()=>void refreshAccount(true)}/></section>}
   {!account?<section className="account-loading" role="status"><h1 className="sr-only">iCash X workspace</h1><p>{accountError?'Your account could not load. Retry above to continue.':'Opening your workspace…'}</p></section>:<>
    {!workspaceLocked&&<h1 className="sr-only" id="workspace-title">iCash X workspace</h1>}
    {workspaceLocked?<section className="subscription-lock" aria-label="Restore access"><h1>Renew subscription</h1><p>Your workspace is locked. Your unused credits are saved.</p><MembershipSettings locked onChanged={membershipChanged}/><button className="workspace-quiet" onClick={()=>void refreshAccount()}>Check payment</button></section>:<>
    {controlError&&<p role="alert">{controlError}</p>}
    <WorkspaceWalkthrough key={`walkthrough:${account.email}`} openRequest={walkthroughRequest.email===account.email?walkthroughRequest.nonce:0} blocked={accountError||customizeOpen||fundingOpen||settingsOpen||preferencesOpen||cancellationOpen||reviewVip} onOpenChange={setWalkthroughOpen}/>
    <BotRunBar key={account.email} hasLeads={leadPresence?.email===account.email?leadPresence?.hasLeads:undefined} botName={profile?.displayName||account.assistantName} vip={displayVip} onVip={displayVip&&!canSwitchPlan&&account.billingModel==='membership_credits'?()=>setReviewVip(true):undefined} running={botRunning} paymentRequired={account.billingModel==='membership_credits'&&!account.membershipActive} stopped={account.paused===true&&(account.balanceCents??0)>0} busy={controlBusy} stale={accountError} balanceCents={guest?undefined:account.balanceCents} hasCreditHistory={account.hasCreditHistory} canPause={account.paused===false&&((account.balanceCents??0)>0||account.billingActive===true)} principalKey={account.email} onBudget={()=>openFunding()} onPause={()=>void toggleBot('pause')} onResume={()=>void toggleBot('resume')}/>
    {fundingNotice&&fundingNotice.email===account.email&&<FundingOutreachNotice paused={account.paused} ready={botRunning&&(account.balanceCents??0)>0&&!controlBusy} stale={accountError||account.readinessPending===true||fundingNotice.accountAtFunding===account} test={account.mode==='test'} onDismiss={()=>setFundingNotice(null)}/>}
    {<WorkspaceConversion key={account.email??'account'} principal={account.email??''} balanceCents={account.balanceCents} paused={account.paused} stale={accountError||!!account.billingReview} attentionPending={attentionPending} hidden={fundingNotice?.email===account.email||walkthroughOpen||customizeOpen||fundingOpen||settingsOpen||preferencesOpen||cancellationOpen||reviewVip||needsIdentity||needsBotName||new URLSearchParams(typeof window==='undefined'?'':window.location.search).get('payment')==='funded'} busy={controlBusy} onFunding={(amountCents,reason)=>openFunding('',{amountCents,reason})} onResume={()=>void toggleBot('resume')} onVip={()=>setReviewVip(true)} onWork={openNextWork}/>}
    <div className={styles.activity}><BudgetSummary key={`${account.email}:${displayVip}`} vip={displayVip}/></div>
    {fundingOpen&&<FundingDialog title={guest||account.billingModel==='membership_credits'&&!account.membershipActive?'iCash X 2.0':returningWithoutCredits?'Out of credits':creditsExhausted?'Start your bot':'Add money'} onClose={closeFunding}>{guest||account.billingModel==='membership_credits'&&!account.membershipActive?<MembershipCheckout onSignedIn={()=>{closeFunding();void refreshAccount(true);}}/>:<FundingCheckout initialAmountCents={fundingSuggestion?.amountCents} reason={fundingSuggestion?.reason} outOfCredits={returningWithoutCredits} initialCode={fundingCode||undefined} onSignedIn={()=>{closeFunding();void refreshAccount(true);}}/>}</FundingDialog>}
    {reviewVip&&<FundingDialog title={account.isBillingOwner?'Your account plan':account.vip?'Your VIP membership':'Switch to VIP'} onClose={()=>setReviewVip(false)}><div className={styles.vipPanel}>{account.isBillingOwner?<><AdminPlanToggle plan={account.vip?'vip':'standard'} busy={controlBusy||accountError} onChange={plan=>void changePlan(plan)}/>{controlError&&<p role="alert">{controlError}</p>}</>:<MembershipSettings key={account.email} planOnly onChanged={membershipChanged}/>}</div></FundingDialog>}
    {!guest&&customizeOpen&&<FundingDialog title="Customize bot" onClose={()=>setCustomizeOpen(false)}><BotCustomization key={`${account.email}:${featureVip}`} name={profile?.displayName||account.assistantName||''} vip={featureVip} onSaved={()=>refreshAccount(true)} onUpgrade={()=>{setCustomizeOpen(false);setReviewVip(true);}}/></FundingDialog>}
    {!guest&&settingsOpen&&<FundingDialog title="Account details" onClose={()=>{setSettingsOpen(false);setReviewVip(false);}}><div className="simple-account-settings" aria-label="Workspace settings"><section id="account-details"><CustomerIdentity identity={account.identity??null} contact={{email:account.email??'',phone:account.phone??'',pendingEmail:account.pendingEmail}} onSaved={()=>void refreshAccount()}/></section><details id="membership-settings" className="workspace-membership-details"><summary>Subscription & billing</summary><MembershipSettings onChanged={membershipChanged}/></details></div></FundingDialog>}
    {!guest&&preferencesOpen&&<FundingDialog title="Email & text updates" onClose={()=>setPreferencesOpen(false)}><BotUpdatePreferences phone={account.phone}/></FundingDialog>}
    {!guest&&<OutreachCampaignAcknowledgment statusOnly onStatus={setCampaign}/>}
    {!guest&&featureVip&&<PlatformBuyerNetwork key={`${account.email}:${displayVip}`}/>}
    <section className="operation-panel" aria-label="Your AI real estate bot">
     {guest?<div className="workspace-first-visit"><h2>Your properties</h2><p>Join for $50/month, then add money to start your bot.</p></div>:<>
     {needsIdentity&&<section className="identity-onboarding"><CustomerIdentity identity={null} onboarding onSaved={()=>void refreshAccount()}/></section>}
     {!needsIdentity&&needsBotName&&<PostPaymentBotName vip={account.vip===true} onBrand={updateBrand} onCreated={async()=>{await refreshAccount();}}/>}
     {!account.readinessPending&&(nextAction.kind==='activation'||nextAction.kind==='support'&&account.billingReview)&&<div className="workspace-state-row">
      {nextAction.kind==='support'?<a className="fund-button" href="/support">{nextAction.label}</a>:<button className="fund-button" disabled={workspaceActionDisabled(nextAction.kind,controlBusy,accountError)} onClick={doNextAction}>{controlBusy?'Saving…':nextAction.label}</button>}
     </div>}
     {account.mode==='test'&&<p className="workspace-test-label">Test workspace</p>}
     {account.mode==='live'&&account.billingModel==='legacy'&&<SpendActivationReview key={activationKey} onAvailabilityChange={updateActivationAvailability} onSaved={()=>void refreshAccount()}/>}
     <CreditActionGate actionsOnly blocked={creditsExhausted} onRequireCredits={()=>openFunding()}>
     {<SpendingAllowance/>}
     <LiveWorkspace key={account.email} onLeadPresenceChange={updateLeadPresence} onAttentionChange={setAttentionPending} assistantVipLocked={!featureVip} onOpenAssistant={()=>openAssistant()} propertyRequest={propertyRequest} onAsk={(screeningId,address)=>openAssistant({screeningId,address,nonce:Date.now(),mode:'compose'})} principal={account.identity?.principal??''} botPaused={account.paused===true} botAvailable={(account.billingModel!=='membership_credits'||account.membershipActive===true)&&!account.billingReview&&!!account.identity&&(account.balanceCents??0)>0&&!!(account.workReady||account.smsWorkReady||account.discoveryWorkReady||account.contactWorkReady)} accountStale={accountError} showCoach={false}/>
     </CreditActionGate>
     </>}
    </section>
    {!guest&&featureVip&&<CreditActionGate actionsOnly blocked={creditsExhausted} onRequireCredits={()=>openFunding()}><WorkspaceAssistant key={account.email} openRequest={assistantAccount===account.email?assistantOpenRequest:0} request={assistantAccount===account.email?assistantRequest:null} stale={accountError} onAction={assistantAction} onVipRequired={()=>{setReviewVip(true);void refreshAccount();}}/></CreditActionGate>}
    </>}
   </>}
  </main>
  <footer className="product-disclosure"><p>Paid usage. Results aren’t guaranteed. Real estate involves risk.</p><a href="/costs-and-disclosures">Costs, risks & disclosures</a></footer>

 </div>;
}
