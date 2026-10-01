'use client';
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {ArrowRight,Check,LoaderCircle} from 'lucide-react';
import {BotBuilding,type BotBuildPhase} from './bot-building';
import {saveBotBuild} from '@/lib/bot-build';
import {BotBrand} from './bot-brand';
import {FundingCheckout} from './funding-checkout';
import {DemoRunner} from './demo-runner';
import {practiceBudgets,practiceScope,readPracticeSelection,savePracticeSelection,type PracticeBudget} from '@/lib/practice-funnel';
import {defaultBotProfile,setupThemes,setupProfileSchema,type BotProfile,type BotSetup} from '@/lib/bot-setup';

function track(event:string){void fetch('/api/setup/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event}),keepalive:true}).catch(()=>{});}

export function BotSetupFlow({onBrand,onSignedIn}:{onBrand:(profile:BotProfile)=>void;onSignedIn:()=>void}){
 const [buildPhase,setBuildPhase]=useState<BotBuildPhase|null>(null);
 const saveInFlight=useRef(false),saveController=useRef<AbortController|null>(null),mounted=useRef(true),retryBuild=useRef(false);
 const [setup,setSetup]=useState<BotSetup|null>(null),[profile,setProfile]=useState<BotProfile>(defaultBotProfile);
 const [screen,setScreen]=useState<'entry'|'demo'|'funding'>('entry');
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [budgets,setBudgets]=useState<PracticeBudget[]|null>(null),[budgetCode,setBudgetCode]=useState(''),[budgetError,setBudgetError]=useState(''),[budgetRetry,setBudgetRetry]=useState(0);
 const [nameFocused,setNameFocused]=useState(false),[nameHint,setNameHint]=useState('e.g. Scout');
 const nameEdited=useRef(false),budgetEdited=useRef(false);
 const heading=useRef<HTMLHeadingElement>(null),ready=useRef(false),init=useRef<Promise<BotSetup>|null>(null);
 const hasName=profile.displayName.length>0;
 const selected=budgets?.find(budget=>budget.code===budgetCode)??null;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;saveController.current?.abort();};},[]);
 useEffect(()=>{
  if(screen!=='entry'||nameFocused||hasName){setNameHint('Give your bot a name');return;}
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  let timer:ReturnType<typeof setTimeout>|undefined;let stopped=false;
  const examples=['e.g. Scout','e.g. Atlas'];let phrase=0,index=0;
  const stop=()=>{stopped=true;clearTimeout(timer);setNameHint('Give your bot a name');};
  const tick=()=>{if(stopped)return;if(document.hidden){timer=setTimeout(tick,400);return;}index++;setNameHint(examples[phrase].slice(0,index));if(index<examples[phrase].length)timer=setTimeout(tick,65);else if(phrase===0){phrase=1;index=0;timer=setTimeout(tick,1100);}};
  if(motion.matches)stop();else timer=setTimeout(tick,450);
  const onMotion=()=>{if(motion.matches)stop();};motion.addEventListener('change',onMotion);
  return()=>{stopped=true;clearTimeout(timer);motion.removeEventListener('change',onMotion);};
 },[screen,nameFocused,hasName]);
 async function load(){
  setLoading(true);setError('');
  try{
   if(!init.current)init.current=fetch('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'init'}),signal:AbortSignal.timeout(20000)}).then(async r=>{const d=await r.json();if(!r.ok||!d.setup)throw Error();return d.setup;});
   const s=await init.current;
   if(!mounted.current)return;
   setSetup(s);
   setProfile(p=>({...defaultBotProfile,...s.profile,aiLogo:null,...(nameEdited.current?{displayName:p.displayName}:{})}));
   if(!nameEdited.current){
    const saved=readPracticeSelection(s.id);
    if(saved&&!budgetEdited.current){setBudgetCode(saved.code);if(s.stage>0&&s.profile.displayName?.trim())setScreen(saved.screen);}
   }
   // Payment confirmation wins over any name edits made while setup was loading.
   if(new URLSearchParams(window.location.search).get('payment')==='funded')setScreen('funding');
   if(s.stage>0)track('returned');
  }catch{init.current=null;if(mounted.current)setError('Connection interrupted. Your entries are still here.');}
  finally{if(mounted.current)setLoading(false);}
 }
 useEffect(()=>{if(new URLSearchParams(window.location.search).get('payment')==='funded')setScreen('funding');void load();},[]);
 useEffect(()=>{
  const controller=new AbortController();setBudgetError('');
  fetch('/api/funding/status',{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])}).then(async response=>{
   const data=await response.json();if(!response.ok)throw Error('Could not load budget options.');
   const options=practiceBudgets(data);if(!options.length)throw Error('Budget options are currently unavailable.');
   if(!controller.signal.aborted){setBudgets(options);setBudgetCode(current=>current||options[0].code);}
  }).catch(e=>{if(!controller.signal.aborted){setBudgets(null);setBudgetError(e instanceof Error?e.message:'Could not load budget options.');}});
  return()=>controller.abort();
 },[budgetRetry]);
 useEffect(()=>{onBrand(profile);},[profile,onBrand]);
 useEffect(()=>{
  if(!setup)return;
  if(screen==='entry')track('name_viewed');else if(screen==='funding')track('funding_viewed');
  if(ready.current)heading.current?.focus();ready.current=true;
 },[screen,setup?.id]);
 async function save(value:BotProfile){
  if(saveInFlight.current)return false;
  if(!selected){setError('Choose an available practice budget before running the simulation.');return false;}
  const parsed=setupProfileSchema.safeParse({...value,aiLogo:null});
  if(!parsed.success){setError(!value.displayName.trim()?'Enter a name for your bot.':'Check your bot’s name and market, then try again.');return false;}
  saveInFlight.current=true;setError('');setBusy(true);setBuildPhase('saving');
  const started=Date.now();const controller=new AbortController();saveController.current=controller;
  const timeout=setTimeout(()=>controller.abort(),20000);
  try{
   if(!setup&&!init.current)await load();
   const current=setup??await init.current;if(!current)throw Error('Could not connect. Try again to restore your setup.');
   // Merge current persisted preferences so an early name submission cannot erase a saved market.
   const savedProfile=setupProfileSchema.parse({...defaultBotProfile,...current.profile,displayName:parsed.data.displayName,aiLogo:null});
   const saved=await saveBotBuild(savedProfile,current,{retry:retryBuild.current,signal:controller.signal,nameOnly:true});
   if(!mounted.current||controller.signal.aborted)return false;
   setSetup(saved);setProfile({...defaultBotProfile,...saved.profile,aiLogo:null});setBuildPhase('saved');
   savePracticeSelection(saved.id,selected.code,'demo');
   const minimum=window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:1000;
   await new Promise(resolve=>setTimeout(resolve,Math.max(0,minimum-(Date.now()-started))));
   if(!mounted.current)return false;
   retryBuild.current=false;setScreen('demo');setBuildPhase(null);return true;
  }catch(e){if(mounted.current){retryBuild.current=true;setError(controller.signal.aborted?'The connection took too long. Try again to check and save your setup.':e instanceof Error&&e.message?e.message:'Could not save. Please retry.');setBuildPhase('error');}return false;}
  finally{clearTimeout(timeout);saveInFlight.current=false;if(mounted.current)setBusy(false);}
 }
 function fund(){if(!setup||!selected)return;savePracticeSelection(setup.id,selected.code,'funding');setScreen('funding');}
 const theme=setupThemes[profile.theme];const style={'--bot-color':theme.color,'--bot-soft':theme.soft} as CSSProperties;
 if(buildPhase)return <section className="bot-setup setup-building" aria-label="Build your real estate bot"><BotBuilding profile={profile} phase={buildPhase} error={error} onRetry={()=>void save(profile)} onBack={()=>{setBuildPhase(null);setError('');requestAnimationFrame(()=>heading.current?.focus());}}/></section>;
 const paymentReturn=typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('payment')==='funded';
 return <section className={`bot-setup setup-funnel ${screen==='entry'?'setup-entry':'setup-complete'}`} style={style} aria-label="Build your real estate bot">
  <div className="setup-layout"><div className="setup-form setup-step-enter" key={screen}>
   {screen==='entry'?<>
    <span className="setup-eyebrow">YOUR BOT. YOUR FIRST PRACTICE DEAL.</span>
    <h1 ref={heading} tabIndex={-1}>Meet your AI bot.</h1>
    <p className="setup-intro">Give it a name and a practice budget. Watch a fictional deal from start to finish.</p>
    <form className="setup-entry-form" onSubmit={e=>{e.preventDefault();void save(profile);}}>
     <label className="setup-label" htmlFor="bot-name">Your bot’s name</label>
     <input className="setup-input" id="bot-name" autoComplete="off" maxLength={64} value={profile.displayName} onChange={e=>{nameEdited.current=true;setProfile(p=>({...p,displayName:e.target.value}));setError('');}} placeholder={nameHint} onFocus={()=>setNameFocused(true)} required disabled={busy}/>
     <label className="setup-label practice-budget-label" htmlFor="practice-budget">Practice budget <span>No payment</span></label>
     <select className="setup-input" id="practice-budget" value={selected?.code??''} disabled={busy||!budgets} required aria-describedby="practice-budget-note" onChange={e=>{budgetEdited.current=true;setBudgetCode(e.target.value);setError('');}}>
      {!selected&&<option value="" disabled>{budgets?'Choose a practice budget':'Loading budget options…'}</option>}
      {budgets?.map(budget=><option key={budget.code} value={budget.code}>${(budget.priceCents/100).toLocaleString()} practice budget</option>)}
     </select>
     <p id="practice-budget-note" className="practice-note">Simulation only. No real charges, outreach, or earnings. Your chosen amount carries into the real daily-budget review later.</p>
     {budgetError&&<p role="alert" className="setup-error">{budgetError} <button type="button" className="setup-retry" onClick={()=>setBudgetRetry(n=>n+1)}>Retry budget options</button></p>}
     <button className="setup-primary" disabled={busy||loading||!profile.displayName.trim()||!selected}>{busy?<><LoaderCircle size={18} className="setup-spin"/> Saving your setup…</>:<>Create &amp; run demo<ArrowRight size={18}/></>}</button>
    </form>
    {profile.market&&<p className="practice-note">Research preference: {profile.market}</p>}
   </>:<>
    <div className="setup-progress"><span><Check size={14}/> Bot setup saved</span></div>
    <h1 className="setup-ready-title" ref={heading} tabIndex={-1}>{screen==='demo'?`${profile.displayName} is running a simulation.`:'Fund your bot.'}</h1>
    <div className="funnel-bot-summary"><BotBrand profile={profile}/><span>{profile.market}{selected?` · $${(selected.priceCents/100).toLocaleString()} ${screen==='demo'?'practice budget':'daily budget selected'}`:''}</span></div>
    {screen==='funding'&&(selected||paymentReturn)?<div className="setup-funding"><p className="practice-note">Review the current price and daily renewal terms below. Your practice budget is not money in your account.</p><FundingCheckout initialCode={selected?.code??'budget_ten'} onSignedIn={onSignedIn}/></div>
    :selected&&setup?<>
     <div className="funnel-fund-cta"><div><strong>Ready for the next step?</strong><span>Skip the simulation anytime. Review real billing before paying.</span></div><button type="button" className="fund-button" onClick={fund}>Fund my bot<ArrowRight size={17}/></button></div>
     <DemoRunner key={practiceScope(setup.id,selected.code)} scope={practiceScope(setup.id,selected.code)} botName={profile.displayName} practiceBudgetCents={selected.priceCents}/>
    </>:<div className="practice-recovery" role="status"><p>{budgetError||(!budgets?'Checking your saved practice budget…':'Your previous budget is no longer available. Choose an available practice budget to continue.')}</p>{budgetError?<button type="button" className="setup-retry" onClick={()=>setBudgetRetry(n=>n+1)}>Retry budget options</button>:budgets&&<button type="button" className="setup-retry" onClick={()=>setScreen('entry')}>Review practice budget</button>}</div>}
   </>}
   {error&&<div role="alert" className="setup-error">{error}{!setup&&<button className="setup-retry" disabled={loading||busy} onClick={()=>void load()}>{loading?'Reconnecting…':'Reconnect'}</button>}</div>}
  </div></div>
 </section>;
}
