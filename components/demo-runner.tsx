"use client";

import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { ActivityFeed, type ActivityItem } from "./activity-feed";

const steps: ActivityItem[] = [
  { id:"search", stage:"Research", title:"Searching for opportunities", detail:"Looking across sample houses and land." },
  { id:"rank", stage:"Research", title:"Property worth a closer look", detail:"Checking equity, condition, and local buyer demand." },
  { id:"owner", stage:"Owner", title:"Owner information checked", detail:"The sample property has two owners. Both need to agree." },
  { id:"permission", stage:"Contact", title:"Contact checks passed in the example", detail:"Sample permission, calling window, and spending limit checked." },
  { id:"call", stage:"Conversation", title:"Calling the sample seller", detail:"No real call is being placed." },
  { id:"answer", stage:"Conversation", title:"Sample seller answered", detail:"“I may sell. The kitchen needs work.”" },
  { id:"interest", stage:"Qualification", title:"Seller interested", detail:"Discussing timing and confirming the second owner is on board." },
  { id:"analysis", stage:"Analysis", title:"Reviewing an offer", detail:"Sample repair estimate: $25,000. Estimates still need verification." },
  { id:"offer", stage:"Offer", title:"Offer being discussed", detail:"The example offer stays within the approved $119,000 limit." },
  { id:"contract", stage:"Contract", title:"Sample contract signed", detail:"Fictional purchase price: $115,000. Required checks are assumed complete in this example." },
  { id:"buyers", stage:"Buyer", title:"Matching sample cash buyers", detail:"Looking for a buyer whose budget and property preferences fit." },
  { id:"buyer", stage:"Buyer", title:"Sample buyer interested", detail:"Fictional buyer price: $135,000. Confirming terms with title." },
  { id:"title", stage:"Closing", title:"Sample closing coordinated", detail:"Title handles the agreed escrow deposit and closing requirements." },
  { id:"closed", stage:"Complete", title:"Fictional deal closed", detail:"$20,000 difference before costs and taxes. No real earnings or payout." },
];

export function DemoRunner() {
  const [count, setCount] = useState(1);
  const [paused, setPaused] = useState(false);
  const [run, setRun] = useState(0);
  const [visible, setVisible] = useState(true);
  const complete = count === steps.length;
  const running = !paused && visible && !complete;
  useEffect(()=>{
    const update = ()=>setVisible(!document.hidden);
    update(); document.addEventListener("visibilitychange",update);
    return ()=>document.removeEventListener("visibilitychange",update);
  },[]);
  useEffect(()=>{
    if (!running) return;
    const timer = window.setTimeout(()=>setCount(value=>Math.min(value+1,steps.length)),4200);
    return ()=>window.clearTimeout(timer);
  },[count,running,run]);
  function restart() { setCount(1); setPaused(false); setRun(value=>value+1); }
  return <div className="demo-stream">
    <div className="stream-status"><span className={running ? "stream-dot moving" : "stream-dot"}/><strong>{complete ? "EXAMPLE COMPLETE" : running ? "DEMO RUNNING" : "DEMO PAUSED"}</strong><span>{count}/{steps.length}</span></div>
    <div className="stream-current" aria-live="polite" aria-atomic="true"><h3>{steps[count-1].title}</h3><p>{complete ? "Real deals take longer and may not close." : "Watch the example unfold below."}</p></div>
    <div className="stream-controls">{!complete && <button className="demo-button" onClick={()=>setPaused(value=>!value)}>{paused ? <Play size={17}/> : <Pause size={17}/>}{paused ? "Resume example" : "Pause example"}</button>}<button className={complete ? "demo-button" : "stream-restart"} onClick={restart} aria-label="Restart example"><RotateCcw size={17}/>{complete && "Run again"}</button></div>
    <ActivityFeed events={steps.slice(0,count)} mode="demo"/>
    <p className="stream-note">Fictional demo · Time compressed · No calls, charges, or payouts. Live activity only updates when real work happens.</p>
  </div>;
}
