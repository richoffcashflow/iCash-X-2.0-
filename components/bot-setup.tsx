'use client';
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {ArrowRight,Check,Play,Pause,LoaderCircle,X} from 'lucide-react';
import {DealExplainer} from './deal-explainer';
import {BotBuilding,type BotBuildPhase} from './bot-building';
import {saveBotBuild} from '@/lib/bot-build';
import {BotBrand} from './bot-brand';
import {FundingCheckout} from './funding-checkout';
import {defaultBotProfile,setupThemes,setupProfileSchema,resumeSetupStage,type BotProfile,type BotSetup,type SetupVoice} from '@/lib/bot-setup';

const voices=[{key:'sarah',name:'Sarah',description:'Warm & conversational'},{key:'chris',name:'Chris',description:'Relaxed & direct'},{key:'jessica',name:'Jessica',description:'Clear & friendly'}] as const;
function track(event:string){void fetch('/api/setup/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event}),keepalive:true}).catch(()=>{});}

export function BotSetupFlow({onBrand,onSignedIn}:{onBrand:(profile:BotProfile)=>void;onSignedIn:()=>void}){
 const [buildPhase,setBuildPhase]=useState<BotBuildPhase|null>(null);
 const saveInFlight=useRef(false),saveController=useRef<AbortController|null>(null),mounted=useRef(true),retryBuild=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;saveController.current?.abort();};},[]);
 const [setup,setSetup]=useState<BotSetup|null>(null);
 const [profile,setProfile]=useState<BotProfile>(defaultBotProfile);
 const [step,setStep]=useState(0);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [audioError,setAudioError]=useState(''),[playing,setPlaying]=useState(''),[previewLoading,setPreviewLoading]=useState('');
 const [nameFocused,setNameFocused]=useState(false),[nameHint,setNameHint]=useState('e.g. Scout');
 const hasName=profile.displayName.length>0;
 useEffect(()=>{
  if(step!==0||nameFocused||hasName){setNameHint('Give your bot a name');return;}
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  let timer:ReturnType<typeof setTimeout>|undefined;let stopped=false;
  const examples=['e.g. Scout','e.g. Atlas'];let phrase=0,index=0;
  const stop=()=>{stopped=true;clearTimeout(timer);setNameHint('Give your bot a name');};
  const tick=()=>{if(stopped)return;if(document.hidden){timer=setTimeout(tick,400);return;}index++;setNameHint(examples[phrase].slice(0,index));if(index<examples[phrase].length)timer=setTimeout(tick,65);else if(phrase===0){phrase=1;index=0;timer=setTimeout(tick,1100);}};
  if(motion.matches)stop();else timer=setTimeout(tick,450);
  const onMotion=()=>{if(motion.matches)stop();};motion.addEventListener('change',onMotion);
  return()=>{stopped=true;clearTimeout(timer);motion.removeEventListener('change',onMotion);};
 },[step,nameFocused,hasName]);
 const nameEdited=useRef(false),audio=useRef<HTMLAudioElement|null>(null),previewRequest=useRef(0);
 const heading=useRef<HTMLHeadingElement>(null),ready=useRef(false),init=useRef<Promise<BotSetup>|null>(null);
 const [notice,setNotice]=useState<{title:string;detail:string}|null>(null);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(null),6500);return()=>clearTimeout(timer);},[notice]);
 const catalog=useRef<Promise<SetupVoice[]>|null>(null);

 async function load(){
  setLoading(true);setError('');
  try{
   // Reuse initialization across Strict Mode replays and early form submissions.
   if(!init.current)init.current=fetch('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'init'}),signal:AbortSignal.timeout(20000)}).then(async r=>{const d=await r.json();if(!r.ok||!d.setup)throw Error();return d.setup;});
   const s=await init.current;
   setSetup(s);
   setProfile(p=>({...defaultBotProfile,...s.profile,aiLogo:null,...(nameEdited.current?{displayName:p.displayName}:{})}));
   if(!nameEdited.current)setStep(resumeSetupStage(s));
   if(s.stage>0)track('returned');
  }catch{init.current=null;setError('Connection interrupted. Your entries are still here.');}
  finally{setLoading(false);}
 }
 useEffect(()=>{void load();return()=>{previewRequest.current++;audio.current?.pause();};},[]);
 useEffect(()=>{onBrand(profile);},[profile,onBrand]);
 useEffect(()=>{
  if(!setup)return;
  track(step===0?'name_viewed':'funding_viewed');
  if(ready.current)heading.current?.focus();
  ready.current=true;
 },[step,setup?.id]);

 async function save(value:BotProfile){
  if(saveInFlight.current)return false;
  const parsed=setupProfileSchema.safeParse({...value,aiLogo:null});
  if(!parsed.success){setError(!value.displayName.trim()?'Enter a name for your bot.':'Check your bot’s name and market, then try again.');return false;}
  saveInFlight.current=true;setError('');setBusy(true);setBuildPhase('saving');
  const started=Date.now();const controller=new AbortController();saveController.current=controller;
  const timeout=setTimeout(()=>controller.abort(),20000);
  try{
   if(!setup&&!init.current){await load();}
   const current=setup??await init.current;
   if(!current)throw Error('Could not connect. Try again to restore your setup.');
   const saved=await saveBotBuild(parsed.data,current,{retry:retryBuild.current,signal:controller.signal});
   if(!mounted.current||controller.signal.aborted)return false;
   setSetup(saved);setProfile({...defaultBotProfile,...saved.profile,aiLogo:null});setBuildPhase('saved');
   // Keep even a fast save perceivable; this is presentation, not provisioning progress.
   const minimum=window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:1000;
   await new Promise(resolve=>setTimeout(resolve,Math.max(0,minimum-(Date.now()-started))));
   if(!mounted.current)return false;
   retryBuild.current=false;setStep(4);setBuildPhase(null);
   return true;
  }catch(e){if(mounted.current){retryBuild.current=true;setError(controller.signal.aborted?'The connection took too long. Try again to check and save your setup.':e instanceof Error&&e.message?e.message:'Could not save. Please retry.');setBuildPhase('error');}return false;}
  finally{clearTimeout(timeout);saveInFlight.current=false;if(mounted.current)setBusy(false);}
 }
 async function play(key:BotProfile['voice']){
  const request=++previewRequest.current;
  setAudioError('');audio.current?.pause();
  if(playing===key||previewLoading===key){setPlaying('');setPreviewLoading('');return;}
  setPlaying('');setPreviewLoading(key);
  try{
   // Load free catalog previews only when requested; no generated audio or call.
   if(!catalog.current)catalog.current=fetch('/api/setup/voices').then(async r=>{if(!r.ok)throw Error();const d=await r.json();return d.voices??[];});
   const voice=(await catalog.current).find(v=>v.key===key);
   if(request!==previewRequest.current)return;
   if(!voice)throw Error();
   const a=new Audio(voice.previewUrl);audio.current=a;
   a.onended=()=>{if(request===previewRequest.current)setPlaying('');};
   a.onerror=()=>{if(request===previewRequest.current){setPlaying('');setAudioError('Could not play the preview. Tap play to retry.');}};
   await a.play();
   if(request!==previewRequest.current){a.pause();return;}
   setPlaying(key);track('voice_played');
   setNotice({title:'Hear your AI voice',detail:'This is a voice preview, not a live seller call.'});
  }catch{catalog.current=null;if(request===previewRequest.current)setAudioError('Voice preview unavailable. Your saved voice is unchanged.');}
  finally{if(request===previewRequest.current)setPreviewLoading('');}
 }
 const theme=setupThemes[profile.theme];
 const style={'--bot-color':theme.color,'--bot-soft':theme.soft} as CSSProperties;
 if(buildPhase)return <section className="bot-setup setup-building" aria-label="Build your real estate bot"><BotBuilding profile={profile} phase={buildPhase} error={error} onRetry={()=>void save(profile)} onBack={()=>{setBuildPhase(null);setError('');requestAnimationFrame(()=>heading.current?.focus());}}/></section>;
 return <section className={`bot-setup ${step===4?'setup-complete':'setup-entry'}`} style={style} aria-label="Build your real estate bot">
  {notice&&<aside className="setup-toast" aria-label="Setup update"><Check size={20} aria-hidden="true"/><div role="status" aria-live="polite"><strong>{notice.title}</strong><p>{notice.detail}</p></div><button type="button" aria-label="Dismiss setup update" onClick={()=>setNotice(null)}><X size={18}/></button></aside>}
  {step===4&&<div className="setup-progress"><span><Check size={14}/> Setup saved</span></div>}
  <div className="setup-layout"><div className="setup-form setup-step-enter" key={step}>
   {step===0?<>
    <span className="setup-eyebrow">REAL ESTATE WHOLESALING, MADE EASY</span>
    <h1 ref={heading} tabIndex={-1}>Name your AI bot.</h1>
    <p className="setup-intro">Find sellers. Work out offers. Find cash buyers.<br/>Your AI helps you through the deal.</p>
    <form className="setup-entry-form" onSubmit={e=>{e.preventDefault();void save(profile);}}>
     <label className="setup-label" htmlFor="bot-name">Your bot’s name</label>
     <input className="setup-input" id="bot-name" autoComplete="off" maxLength={64} value={profile.displayName} onChange={e=>{nameEdited.current=true;setProfile(p=>({...p,displayName:e.target.value}));setError('');}} placeholder={nameHint} onFocus={()=>setNameFocused(true)} required disabled={busy}/>
     <button className="setup-primary" disabled={busy||!profile.displayName.trim()}>{busy?<><LoaderCircle size={18} className="setup-spin"/> Saving your setup…</>:<>Create my bot<ArrowRight size={18}/></>}</button>
    </form>
   </>:<>
    <span className="setup-eyebrow">MEET YOUR AI BOT</span>
    <h1 className="setup-ready-title" ref={heading} tabIndex={-1}>{profile.displayName} is ready.</h1>
    <p className="setup-intro">Your bot setup is saved. Choose a budget for the next step.</p>
    <div className="setup-reveal">
     <BotBrand profile={profile}/>
     <div className="setup-reveal-line"><span>{profile.market}</span><button type="button" onClick={()=>void play(profile.voice)} aria-label="Preview your selected AI voice">{previewLoading===profile.voice?<LoaderCircle className="setup-spin" size={15}/>:playing===profile.voice?<Pause size={15}/>:<Play size={15}/>} Hear your bot</button></div>
     <div className="setup-built-progress" aria-label="Your saved setup">
      <span><Check size={15}/><span><strong>{voices.find(v=>v.key===profile.voice)?.name} selected</strong><small>Your bot’s voice for conversations</small></span></span>
      <span><Check size={15}/><span><strong>{profile.marketMode==='nationwide'?'Nationwide research preference':profile.market+' selected'}</strong><small>Live work depends on supported markets and checks</small></span></span>
      {profile.contracts&&<span><Check size={15}/><span><strong>Unsigned contract previews</strong><small>Signing is limited to reviewed markets and owner counts</small></span></span>}
      {profile.buyers&&<span><Check size={15}/><span><strong>Buyer matching selected</strong><small>Find buyers after a signed seller agreement</small></span></span>}
     </div>

     {profile.contracts&&<details className="setup-details"><summary>Preview your contracts</summary><div className="setup-document-links"><a href="/api/setup/documents?kind=purchase" target="_blank" rel="noopener">Seller agreement ↗</a><a href="/api/setup/documents?kind=assignment" target="_blank" rel="noopener">Buyer agreement ↗</a></div><p>Unsigned previews, not approval for every state. Reviewed templates, all required owners and local requirements must be confirmed before signing.</p></details>}
    </div>
    {audioError&&<p className="setup-error" role="status">{audioError}</p>}
    {error&&<p role="alert" className="setup-error">{error}</p>}
    <div className="setup-funding"><FundingCheckout onSignedIn={onSignedIn}/></div>
    <details className="setup-details"><summary>How your bot works</summary><DealExplainer/><p>When live access is available, funding pays for property research, permitted seller outreach and follow-up. Identity, contact permissions and market checks must pass before your bot starts.</p><p>Agreements use your verified legal name or company, not your bot’s name. Contracts, buyers and closing coordination depend on the actual deal. No deal or earnings are guaranteed.</p></details>
   </>}
   {step===0&&error&&<div role="alert" className="setup-error">{error}{!setup&&<button className="setup-retry" disabled={loading||busy} onClick={()=>void load()}>{loading?'Reconnecting…':'Reconnect'}</button>}</div>}
  </div></div>
 </section>;
}

