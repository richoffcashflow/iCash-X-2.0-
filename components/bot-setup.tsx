'use client';
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {ArrowRight,Check,LoaderCircle,Search,MessageCircle,FileText,Wallet,ShieldCheck,Sparkles,ChartNoAxesCombined} from 'lucide-react';
import {BotBuilding,type BotBuildPhase} from './bot-building';
import {saveBotBuild,waitForBotCreationTransition,type SetupEditableField} from '@/lib/bot-build';
import {BotBrand} from './bot-brand';
import {FundingCheckout} from './funding-checkout';
import {MembershipCheckout} from './membership-checkout';
import {defaultBotProfile,setupThemes,setupProfileSchema,type BotProfile,type BotSetup} from '@/lib/bot-setup';

function track(event:string){void fetch('/api/setup/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event}),keepalive:true}).catch(()=>{});}
export function BotSetupFlow({onBrand,onSignedIn}:{onBrand:(profile:BotProfile)=>void;onSignedIn:()=>void}){
 const [buildPhase,setBuildPhase]=useState<BotBuildPhase|null>(null);
 const saveInFlight=useRef(false),saveController=useRef<AbortController|null>(null),mounted=useRef(true),retryBuild=useRef(false);
 const edited=useRef(new Set<SetupEditableField>());
 const [setup,setSetup]=useState<BotSetup|null>(null),[profile,setProfile]=useState<BotProfile>(defaultBotProfile);
 const [creditReturn,setCreditReturn]=useState(false);
 const [screen,setScreen]=useState<'entry'|'funding'>('entry');
 const navigationVersion=useRef(0);
 function navigate(next:'entry'|'funding',replace=false){setScreen(next);const hash=next==='entry'?'#setup':'#funding';if(window.location.hash!==hash)window.history[replace?'replaceState':'pushState'](window.history.state,'',hash);}
 function syncScreen(resume=false){
  const {hash,search}=window.location;
  const paymentReturn=new URLSearchParams(search).get('payment')==='funded';setCreditReturn(paymentReturn);
  const next=paymentReturn||hash==='#funding'||hash==='#example'||(resume&&hash!=='#setup')?'funding':'entry';
  setScreen(next);
  // Retired example links resume at funding without adding another history entry.
  if(next==='funding'&&(!hash||hash==='#example'))window.history.replaceState(window.history.state,'','#funding');
 }
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const heading=useRef<HTMLHeadingElement>(null),ready=useRef(false),init=useRef<Promise<BotSetup>|null>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;saveController.current?.abort();};},[]);
 async function load(){
  const startedNavigation=navigationVersion.current;
  setLoading(true);setError('');
  try{
   if(!init.current)init.current=fetch('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'init'}),signal:AbortSignal.timeout(20000)}).then(async r=>{const d=await r.json();if(!r.ok||!d.setup)throw Error();return d.setup;});
   const s=await init.current;if(!mounted.current)return;
   setSetup(s);
   setProfile(p=>({...defaultBotProfile,...s.profile,...Object.fromEntries([...edited.current].map(field=>[field,p[field]])),aiLogo:null}));
   // Keep newer navigation and unsaved edits; payment confirmation always wins.
   if(!edited.current.size||new URLSearchParams(window.location.search).get('payment')==='funded')syncScreen(startedNavigation===navigationVersion.current&&s.stage>0&&!!s.profile.displayName?.trim());
   if(s.stage>0)track('returned');
  }catch{init.current=null;if(mounted.current)setError('Connection interrupted. Your entries are still here.');}
  finally{if(mounted.current)setLoading(false);}
 }
 useEffect(()=>{syncScreen();void load();const sync=()=>{navigationVersion.current++;syncScreen();};window.addEventListener('popstate',sync);window.addEventListener('hashchange',sync);return()=>{window.removeEventListener('popstate',sync);window.removeEventListener('hashchange',sync);};},[]);
 useEffect(()=>{onBrand(profile);},[profile,onBrand]);
 useEffect(()=>{if(!setup)return;track(screen==='entry'?'name_viewed':'funding_viewed');if(ready.current)heading.current?.focus();ready.current=true;},[screen,setup?.id]);
 async function save(){
  if(saveInFlight.current||loading)return false;
  const parsed=setupProfileSchema.safeParse({...profile,displayName:profile.displayName.trim()||'My iCash bot',aiLogo:null});
  if(!parsed.success){setError(!profile.displayName.trim()?'Enter a name for your bot.':'Could not validate your saved preferences. Reload and try again.');return false;}
  saveInFlight.current=true;setError('');setBusy(true);setBuildPhase('saving');
  const started=Date.now(),startedNavigation=navigationVersion.current;const controller=new AbortController();saveController.current=controller;
  const timeout=setTimeout(()=>controller.abort(),20000);
  try{
   const current=setup??await init.current;if(!current)throw Error('Could not connect. Try again to restore your setup.');
   const fields=[...new Set<SetupEditableField>(['displayName',...edited.current])];
   const savedProfile=setupProfileSchema.parse({...defaultBotProfile,...current.profile,...Object.fromEntries(fields.map(field=>[field,parsed.data[field]])),aiLogo:null});
   const saved=await saveBotBuild(savedProfile,current,{retry:retryBuild.current,signal:controller.signal,editedFields:fields});
   if(!mounted.current||controller.signal.aborted)return false;
   setSetup(saved);setProfile({...defaultBotProfile,...saved.profile,aiLogo:null});setBuildPhase('saved');
   await waitForBotCreationTransition(started,controller.signal,window.matchMedia('(prefers-reduced-motion: reduce)').matches);
   if(!mounted.current||controller.signal.aborted)return false;
   retryBuild.current=false;if(startedNavigation===navigationVersion.current)navigate('funding');setBuildPhase(null);return true;
  }catch(e){if(mounted.current){retryBuild.current=true;setError(controller.signal.aborted?'The connection took too long. Try again to check and save your setup.':e instanceof Error&&e.message?e.message:'Could not save. Please retry.');setBuildPhase('error');}return false;}
  finally{clearTimeout(timeout);saveInFlight.current=false;if(mounted.current)setBusy(false);}
 }
 const theme=setupThemes[profile.theme];const style={'--bot-color':theme.color,'--bot-soft':theme.soft} as CSSProperties;
 if(buildPhase)return <section className="bot-setup setup-building" aria-label="Build your real estate bot"><BotBuilding profile={profile} phase={buildPhase} error={error} onRetry={()=>void save()} onBack={()=>{setBuildPhase(null);setError('');requestAnimationFrame(()=>heading.current?.focus());}}/></section>;
 return <section className={`bot-setup setup-funnel conversion-onboarding ${screen==='entry'?'setup-entry':'setup-complete'}`} style={style} aria-label="Build your real estate bot">
  {screen==='entry'&&<div className="onboarding-story"><span className="onboarding-kicker"><Sparkles size={15} aria-hidden="true"/>AI FOR REAL ESTATE WHOLESALERS</span><h1 ref={heading} tabIndex={-1}>Less busywork.<br/><span>More room to close.</span></h1><p className="onboarding-lede">Your AI workspace for finding properties, following up with sellers, and moving deals forward. One bot. Work credits you control.</p><div className="onboarding-features"><div><Search size={20} aria-hidden="true"/><span><strong>Find potential deals</strong><small>Property research and owner lookups.</small></span></div><div><ChartNoAxesCombined size={20} aria-hidden="true"/><span><strong>See the cash offer numbers</strong><small>Comps and estimates, together.</small></span></div><div><MessageCircle size={20} aria-hidden="true"/><span><strong>Keep conversations moving</strong><small>Calls, texts, and permitted AI follow-up.</small></span></div><div><FileText size={20} aria-hidden="true"/><span><strong>Work toward the close</strong><small>Buyer matching and contract tools.</small></span></div></div><p className="onboarding-availability">Live work depends on funding, available channels, and required account and contact checks.</p></div>}
  <div className="setup-layout"><div className="setup-form setup-step-enter" key={screen}>
   {screen==='entry'?<>
    <span className="onboarding-card-icon"><Sparkles size={25} aria-hidden="true"/></span>
    <span className="setup-eyebrow">START HERE</span>
    <h2>Your bot. Ready to set up.</h2>
    <p className="setup-intro">The defaults are ready. Create your bot, then review your software access.</p>
    <form className="setup-entry-form" onSubmit={e=>{e.preventDefault();void save();}}>
     <button className="setup-primary" disabled={busy||loading}>{busy?<><LoaderCircle size={18} className="setup-spin"/> Saving your setup…</>:<>Create my bot — free<ArrowRight size={18}/></>}</button>
     <p className="onboarding-no-card">No email, phone, or card needed to create your bot.</p>
     <details className="onboarding-name"><summary>Name your bot <span>Optional</span></summary><label className="setup-label" htmlFor="bot-name">Your bot’s name</label><input className="setup-input" id="bot-name" autoComplete="off" maxLength={64} value={profile.displayName} onChange={e=>{edited.current.add('displayName');setProfile(p=>({...p,displayName:e.target.value}));setError('');}} placeholder="My iCash bot" disabled={busy}/></details>
    </form>
    <div className="onboarding-budget-note"><Wallet size={19} aria-hidden="true"/><div><strong>Start work with $10 in credits</strong><p>Software access is separate. Add work credits inside your workspace.</p></div></div>
    <p className="onboarding-control"><ShieldCheck size={15} aria-hidden="true"/>Free setup. Paid work comes next.</p>
   </>:<>
    <div className="setup-progress"><span><Check size={14}/> Your bot is created</span></div>
    <button type="button" className="sample-reset" onClick={()=>navigate('entry')}>Edit bot name</button>
    <h1 className="setup-ready-title" ref={heading} tabIndex={-1}>Get your software access.</h1>
    <p className="setup-intro">Your bot is saved. Review the software subscription, then add work credits inside.</p>
    {profile.displayName&&<div className="funnel-bot-summary"><BotBrand profile={profile}/><span>Setup saved · software access comes next</span></div>}
    <div className="setup-funding">{creditReturn?<FundingCheckout onSignedIn={onSignedIn}/>:<MembershipCheckout onSignedIn={onSignedIn}/>}</div>
   </>}
   {error&&<div role="alert" className="setup-error">{error}{!setup&&<button className="setup-retry" disabled={loading||busy} onClick={()=>void load()}>{loading?'Reconnecting…':'Reconnect'}</button>}</div>}
  </div></div>
  {screen==='entry'&&<ol className="onboarding-path" aria-label="Getting started"><li><b>01</b><span><strong>Create your bot</strong><small>One click. Customize if you want.</small></span></li><li><b>02</b><span><strong>Review software access</strong><small>See the price and monthly renewal terms.</small></span></li><li><b>03</b><span><strong>Open your workspace</strong><small>Follow the next step and track progress.</small></span></li></ol>}
 </section>;
}
