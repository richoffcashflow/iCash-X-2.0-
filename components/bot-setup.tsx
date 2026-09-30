'use client';
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {ArrowRight,Check,Play,Pause,LoaderCircle,SlidersHorizontal,X} from 'lucide-react';
import {DealExplainer} from './deal-explainer';
import {BotBrand} from './bot-brand';
import {FundingCheckout} from './funding-checkout';
import {defaultBotProfile,setupThemes,setupProfileSchema,resumeSetupStage,type BotProfile,type BotSetup,type SetupVoice} from '@/lib/bot-setup';
import {launchMarketCandidates} from '@/config/launch-market-candidates';

const voices=[{key:'sarah',name:'Sarah',description:'Warm & conversational'},{key:'chris',name:'Chris',description:'Relaxed & direct'},{key:'jessica',name:'Jessica',description:'Clear & friendly'}] as const;
function track(event:string){void fetch('/api/setup/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event}),keepalive:true}).catch(()=>{});}

export function BotSetupFlow({onBrand,onSignedIn}:{onBrand:(profile:BotProfile)=>void;onSignedIn:()=>void}){
 const [setup,setSetup]=useState<BotSetup|null>(null);
 const [profile,setProfile]=useState<BotProfile>(defaultBotProfile);
 const [step,setStep]=useState(0),[editing,setEditing]=useState(false);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [audioError,setAudioError]=useState(''),[playing,setPlaying]=useState(''),[previewLoading,setPreviewLoading]=useState('');
 const nameEdited=useRef(false),audio=useRef<HTMLAudioElement|null>(null),previewRequest=useRef(0);
 const heading=useRef<HTMLHeadingElement>(null),ready=useRef(false),init=useRef<Promise<BotSetup>|null>(null);
 const [notice,setNotice]=useState<{title:string;detail:string}|null>(null);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(null),6500);return()=>clearTimeout(timer);},[notice]);
 const catalog=useRef<Promise<SetupVoice[]>|null>(null);

 async function load(){
  setLoading(true);setError('');
  try{
   // Reuse initialization across Strict Mode replays and early form submissions.
   if(!init.current)init.current=fetch('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'init'})}).then(async r=>{const d=await r.json();if(!r.ok||!d.setup)throw Error();return d.setup;});
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
  if(busy)return false;
  const parsed=setupProfileSchema.safeParse({...value,aiLogo:null});
  if(!parsed.success){setError(!value.displayName.trim()?'Enter your first name or business name.':'Check your name and city, then try again.');return false;}
  setError('');setBusy(true);
  try{
   if(!setup&&!init.current){await load();}
   const current=setup??await init.current;
   if(!current)throw Error('Could not connect. Tap Reconnect to try again.');
   const r=await fetch('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',profile:parsed.data,stage:4,revision:current.revision})});
   const d=await r.json();if(!r.ok||!d.setup)throw Error(d.error??'Could not save. Please retry.');
   setSetup(d.setup);setProfile({...defaultBotProfile,...d.setup.profile,aiLogo:null});setStep(4);setEditing(false);
   setNotice({title:"Your bot setup is saved",detail:`${d.setup.profile.displayName} · ${d.setup.profile.market}. Outreach hasn’t started.`});
   return true;
  }catch(e){setError(e instanceof Error?e.message:'Could not save. Please retry.');return false;}
  finally{setBusy(false);}
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
 function toggleEditing(){
  previewRequest.current++;audio.current?.pause();setPlaying('');setPreviewLoading('');setAudioError('');setError('');setEditing(v=>!v);
 }
 const theme=setupThemes[profile.theme];
 const style={'--bot-color':theme.color,'--bot-soft':theme.soft} as CSSProperties;
 return <section className={`bot-setup ${step===4?'setup-complete':'setup-entry'}`} style={style} aria-label="Build your real estate bot">
  {notice&&<aside className="setup-toast" aria-label="Setup update"><Check size={20} aria-hidden="true"/><div role="status" aria-live="polite"><strong>{notice.title}</strong><p>{notice.detail}</p></div><button type="button" aria-label="Dismiss setup update" onClick={()=>setNotice(null)}><X size={18}/></button></aside>}
  {step===4&&<div className="setup-progress"><span><Check size={14}/> Setup saved</span><button type="button" disabled={busy} aria-expanded={editing} aria-controls="setup-preferences" onClick={toggleEditing}><SlidersHorizontal size={14}/>{editing?'Close':'Customize'}</button></div>}
  <div className="setup-layout"><div className="setup-form setup-step-enter" key={step}>
   {step===0?<>
    <span className="setup-eyebrow">REAL ESTATE WHOLESALING, MADE EASY</span>
    <h1 ref={heading} tabIndex={-1}>Your own AI bot.<br/>Built for real estate.</h1>
    <p className="setup-intro">Find sellers. Work out offers. Find cash buyers.<br/>Your AI helps you through the deal.</p>
    <form className="setup-entry-form" onSubmit={e=>{e.preventDefault();void save(profile);}}>
     <label className="setup-label" htmlFor="bot-name">Your name or business name</label>
     <input className="setup-input" id="bot-name" autoComplete="organization" maxLength={64} value={profile.displayName} onChange={e=>{nameEdited.current=true;setProfile(p=>({...p,displayName:e.target.value}));setError('');}} placeholder="e.g. Jordan or Oak Street Properties" required disabled={busy}/>
     <button className="setup-primary" disabled={busy||!profile.displayName.trim()}>{busy?<><LoaderCircle size={18} className="setup-spin"/> Saving your setup…</>:<>Build my free bot<ArrowRight size={18}/></>}</button>
    </form>
   </>:<>
    <span className="setup-eyebrow">MADE FOR {profile.displayName.toUpperCase()}</span>
    <h1 ref={heading} tabIndex={-1}>Your bot setup is ready.</h1>
    <p className="setup-intro">Set up for you. Outreach hasn’t started.</p>
    {editing&&<BotPreferences profile={profile} busy={busy} playing={playing} previewLoading={previewLoading} onPlay={play} onSave={save} onCancel={toggleEditing}/>}
    <div className="setup-reveal">
     <BotBrand profile={profile}/>
     <div className="setup-reveal-line"><span>{profile.market}</span><button type="button" onClick={()=>void play(profile.voice)} aria-label="Preview your selected AI voice">{previewLoading===profile.voice?<LoaderCircle className="setup-spin" size={15}/>:playing===profile.voice?<Pause size={15}/>:<Play size={15}/>} Hear your bot</button></div>
     <div className="setup-built-progress" aria-label="Your saved setup">
      <span><Check size={15}/><span><strong>{voices.find(v=>v.key===profile.voice)?.name} selected</strong><small>Your bot’s voice for conversations</small></span></span>
      <span><Check size={15}/><span><strong>{profile.marketMode==='nationwide'?'Nationwide search selected':profile.market+' selected'}</strong><small>Your saved search preference</small></span></span>
      {profile.contracts&&<span><Check size={15}/><span><strong>Contract templates included</strong><small>Preview them below with your name</small></span></span>}
      {profile.buyers&&<span><Check size={15}/><span><strong>Buyer matching selected</strong><small>Find buyers after a signed seller agreement</small></span></span>}
     </div>

     {profile.contracts&&<details className="setup-details"><summary>Preview your contracts</summary><div className="setup-document-links"><a href="/api/setup/documents?kind=purchase" target="_blank" rel="noopener">Seller agreement ↗</a><a href="/api/setup/documents?kind=assignment" target="_blank" rel="noopener">Buyer agreement ↗</a></div><p>Unsigned templates. Deal details and required local terms come before signing.</p></details>}
    </div>
    {audioError&&<p className="setup-error" role="status">{audioError}</p>}
    {error&&<p role="alert" className="setup-error">{error}</p>}
    <div className="setup-funding"><FundingCheckout onSignedIn={onSignedIn}/></div>
    <details className="setup-details"><summary>How your bot works</summary><DealExplainer/><p>When live access is available, funding pays for property research, permitted seller outreach and follow-up. Identity, contact permissions and market checks must pass before your bot starts.</p><p>Agreements use your verified legal name or company, not just the display name above. Contracts, buyers and closing coordination depend on the actual deal. No deal or earnings are guaranteed.</p></details>
   </>}
   {step===0&&error&&<div role="alert" className="setup-error">{error}{!setup&&<button className="setup-retry" disabled={loading||busy} onClick={()=>void load()}>{loading?'Reconnecting…':'Reconnect'}</button>}</div>}
  </div></div>
 </section>;
}

function BotPreferences({profile,busy,playing,previewLoading,onPlay,onSave,onCancel}:{profile:BotProfile;busy:boolean;playing:string;previewLoading:string;onPlay:(key:BotProfile['voice'])=>Promise<void>;onSave:(profile:BotProfile)=>Promise<boolean>;onCancel:()=>void}){
 const [draft,setDraft]=useState(profile);
 function change<K extends keyof BotProfile>(key:K,value:BotProfile[K]){setDraft(p=>({...p,[key]:value}));}
 return <form id="setup-preferences" className="setup-preferences" onSubmit={e=>{e.preventDefault();void onSave(draft);}}>
  <h2>Make it yours</h2><p className="setup-hint">Everything is preset. Change only what you want.</p>
  <fieldset disabled={busy} className="setup-preferences-fields">
   <label className="setup-label" htmlFor="edit-bot-name">Name</label><input className="setup-input" id="edit-bot-name" maxLength={64} value={draft.displayName} onChange={e=>change('displayName',e.target.value)} required/>
   <label className="setup-label" htmlFor="edit-bot-market">Where to find deals</label><select className="setup-input" id="edit-bot-market" value={draft.marketMode} onChange={e=>{const city=e.target.value==='city';setDraft(p=>({...p,marketMode:city?'city':'nationwide',market:city?'':'Nationwide'}));}}><option value="nationwide">Nationwide · let the bot choose</option><option value="city">Choose a city</option></select>
   {draft.marketMode==='city'&&<><label className="setup-label" htmlFor="edit-bot-city">City and state</label><input className="setup-input" id="edit-bot-city" list="setup-cities" placeholder="e.g. Houston, TX" value={draft.market} onChange={e=>change('market',e.target.value)} minLength={2} maxLength={80} required/><datalist id="setup-cities">{launchMarketCandidates.map(m=><option key={m.id} value={`${m.name}, ${m.states.join('-')}`}/>)}</datalist></>}
   <label className="setup-label" htmlFor="edit-bot-voice">AI voice</label><div className="setup-preference-voice"><select className="setup-input" id="edit-bot-voice" value={draft.voice} onChange={e=>change('voice',e.target.value as BotProfile['voice'])}>{voices.map(v=><option key={v.key} value={v.key}>{v.name} · {v.description}</option>)}</select><button type="button" className="setup-preview-button" aria-label={`Preview ${draft.voice}`} onClick={()=>void onPlay(draft.voice)}>{previewLoading===draft.voice?<LoaderCircle size={18} className="setup-spin"/>:playing===draft.voice?<Pause size={18}/>:<Play size={18}/>}</button></div>
   <fieldset className="setup-fieldset setup-preset-colors"><legend>Color</legend><div className="setup-colors">{Object.entries(setupThemes).map(([key,t])=><button type="button" key={key} aria-label={t.name} aria-pressed={draft.theme===key} onClick={()=>change('theme',key as BotProfile['theme'])}><span style={{background:t.color}}>{draft.theme===key&&<Check size={18}/>}</span><small>{t.name}</small></button>)}</div></fieldset>
   <details className="setup-details setup-preference-extras"><summary>Included tools</summary><label><input type="checkbox" checked={draft.contracts} onChange={e=>change('contracts',e.target.checked)}/> Contract templates</label><label><input type="checkbox" checked={draft.buyers} onChange={e=>change('buyers',e.target.checked)}/> Cash-buyer matching</label></details>
   <div className="setup-preference-actions"><button type="button" className="setup-cancel" onClick={onCancel}>Cancel</button><button className="setup-primary" disabled={busy}>{busy?'Saving…':'Save changes'}</button></div>
  </fieldset>
 </form>;
}
