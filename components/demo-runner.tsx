"use client";
import {useEffect,useState} from 'react';
import {Pause,Play} from 'lucide-react';
import {DEMO_PROPERTY} from '@/lib/demo-property';
import {PropertyMedia} from './property-media';
import {DealProgressCard} from './deal-progress-card';
import {ActivityFeed,type ActivityItem} from './activity-feed';
import {readDemoProgress,saveDemoProgress} from '@/lib/demo-progress';
const steps:ActivityItem[]=[
 {id:'property',stage:'Property',emoji:'🏠',title:'Your bot found a property',detail:'It checks the value and repairs before talking about a price. This is a fictional test property.'},
 {id:'contract',stage:'Contract',emoji:'📝',title:'Under contract for $115,000',detail:'In this test, the owners signed at a price below the estimated $220,000 repaired value. Repairs, fees, and other costs still matter.'},
 {id:'buyer',stage:'Buyer',emoji:'🙋',title:'Your bot found a buyer',detail:'The test buyer offers $135,000. That leaves a $20,000 difference before costs and taxes.'},
 {id:'approval',stage:'Review',emoji:'✋',title:'Simulated customer review',detail:'For this fictional walkthrough, customer approval is assumed so you can see closing. No real contract is approved or signed.'},
 {id:'closed',stage:'Complete',emoji:'🎉',title:'You closed your first test deal!',detail:'In this test, the closing company completed the paperwork and funding. No real sale or payment occurred.'}
];
const delays=[5000,5000,5000,5000];
export function DemoRunner({scope,botName,practiceBudgetCents}:{scope:string;botName:string;practiceBudgetCents:number}){
 const [count,setCount]=useState(1),[restored,setRestored]=useState(false),[paused,setPaused]=useState(false),[visible,setVisible]=useState(true);
 const complete=count===5,approved=count>=4;
 const running=restored&&!paused&&visible&&!complete;
 useEffect(()=>{const saved=readDemoProgress(scope);if(saved){setCount(saved.count);}setRestored(true);const update=()=>setVisible(!document.hidden);update();document.addEventListener('visibilitychange',update);return()=>document.removeEventListener('visibilitychange',update);},[]);
 useEffect(()=>{if(restored)saveDemoProgress(scope,count,approved);},[count,approved,restored,scope]);
 useEffect(()=>{if(!running)return;const timer=setTimeout(()=>setCount(c=>Math.min(c+1,5)),delays[count-1]);return()=>clearTimeout(timer);},[running,count]);
 return <div className="demo-stream" aria-label="Fictional deal simulation">
  <p className="test-mode-note"><strong>{botName} · Simulation</strong> · ${(practiceBudgetCents/100).toLocaleString()} practice budget. Illustrative only; the budget does not predict results.</p>
  <div className="stream-status"><span className={running?'stream-dot moving':'stream-dot'}/><strong>{complete?'Simulation complete':running?'Running simulation':'Simulation paused'}</strong><span>{complete?'Finished':'About 20 seconds'}</span></div>
  <div className="test-progress" role="progressbar" aria-label="Simulation progress" aria-valuemin={0} aria-valuemax={4} aria-valuenow={count-1} aria-valuetext={`Step ${count} of 5: ${steps[count-1].stage}`}>{steps.slice(1).map((s,i)=><span key={s.id} data-done={count>i+1}/>)}</div>
  <p className="test-mode-note">Simulation only · No real charges, calls, contracts, or earnings.</p>
  <div className={`stream-current ${complete?'test-celebration':''}`} aria-live="polite" aria-atomic="true"><h3><span className="current-emoji" aria-hidden="true">{steps[count-1].emoji}</span>{steps[count-1].title}</h3><p>{steps[count-1].detail}</p>{complete&&<div className="test-result"><strong>$20,000</strong><span>Test difference · Before costs and taxes</span></div>}</div>

  {!complete&&<div className="stream-controls"><button className="demo-button" onClick={()=>setPaused(p=>!p)}>{paused?<Play size={17}/>:<Pause size={17}/>} {paused?'Resume simulation':'Pause simulation'}</button></div>}
  {complete&&<div className="sample-funding"><p><strong>Simulation complete. Your saved bot is ready for the next step.</strong></p><small>Real work needs funding and required checks. No deal or earnings are guaranteed.</small></div>}
  {count===1?<details className="property-focus" onToggle={e=>{if(e.currentTarget.open)setPaused(true);}}><summary><span className="focus-house" aria-hidden="true">🏠</span><span><strong>{DEMO_PROPERTY.address}</strong><small>Property found · test</small></span><span className="focus-open">Details</span></summary><div className="focus-details"><PropertyMedia photo={DEMO_PROPERTY.photo}/><p>{DEMO_PROPERTY.location}</p><p>Estimated repaired value: $220,000 · Repairs: $25,000 · Test figures only.</p></div></details>:<DealProgressCard onInspect={()=>{if(!complete)setPaused(true);}} snapshot={{sellerSigned:true,marketingAuthorized:true,buyerSigned:approved,depositConfirmedByEscrow:complete,titleOpened:approved,closingScheduled:complete,closedByTitle:complete,proceedsConfirmed:false,failed:false,buyerWithdrew:false,titleIssue:false,deadlineAt:null}}/>}
  <ActivityFeed events={steps.slice(0,count)} mode="demo" onInspect={()=>{if(!complete)setPaused(true);}}/>
 </div>;
}
