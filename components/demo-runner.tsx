"use client";
import {useEffect,useState} from 'react';
import {Pause,Play,ArrowRight,Check} from 'lucide-react';
import {DEMO_PROPERTY} from '@/lib/demo-property';
import {PropertyMedia} from './property-media';
import {DealProgressCard} from './deal-progress-card';
import {ActivityFeed,type ActivityItem} from './activity-feed';
import {readDemoProgress,saveDemoProgress} from '@/lib/demo-progress';
const steps:ActivityItem[]=[
 {id:'property',stage:'Property',emoji:'🏠',title:'Your bot found a property',detail:'It checks the value and repairs before talking about a price. This is a fictional test property.'},
 {id:'contract',stage:'Contract',emoji:'📝',title:'Under contract for $115,000',detail:'In this test, the owners signed at a price below the estimated $220,000 repaired value. Repairs, fees, and other costs still matter.'},
 {id:'buyer',stage:'Buyer',emoji:'🙋',title:'Your bot found a buyer',detail:'The test buyer offers $135,000. That leaves a $20,000 difference before costs and taxes.'},
 {id:'approval',stage:'Review',emoji:'✋',title:'Review your test deal',detail:'Check the seller price and buyer price, then approve this fictional deal to continue.'},
 {id:'closed',stage:'Complete',emoji:'🎉',title:'You closed your first test deal!',detail:'In this test, the closing company completed the paperwork and funding. No real sale or payment occurred.'}
];
const delays=[5000,5000,5000,5000];
export function DemoRunner({onFund}:{onFund:()=>void}){
 const [count,setCount]=useState(1),[restored,setRestored]=useState(false),[approved,setApproved]=useState(false),[paused,setPaused]=useState(false),[visible,setVisible]=useState(true);
 const complete=count===5,needsYou=count===4&&!approved;
 const running=restored&&!paused&&visible&&!complete&&!needsYou;
 useEffect(()=>{const saved=readDemoProgress();if(saved){setCount(saved.count);setApproved(saved.limitConfirmed);}setRestored(true);const update=()=>setVisible(!document.hidden);update();document.addEventListener('visibilitychange',update);return()=>document.removeEventListener('visibilitychange',update);},[]);
 useEffect(()=>{if(restored)saveDemoProgress(count,approved);},[count,approved,restored]);
 useEffect(()=>{if(!running)return;const timer=setTimeout(()=>setCount(c=>Math.min(c+1,5)),delays[count-1]);return()=>clearTimeout(timer);},[running,count]);
 return <div className="demo-stream">
  <div className="stream-status"><span className={running?'stream-dot moving':'stream-dot'}/><strong>{complete?'Test complete':needsYou?'Your approval':running?'Working · test':'Paused · test'}</strong><span>{complete?'Finished':needsYou?'1 quick decision':'About 20 seconds'}</span></div>
  <div className="test-progress" role="progressbar" aria-label="Test deal progress" aria-valuemin={0} aria-valuemax={4} aria-valuenow={count-1} aria-valuetext={`Step ${count} of 5: ${steps[count-1].stage}`}>{steps.slice(1).map((s,i)=><span key={s.id} data-done={count>i+1}/>)}</div>
  <p className="test-mode-note">Fictional test · No real calls or earnings.</p>
  {!needsYou&&<div className={`stream-current ${complete?'test-celebration':''}`} aria-live="polite" aria-atomic="true"><h3><span className="current-emoji" aria-hidden="true">{approved&&count===4?'🏢':steps[count-1].emoji}</span>{approved&&count===4?'Your bot is coordinating closing':steps[count-1].title}</h3><p>{approved&&count===4?'The test skips ahead through title checks, signed papers, and confirmed funds. Real closings take longer.':steps[count-1].detail}</p>{complete&&<div className="test-result"><strong>$20,000</strong><span>Test difference · Before costs and taxes</span></div>}</div>}
  {needsYou&&<div className="needs-you-card"><span>APPROVE THE TEST DEAL</span><h3>Your buyer is ready.</h3><dl className="test-deal-numbers"><div><dt>Seller price</dt><dd>$115,000</dd></div><div><dt>Buyer price</dt><dd>$135,000</dd></div><div><dt>Difference before costs</dt><dd>$20,000</dd></div></dl><button className="fund-button full" onClick={()=>{setApproved(true);setPaused(false);}}>Approve test deal <Check size={17}/></button><small>This only continues the test. It does not sign a contract.</small></div>}
  {!complete&&!needsYou&&<div className="stream-controls"><button className="demo-button" onClick={()=>setPaused(p=>!p)}>{paused?<Play size={17}/>:<Pause size={17}/>} {paused?'Resume test':'Pause test'}</button></div>}
  {complete&&<div className="sample-funding"><p><strong>Now you’ve seen the steps. Ready to put your bot to work?</strong></p><button className="fund-button full" onClick={onFund}>Fund my AI bot <ArrowRight size={18}/></button><small>Real payments are not open yet. Real deals and earnings are not guaranteed.</small></div>}
  {count===1?<details className="property-focus" onToggle={e=>{if(e.currentTarget.open)setPaused(true);}}><summary><span className="focus-house" aria-hidden="true">🏠</span><span><strong>{DEMO_PROPERTY.address}</strong><small>Property found · test</small></span><span className="focus-open">Details</span></summary><div className="focus-details"><PropertyMedia photo={DEMO_PROPERTY.photo}/><p>{DEMO_PROPERTY.location}</p><p>Estimated repaired value: $220,000 · Repairs: $25,000 · Test figures only.</p></div></details>:<DealProgressCard onInspect={()=>{if(!complete)setPaused(true);}} snapshot={{sellerSigned:true,marketingAuthorized:true,buyerSigned:approved,depositConfirmedByEscrow:complete,titleOpened:approved,closingScheduled:complete,closedByTitle:complete,proceedsConfirmed:false,failed:false,buyerWithdrew:false,titleIssue:false,deadlineAt:null}}/>}
  <ActivityFeed events={steps.slice(0,count)} mode="demo" onInspect={()=>{if(!complete)setPaused(true);}}/>
 </div>;
}
