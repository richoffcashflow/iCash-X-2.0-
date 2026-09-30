'use client';
import {useEffect,useRef} from 'react';
import {ArrowLeft,Check,RotateCcw} from 'lucide-react';
import {botInitials,type BotProfile} from '@/lib/bot-setup';

export type BotBuildPhase='saving'|'saved'|'error';
export function BotBuilding({profile,phase,error,onRetry,onBack}:{profile:BotProfile;phase:BotBuildPhase;error:string;onRetry:()=>void;onBack:()=>void}){
 const heading=useRef<HTMLHeadingElement>(null);
 const failed=phase==='error';
 useEffect(()=>{heading.current?.focus();},[failed]);
 return <div className="bot-building" data-phase={phase}>
  <div className="bot-building-art" aria-hidden="true">
   <span className="bot-building-orbit"/>
   <span className="bot-building-orbit bot-building-orbit-inner"/>
   <div className="bot-building-mark">{phase==='saved'?<Check size={38} strokeWidth={1.8}/>:botInitials(profile.displayName)}</div>
   <span className="bot-building-spark"/>
  </div>
  <span className="bot-building-eyebrow">MADE FOR YOU</span>
  <h1 ref={heading} tabIndex={-1}>{failed?'Let’s try that again.':'Creating your bot…'}</h1>
  <p className="bot-building-description">{failed?'Your choices are still here.':`Getting ${profile.displayName} ready for you.`}</p>
  {failed?<div className="bot-building-recovery">
   <p role="alert">{error}</p>
   <button type="button" className="setup-primary" onClick={onRetry}><RotateCcw size={17}/>Try again</button>
   <button type="button" className="bot-building-back" onClick={onBack}><ArrowLeft size={16}/>Back to setup</button>
  </div>:<div className="bot-building-status" role="status" aria-live="polite" aria-atomic="true">
   {phase==='saved'?<Check size={16}/>:<span className="bot-building-dot"/>}
   <span>{phase==='saved'?'Your setup is saved. Opening the next step…':'Saving your bot’s name and preferences…'}</span>
  </div>}
  <p className="bot-building-note">Just setup for now. No charges or outreach.</p>
 </div>;
}
