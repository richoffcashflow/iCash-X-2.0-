"use client";

import { useState } from "react";
import Image from "next/image";
import { ArrowRight, Check, LockKeyhole, RotateCcw, Plus, Sparkles } from "lucide-react";
import { previewCreditPacks } from "@/config/credit-packs";
import { rankProspect, type Prospect } from "@/lib/prospect-policy";

function sampleRank() {
  const now = Date.now();
  const evidence = (value: number, confidence: number) => ({ value, confidence, updatedAt: now });
  const sample: Prospect = {
    id: "fictional-house", equityRatio: evidence(0.74, 0.82), repairSeverity: evidence(0.62, 0.66),
    sellerIntent: evidence(0.72, 0.85), buyerFit: evidence(0.79, 0.78),
    requiredSignersIdentified: false, requiredSignersAligned: false, titleReviewed: false,
  };
  return rankProspect(sample, now).score;
}

const moves = [
  {
    name: "Find a promising property",
    action: (score: number) => `I found a sample property worth a closer look. It scores ${score}/100 based on equity, condition, seller interest, and buyer demand.`,
    lesson: "The bot focuses its budget on better opportunities.",
  },
  {
    name: "Talk to the seller",
    action: () => "After checking contact permission and spending limits, I talk to the sample seller.",
    seller: "I might sell. The kitchen needs work, and my sister is on the deed.",
    lesson: "The bot learns the seller's timing, property condition, and who must sign.",
  },
  {
    name: "Work the offer",
    action: () => "I check the repairs, value, owners, and title. In this sample, the agreed price is $115,000—within the approved limit.",
    lesson: "The bot cannot commit above your limit or skip owner and title checks.",
  },
  {
    name: "Find a buyer and close",
    action: () => "I match a sample buyer at $135,000 and coordinate with title. This fictional closing has a $20,000 difference before costs and taxes.",
    lesson: "That $20,000 is a sandbox example, not a real deal or promised payout.",
  },
] as const;

export default function Home() {
  const [started, setStarted] = useState(false);
  const [move, setMove] = useState(0);
  const [score, setScore] = useState(0);
  const [fundingOpen, setFundingOpen] = useState(false);
  function start() { setScore(sampleRank()); setStarted(true); setMove(0); }

  return <div className="console-shell">
    <header className="console-header"><div><Image src="/icash-x-logo.png" alt="iCash X" width={111} height={62} priority /><span>PREVIEW MODE</span></div></header>
    <main className="console-main">
      <h1 className="sr-only">iCash X AI wholesaling workspace</h1>
      <section className="balance-panel" aria-labelledby="balance-label">
        <div className="balance-top"><div><span id="balance-label">Credits for your bot</span><strong>$0<span>demo balance</span></strong></div><button className="fund-button" aria-expanded={fundingOpen} aria-controls="inline-funding" onClick={()=>setFundingOpen(value=>!value)}>Add credits <Plus size={18}/></button></div>
        <p>Credits pay for property research and permitted calls or messages.</p>
        {fundingOpen && <div className="inline-funding" id="inline-funding"><div><strong>Start with {previewCreditPacks[0].label}</strong><span>One-time credit purchase</span></div><p>You approve the daily limit. The bot pauses when it runs out. More credits never guarantee a deal.</p><button className="fund-button full" disabled>Payments open soon <LockKeyhole size={17}/></button><small>Checkout is not connected. You cannot be charged in this preview.</small></div>}
      </section>
      <section className="operation-panel" aria-labelledby="operation-title">
        <div className="operation-top"><span className="bot-icon">X</span><div><h2 id="operation-title">Live activity</h2><span>{started ? "Sample activity · no live work" : "Live bot not connected yet"}</span></div><span className="mode-badge">{started ? "DEMO" : "PREVIEW"}</span></div>
        {!started ? <div className="operation-empty"><h3>Your bot works. You follow along.</h3><p>iCash X helps find properties, talk to sellers, and work toward closing. Try a free example here.</p><button className="demo-button" onClick={start}>Run a free example <ArrowRight size={18}/></button><small>No typing. No sign-up. No card.</small></div> : <div className="operation-example">
          <div className="example-progress"><span>EXAMPLE {move+1} OF 4</span><button onClick={start} aria-label="Restart sample deal"><RotateCcw size={15}/>Restart</button></div>
          <div className="example-step" aria-live="polite"><h3>{moves[move].name}</h3><p>{moves[move].action(score)}</p>{"seller" in moves[move] && <blockquote><span>SAMPLE SELLER</span>“{moves[move].seller}”</blockquote>}<div className="example-lesson"><Check size={16}/><span>{moves[move].lesson}</span></div></div>
          {move < 3 ? <button className="demo-button" onClick={()=>setMove(value=>value+1)}>Next step <ArrowRight size={18}/></button> : <div className="example-done"><Check size={18}/><span>Example complete. Your real bot's activity will appear here.</span></div>}
          <small className="example-note">Fictional example. No real contact, contract, or payout.</small>
        </div>}
      </section>
      <div className="free-access-note"><Sparkles size={18}/><p><strong>Free to start. Fund more work when you choose.</strong><span>Live free use will have a small limit. Accounts and property data are still being connected.</span></p></div>
    </main>
    <footer className="console-footer"><details className="inline-disclosures"><summary>How credits work & important details</summary><div><p><strong>Credits:</strong> One-time funding starts at $20 in this preview. Exact operation rates and free limits will be shown before checkout is enabled. iCash X charges can differ from its provider costs.</p><p><strong>Your control:</strong> Approve a daily limit and pause at any time. Auto-reload requires separate opt-in. Free use stops at its limit and does not silently become paid use.</p><p><strong>Results:</strong> No property, contract, buyer, closing, or income is guaranteed. Demo people and outcomes are fictional. AI estimates and documents need appropriate verification.</p><p><strong>Live work:</strong> Contact permissions, local rules, owner authority, and approved contract terms must pass before work is dispatched. Being a property buyer does not by itself exempt AI calls from applicable rules.</p><p>This is a product preview. Accounts, live data, outreach, and payments are not connected. Final rates and terms remain pending.</p></div></details></footer>
  </div>;
}
