"use client";
import {useEffect,useState} from 'react';
import {ArrowRight,Check,Pause,Play,RotateCcw} from 'lucide-react';
import {DEMO_PROPERTY} from '@/lib/demo-property';
import {readDemoProgress,saveDemoProgress} from '@/lib/demo-progress';
import {PropertyMedia} from './property-media';
const stages=[{title:'Find a house',detail:'Start with a property that may be worth a closer look.'},{title:'Check the numbers',detail:'Compare the estimated value, repairs, and an offer limit.'},{title:'Know the next step',detail:'Ask the owner whether they want to sell. A property record cannot tell us that.'}];
export function DemoRunner({onFund,fundingOpen=false}:{onFund:()=>void;fundingOpen?:boolean}){
 const [step,setStep]=useState(0),[ready,setReady]=useState(false),[paused,setPaused]=useState(false),[visible,setVisible]=useState(true);
 useEffect(()=>{const saved=readDemoProgress();if(saved)setStep(Math.min(2,saved.count-1));setReady(true);const update=()=>setVisible(!document.hidden);update();document.addEventListener('visibilitychange',update);return()=>document.removeEventListener('visibilitychange',update);},[]);
 useEffect(()=>{if(ready)saveDemoProgress(step+1,false);},[ready,step]);
 useEffect(()=>{if(!ready||paused||!visible||step===2)return;const timer=setTimeout(()=>setStep(s=>Math.min(2,s+1)),step===0?2400:4200);return()=>clearTimeout(timer);},[ready,paused,visible,step]);
 return <div className="simple-result">
  <div className="result-heading"><div><span className="entry-kicker">YOUR FREE WALKTHROUGH</span><h1>See what your bot does.</h1></div><span className="sample-pill">Sample</span></div>
  <article className="result-property"><PropertyMedia photo={DEMO_PROPERTY.photo}/><div className="result-body"><span className="property-location">{DEMO_PROPERTY.location}</span><h2>{DEMO_PROPERTY.address}</h2><p className="property-description">3 beds · 2 baths · Sample property</p>
   <ol className="simple-steps">{stages.map((stage,i)=><li key={stage.title} data-active={i===step} data-done={i<step}><span className="step-marker">{i<step?<Check size={15}/>:i+1}</span><div><strong>{stage.title}</strong>{i===step&&<p role="status">{stage.detail}</p>}</div></li>)}</ol>
   {step>=1&&<dl className="simple-numbers"><div><dt>Value after repairs</dt><dd>$220,000</dd></div><div><dt>Estimated repairs</dt><dd>$25,000</dd></div><div><dt>Example offer limit</dt><dd>$119,000</dd></div></dl>}
   {step===2&&<div className="next-action"><strong>Next: talk to the owner.</strong><p>This shows the process. No real owner has been contacted.</p>{!fundingOpen&&<button className="fund-button full" onClick={onFund}>See how funding works <ArrowRight size={18}/></button>}</div>}
  </div></article>
  <div className="result-bottom"><small>Fictional property and numbers. No calls or charges.</small>{step<2?<button aria-label={paused?'Resume walkthrough':'Pause walkthrough'} onClick={()=>setPaused(p=>!p)}>{paused?<Play size={16}/>:<Pause size={16}/>}</button>:<button aria-label="Replay walkthrough" onClick={()=>{setStep(0);setPaused(false);}}><RotateCcw size={16}/></button>}</div>
  <details className="plain-explainer"><summary>What happens after the seller says yes?</summary><p>Agree on a price → sign a purchase agreement → find a buyer → work with the closing company. You earn a fee only if the transaction closes on the agreed terms. Your bot may need your approval along the way.</p></details>
 </div>;
}
