'use client';
import {useEffect,useState} from 'react';
import {DEMO_PROPERTY} from '@/lib/demo-property';
import {sampleInputs,sampleOffer,restoreSampleInputs} from '@/lib/free-sample';
const storageKey='icash-free-sample-calculator-v1';
const dollars=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(cents/100);
export function FreeSampleWorkspace({onContinue,botName='Your bot'}:{onContinue:()=>void;botName?:string}){
 const [inputs,setInputs]=useState(sampleInputs),[loaded,setLoaded]=useState(false);
 useEffect(()=>{try{const saved=restoreSampleInputs(JSON.parse(localStorage.getItem(storageKey)??'null'));if(saved)setInputs(saved);}catch{}setLoaded(true);},[]);
 useEffect(()=>{if(loaded)try{localStorage.setItem(storageKey,JSON.stringify(inputs));}catch{}},[inputs,loaded]);
 const offer=sampleOffer(inputs);
 return <section className="free-sample" aria-label="Free fictional deal workspace">
  <div className="free-sample-heading"><span className="free-sample-badge">FREE EXAMPLE</span><h2>Try a deal before you pay.</h2><p>Change the numbers. See how an offer is worked out.</p></div>
  <div className="free-sample-property"><strong>{DEMO_PROPERTY.address}</strong><span>{DEMO_PROPERTY.location}</span><small>Sample figures only. This is not a real listing or seller.</small></div>
  <div className="sample-calculator"><h3>Work out a practice offer</h3><div className="sample-inputs">{([['value','Value after repairs ($)'],['repairs','Repairs ($)'],['fee','Your fee goal ($)']] as const).map(([key,label])=><label key={key}>{label}<input type="number" inputMode="decimal" min={key==='value'?1:0} max={100000000} step="0.01" value={inputs[key]} onChange={event=>setInputs(current=>({...current,[key]:event.target.value}))}/></label>)}</div>
   <div className="sample-offer-result" role="status" aria-live="polite">{offer?.hasRoom?<><span>Practice offer cap</span><strong>{dollars(offer.sellerCapCents)}</strong><small>70% of repaired value, minus repairs and your fee goal</small></>:<p>{offer?'These numbers leave no room for a positive offer. Try lower repairs or a smaller fee goal.':'Enter a value above $0, repairs and a fee goal to see the math.'}</p>}</div>
   <p className="sample-caveat">This is a rough learning tool, not a property valuation. Real offers need verified repairs, buyer demand and other costs. A fee goal is not promised income.</p>
   <button className="sample-reset" type="button" onClick={()=>setInputs(sampleInputs)}>Reset example numbers</button>
  </div>
  <details className="sample-conversation"><summary>Preview a seller conversation</summary><p className="sample-caveat">Written example only. No call is made and no message is sent.</p><div className="sample-message sample-ai"><small>{botName} · sample AI</small><p>Hi, I’m an AI assistant. Is now a good time to ask a few questions about the property?</p></div><div className="sample-message sample-seller"><small>Fictional seller</small><p>I may be open to selling, but I’m still deciding.</p></div><div className="sample-message sample-ai"><small>{botName} · sample AI</small><p>What repairs does it need, and when would you want to move? There’s no offer or agreement yet.</p></div></details>
  <div className="sample-next"><button type="button" className="setup-primary" onClick={onContinue}>Run this for real</button><p>Real work uses paid credits and needs approved setup. Review availability and daily billing before paying. This example stays free.</p></div>
 </section>;
}
