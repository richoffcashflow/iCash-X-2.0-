"use client";

import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw, ArrowRight, House, Check } from "lucide-react";
import { ActivityFeed, type ActivityItem } from "./activity-feed";
import { conversionOffer } from "@/lib/conversion-engine";
import { readDemoProgress, saveDemoProgress } from "@/lib/demo-progress";
import { previewCreditPacks } from "@/config/credit-packs";

const steps: ActivityItem[] = [
  { id:"search", stage:"Research", title:"Searching for opportunities", detail:"Looking across sample houses and land." },
  { id:"rank", stage:"Research", title:"Promising property found", detail:"Checking equity, condition, and local buyer demand." },
  { id:"owner", stage:"Owner", title:"Owner information checked", detail:"The sample property has two owners. Both need to agree." },
  { id:"permission", stage:"Contact", title:"Contact checks passed in the example", detail:"Sample permission, calling window, and spending limit checked." },
  { id:"call", stage:"Conversation", title:"Calling the sample seller", detail:"No real call is being placed." },
  { id:"answer", stage:"Conversation", title:"Seller picked up!", detail:"“I may sell. The kitchen needs work.”", conversation:[{speaker:"iCash X",message:"What would make selling worthwhile for you?"},{speaker:"Seller",message:"I may sell. The kitchen needs work, and my sister is also on the deed."},{speaker:"iCash X",message:"Thanks. We would need both owners involved. What timing works for you?"}] },
  { id:"interest", stage:"Qualification", title:"The seller wants to talk numbers", detail:"Discussing timing and confirming the second owner is on board." },
  { id:"analysis", stage:"Analysis", title:"Running the deal numbers", detail:"Sample repair estimate: $25,000. Estimates still need verification." },
  { id:"offer", stage:"Offer", title:"An offer is on the table", detail:"The example offer stays within the approved $119,000 limit." },
  { id:"contract", stage:"Contract", title:"Under contract — in this example!", detail:"Fictional purchase price: $115,000. Required checks are assumed complete in this example.", explanation:"Under contract means the buyer and seller signed an agreement. The sale is not closed yet. Deadlines and contract conditions still apply." },
  { id:"buyers", stage:"Buyer", title:"Finding the right cash buyer", detail:"Looking for a buyer whose budget and property preferences fit." },
  { id:"buyer", stage:"Buyer", title:"A buyer wants the deal", detail:"Fictional buyer price: $135,000. Confirming terms with title." },
  { id:"title", stage:"Closing", title:"The sample deal is heading to closing", detail:"Title handles the agreed escrow deposit and closing requirements.", explanation:"The title or closing company checks ownership, handles the agreed funds, and coordinates the final paperwork." },
  { id:"closed", stage:"Complete", title:"Fictional deal closed", detail:"$20,000 difference before costs and taxes. No real earnings or payout." },
];

export function DemoRunner({ onFund }: { onFund: () => void }) {
  const [count, setCount] = useState(1);
  const [restored, setRestored] = useState(false);
  const [limitConfirmed, setLimitConfirmed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [run, setRun] = useState(0);
  const [visible, setVisible] = useState(true);
  const complete = count === steps.length;
  const needsYou = count === 9 && !limitConfirmed;
  const running = restored && !paused && visible && !complete && !needsYou;
  useEffect(()=>{ const saved=readDemoProgress(); if(saved){setCount(saved.count);setLimitConfirmed(saved.limitConfirmed);setPaused(true);} setRestored(true); },[]);
  useEffect(()=>{if(restored) saveDemoProgress(count,limitConfirmed);},[count,limitConfirmed,restored]);
  const offer = conversionOffer({mode:"demo",complete},previewCreditPacks[0]);
  useEffect(()=>{
    const update = ()=>setVisible(!document.hidden);
    update(); document.addEventListener("visibilitychange",update);
    return ()=>document.removeEventListener("visibilitychange",update);
  },[]);
  useEffect(()=>{
    if (!running) return;
    const timer = window.setTimeout(()=>setCount(value=>Math.min(value+1,steps.length)),["interest","contract","buyer","closed"].includes(steps[count-1].id) ? 2800 : 1600);
    return ()=>window.clearTimeout(timer);
  },[count,running,run]);
  function restart() { setCount(1); setLimitConfirmed(false); setPaused(false); setRun(value=>value+1); }
  return <div className="demo-stream">
    <div className="stream-status"><span className={running ? "stream-dot moving" : "stream-dot"}/><strong>{complete ? "EXAMPLE COMPLETE" : needsYou ? "NEEDS YOU · SAMPLE" : running ? "DEMO RUNNING" : "DEMO PAUSED"}</strong><span>{count}/{steps.length}</span></div>
    <div className="stream-current" aria-live="polite" aria-atomic="true"><h3>{steps[count-1].title}</h3><p>{complete ? "Real deals take longer and may not close." : needsYou ? "One quick decision. Your bot is waiting." : count < 6 ? "Next: learn whether the owner wants to sell." : count < 10 ? "Next: work out a price within your limit." : count < 13 ? "Next: find a buyer and confirm the terms." : "Next: complete the closing checks."}</p></div>
    {needsYou && <div className="needs-you-card"><span>YOUR APPROVAL · FICTIONAL EXAMPLE</span><h3>The seller asks for $120,000.</h3><p>Your limit is $119,000. The bot waits instead of spending above your limit.</p><button className="fund-button full" onClick={()=>{setLimitConfirmed(true);setPaused(false);setCount(10);}}>Keep my $119,000 limit <Check size={17}/></button><small>In this sample, further negotiation reaches $115,000. Real sellers may decline.</small></div>}
    <div className="stream-controls">{!complete && !needsYou && <button className="demo-button" onClick={()=>setPaused(value=>!value)}>{paused ? <Play size={17}/> : <Pause size={17}/>}{paused ? "Resume example" : "Pause example"}</button>}<button className={complete ? "demo-button" : "stream-restart"} onClick={restart} aria-label="Restart example"><RotateCcw size={17}/>{complete && "Run again"}</button></div>
    {offer && <div className="conversion-card"><span>YOUR NEXT MOVE</span><h3>{offer.title}</h3><p>{offer.detail}</p><button className="fund-button full" onClick={onFund}>{offer.button}<ArrowRight size={18}/></button><small>No real credits were spent in this demo. Live funding is not open yet.</small></div>}
    {count >= 2 && <details className="deal-summary" onToggle={event=>{if(event.currentTarget.open && !complete)setPaused(true);}}><summary><House size={19}/><span><strong>Sample property</strong><small>{count >= 14 ? "Fictional closing complete" : count >= 10 ? "Agreement signed · finding a buyer" : count >= 7 ? "Seller interested · working on price" : "Researching the opportunity"}</small></span><span className="deal-expand">Details</span></summary><div><p>This is a fictional house, not a live listing.</p><dl><div><dt>Repair estimate</dt><dd>{count>=8 ? "$25,000 · sample" : "Still being checked"}</dd></div><div><dt>Your offer limit</dt><dd>$119,000 · sample</dd></div><div><dt>Purchase price</dt><dd>{count>=10 ? "$115,000 · sample" : "Not agreed yet"}</dd></div><div><dt>Buyer price</dt><dd>{count>=12 ? "$135,000 · sample" : "No buyer offer yet"}</dd></div></dl><small>Opening details pauses the sample so you can read. Use Resume example to continue.</small></div></details>}
    <ActivityFeed events={steps.slice(0,count)} mode="demo" onInspect={()=>setPaused(true)}/>
    <p className="stream-note">Fictional demo · Time compressed · No calls, charges, or payouts. Live activity only updates when real work happens.</p>
  </div>;
}
