"use client";

import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw, ArrowRight, House, Check } from "lucide-react";
import { DEMO_PROPERTY } from "@/lib/demo-property";
import { PropertyMedia } from "./property-media";
import { SellerEvidence } from "./seller-evidence";
import { DealProgressCard } from "./deal-progress-card";
import { ActivityFeed, type ActivityItem } from "./activity-feed";
import { conversionOffer } from "@/lib/conversion-engine";
import { readDemoProgress, saveDemoProgress } from "@/lib/demo-progress";
import { previewCreditPacks } from "@/config/credit-packs";

const steps: ActivityItem[] = [
  { id:"search", stage:"Research", emoji:"🔎", title:"Looking for a property deal", detail:"Your bot checks test properties so you do not have to build a lead list." },
  { id:"rank", stage:"Research", emoji:"🏠", title:"A property worth a closer look", detail:"Your bot compares the property’s condition, likely value, and buyer demand before moving ahead." },
  { id:"owner", stage:"Owner", emoji:"👥", title:"Checking who owns the property", detail:"There are two owners in this test. Both need to agree to sell." },
  { id:"permission", stage:"Contact", emoji:"✅", title:"Checking whether it can contact the owner", detail:"Your bot checks contact permission, the right time to call, and the spending limit." },
  { id:"call", stage:"Conversation", emoji:"📞", title:"Calling the test seller", detail:"Your bot starts the conversation for you. This test does not place a real call." },
  { id:"answer", stage:"Conversation", emoji:"💬", title:"The seller is open to talking", detail:"Your bot asks about the home, repairs, and why the owner might sell.", conversation:[{speaker:"iCash X",message:"What would make selling worthwhile for you?"},{speaker:"Seller",message:"I may sell. The kitchen needs work, and my sister is also on the deed."},{speaker:"iCash X",message:"Thanks. We would need both owners involved. What timing works for you?"}] },
  { id:"interest", stage:"Qualification", emoji:"📅", title:"Follow-up booked", detail:"“Call tomorrow at 3 PM.” Your bot saves the time and time zone so you do not have to remember. Time moves faster in this test." },
  { id:"analysis", stage:"Analysis", emoji:"🧮", title:"Checking the numbers before an offer", detail:"After the test follow-up, your bot reviews repairs and property value to work out an offer within your limit." },
  { id:"offer", stage:"Offer", emoji:"🤝", title:"Discussing a price with the seller", detail:"Your bot works within your approved $119,000 test limit. A higher amount needs your approval." },
  { id:"contract", stage:"Contract", emoji:"📝", title:"Test purchase agreement signed", detail:"Both owners agree to the fictional $115,000 purchase. This is a step toward closing—not a completed sale.", explanation:"Under contract means the buyer and seller signed an agreement. The sale is not closed yet. Deadlines and contract conditions still apply." },
  { id:"buyers", stage:"Buyer", emoji:"🔎", title:"Looking for a cash buyer", detail:"Your bot looks for buyers interested in this property type, area, and price." },
  { id:"buyer", stage:"Buyer", emoji:"🙋", title:"A test buyer is interested", detail:"The fictional buyer offers $135,000. Your bot helps check the buyer’s funds and terms before moving ahead." },
  { id:"buyer_agreement", stage:"Buyer", emoji:"✍️", title:"Test buyer agreement signed", detail:"The buyer’s agreement and funds are assumed verified in this test. Other interested buyers stay on file." },
  { id:"title", stage:"Closing", emoji:"🏢", title:"Getting the closing company involved", detail:"The closing company checks ownership and handles the paperwork and agreed funds. Your bot helps coordinate the next steps.", explanation:"The title or closing company checks ownership, handles the agreed funds, and coordinates the final paperwork." },
  { id:"deposit", stage:"Escrow", emoji:"✅", title:"Test buyer deposit confirmed", detail:"The closing company confirms it received the buyer’s deposit. Sending a payment link alone does not count." },
  { id:"schedule", stage:"Closing", emoji:"🗓️", title:"Test closing date set", detail:"Your bot tracks the remaining paperwork and deadlines. No real appointment has been booked." },
  { id:"closed", stage:"Complete", emoji:"🎉", title:"Test deal closed", detail:"A fictional $20,000 difference before costs and taxes. This walkthrough shows the process—not real earnings or a promised result." },
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
    <div className="stream-status"><span className={running ? "stream-dot moving" : "stream-dot"}/><strong>{complete ? "Test complete" : needsYou ? "Needs you" : running ? "Working · test" : "Paused · test"}</strong><span>{needsYou ? "1 decision" : "No action needed"}</span></div>
    {!needsYou && <div className="stream-current" aria-live="polite" aria-atomic="true"><h3><span className="current-emoji" aria-hidden="true">{steps[count-1].emoji}</span>{steps[count-1].title}</h3><p>{needsYou ? "Review this offer — about 1 minute. Your bot waits for your decision." : steps[count-1].detail}</p></div>}
    {needsYou && <div className="needs-you-card"><span>REVIEW THIS OFFER · TEST</span><h3><span aria-hidden="true">✋ </span>The seller asks for $120,000.</h3><p>Your limit is $119,000. Keep it there so your bot cannot agree to a higher price.</p><button className="fund-button full" onClick={()=>{setLimitConfirmed(true);setPaused(false);setCount(10);}}>Keep my $119,000 limit <Check size={17}/></button><small>In this test, further negotiation reaches $115,000. Real sellers may decline.</small></div>}

    <div className="stream-controls">{!complete && !needsYou && <button className="demo-button" onClick={()=>setPaused(value=>!value)}>{paused ? <Play size={17}/> : <Pause size={17}/>}{paused ? "Resume test" : "Pause test"}</button>}<button className={complete ? "demo-button" : "stream-restart"} onClick={restart} aria-label="Restart test"><RotateCcw size={17}/>{complete && "Run again"}</button></div>
    {offer && <div className="sample-funding"><button className="fund-button full" onClick={onFund}>See funding options <ArrowRight size={18}/></button><small>Real payments are not open yet.</small></div>}
    {count >= 10 && <DealProgressCard onInspect={()=>{if(!complete)setPaused(true);}} snapshot={{sellerSigned:true,marketingAuthorized:true,buyerSigned:count>=13,depositConfirmedByEscrow:count>=15,titleOpened:count>=14,closingScheduled:count>=16,closedByTitle:count>=17,proceedsConfirmed:false,failed:false,buyerWithdrew:false,titleIssue:false,deadlineAt:null}}/>}
    {count >= 2 && count < 10 && <details className="property-focus" onToggle={event=>{if(event.currentTarget.open)setPaused(true);}}><summary><span className="focus-house" aria-hidden="true">🏠</span><span><strong>{DEMO_PROPERTY.address}</strong><small>{count>=6?"Seller responded":"Promising property"} · test</small></span><span className="focus-open">Details</span></summary><div className="focus-details"><PropertyMedia photo={DEMO_PROPERTY.photo}/><div className="promising-body"><h3>{DEMO_PROPERTY.address}</h3><p>{DEMO_PROPERTY.location}</p><p>{DEMO_PROPERTY.description}</p><p>{count >= 6 ? "The owner is open to a conversation. Your bot is checking the details." : "A possible fit based on test equity, condition, and buyer demand."}</p><span className="lead-next">{count >= 7 ? "Next: follow up at the agreed time" : count >= 6 ? "Next: confirm timing and other owners" : "Next: check the owner and contact permission"}</span></div><details className="property-numbers" onToggle={event=>{if(event.currentTarget.open)setPaused(true);}}><summary>Property numbers</summary><dl><div><dt>Repair estimate</dt><dd>{count>=8 ? "$25,000 · test" : "Not verified yet"}</dd></div><div><dt>Offer limit</dt><dd>$119,000 · test</dd></div><div><dt>Contract</dt><dd>Not signed yet</dd></div></dl></details><SellerEvidence available={count>=6} callbackBooked={count>=7} onInspect={()=>setPaused(true)}/></div></details>}
    <ActivityFeed events={steps.slice(0,count)} mode="demo" onInspect={()=>setPaused(true)}/>
    <p className="stream-note">Test mode · Fictional people, properties, and results. No real calls, charges, or earnings.</p>
  </div>;
}

