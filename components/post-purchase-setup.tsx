'use client';
import {useEffect,useRef,useState} from 'react';
import {Check,ArrowRight} from 'lucide-react';
import {AccountAccess} from './account-access';
import {BotBuilding,type BotBuildPhase} from './bot-building';
import {saveBotBuild,waitForBotCreationTransition} from '@/lib/bot-build';
import {defaultBotProfile,setupProfileSchema,type BotProfile,type BotSetup} from '@/lib/bot-setup';

/** Rendered only after the billing endpoint confirms accessible software access. */
export function PostPurchaseSetup({email,customerName,needsClaim,onWorkspace}:{email:string;customerName:string;needsClaim:boolean;onWorkspace:()=>void}){
 const [setup,setSetup]=useState<BotSetup|null>(null),[name,setName]=useState(''),[phase,setPhase]=useState<BotBuildPhase|null>(null),[created,setCreated]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const mounted=useRef(true),inFlight=useRef(false),retry=useRef(false),edited=useRef(false),controller=useRef<AbortController|null>(null);
 async function load(){setLoading(true);setError('');try{const r=await fetch('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'init'}),signal:AbortSignal.timeout(20000)});const data=await r.json();if(!r.ok||!data.setup)throw Error('Could not restore your setup. Your payment is saved.');if(!mounted.current)return;setSetup(data.setup);if(!edited.current)setName(data.setup.profile.displayName||((customerName?customerName+"’s bot":'My iCash bot').slice(0,64)));setCreated(data.setup.stage>0&&!!data.setup.profile.displayName);}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Could not load your saved setup.');}finally{if(mounted.current)setLoading(false);}}
 useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;controller.current?.abort();};},[]);
 const profile:BotProfile={...defaultBotProfile,...setup?.profile,displayName:name.trim(),aiLogo:null};
 async function create(){
  if(inFlight.current||loading||!setup)return;
  const parsed=setupProfileSchema.safeParse(profile);if(!parsed.success){setError('Choose a bot name using 1–64 characters.');return;}
  inFlight.current=true;setError('');setPhase('saving');const started=Date.now(),abort=new AbortController();controller.current=abort;const timeout=setTimeout(()=>abort.abort(),20000);
  try{const saved=await saveBotBuild(parsed.data,setup,{retry:retry.current,editedFields:['displayName'],signal:abort.signal});if(!mounted.current||abort.signal.aborted)return;setSetup(saved);setPhase('saved');await waitForBotCreationTransition(started,abort.signal,matchMedia('(prefers-reduced-motion: reduce)').matches);if(!mounted.current||abort.signal.aborted)return;retry.current=false;setCreated(true);setPhase(null);if(!needsClaim)onWorkspace();}
  catch(e){if(mounted.current){retry.current=true;setError(abort.signal.aborted?'Connection interrupted. Retry to restore your saved bot.':e instanceof Error?e.message:'Could not save your bot.');setPhase('error');}}
  finally{clearTimeout(timeout);inFlight.current=false;}
 }
 return <section className="purchase-setup" aria-label="Set up your purchased workspace"><p className="purchase-receipt"><Check size={16}/>Software payment confirmed</p><ol className="purchase-steps" aria-label="Your setup progress"><li aria-current={!created&&!phase?'step':undefined}>1 · Name your bot</li><li aria-current={phase?'step':undefined}>2 · Create</li><li aria-current={created?'step':undefined}>3 · Workspace</li></ol>
 {phase?<BotBuilding profile={profile} phase={phase} error={error} paid onRetry={()=>void create()} onBack={()=>{setPhase(null);setError('');}}/>:created?<><h2>{name} is ready.</h2><p>Your bot’s name and preferences are saved.</p>{needsClaim?<><p>Verify your payment email once to enter your workspace.</p><AccountAccess initialEmail={email} onSignedIn={onWorkspace}/></>:<button className="setup-primary" onClick={onWorkspace}>Enter my workspace<ArrowRight size={17}/></button>}<button className="membership-embedded-back" onClick={()=>setCreated(false)}>Edit bot name</button></>:<><h2>Make it yours.</h2><p>Name your bot, then step into your workspace.</p><form onSubmit={e=>{e.preventDefault();void create();}}><label className="setup-label" htmlFor="purchase-bot-name">Your bot’s name</label><input className="setup-input" id="purchase-bot-name" required autoComplete="off" maxLength={64} value={name} disabled={loading} onChange={e=>{edited.current=true;setName(e.target.value);}} placeholder="My iCash bot"/><button className="setup-primary" disabled={loading||!setup||!name.trim()}>{loading?'Restoring your details…':'Create my bot'}<ArrowRight size={17}/></button></form>{email&&<p className="purchase-email">Your payment and email are saved: {email}</p>}</>}
 {error&&!phase&&<p role="alert">{error} {!setup&&<button onClick={()=>void load()} disabled={loading}>Reconnect</button>}</p>}</section>;
}
