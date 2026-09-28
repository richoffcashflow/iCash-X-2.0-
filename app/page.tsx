"use client";

import { useState } from "react";
import Image from "next/image";
import { ArrowRight, LockKeyhole, Plus, Sparkles } from "lucide-react";
import { previewCreditPacks } from "@/config/credit-packs";
import { DemoRunner } from "@/components/demo-runner";

export default function Home() {
  const [started, setStarted] = useState(false);
  const [fundingOpen, setFundingOpen] = useState(false);
  function start() { setStarted(true); }
  function openFunding() { setFundingOpen(true); window.requestAnimationFrame(()=>document.getElementById("inline-funding")?.scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",block:"center"})); }

  return <div className="console-shell">
    <header className="console-header"><div><Image src="/icash-x-logo.png" alt="iCash X" width={111} height={62} priority /><span>PREVIEW MODE</span></div></header>
    <main className="console-main">
      <h1 className="sr-only">iCash X AI wholesaling workspace</h1>
      <section className="balance-panel" aria-labelledby="balance-label">
        <div className="balance-top"><div><span id="balance-label">Credits for your bot</span><strong>$0<span>demo balance</span></strong></div><button className="fund-button" aria-expanded={fundingOpen} aria-controls="inline-funding" onClick={()=>setFundingOpen(value=>!value)}>Add credits <Plus size={18}/></button></div>
        <p>Credits pay for property research and permitted calls or messages.</p>
        {fundingOpen && <div className="inline-funding" id="inline-funding"><div><strong>Start with {previewCreditPacks[0].label}</strong><span>One-time credit purchase</span></div><p>You approve the daily limit. The bot pauses when it runs out. More credits never guarantee a deal.</p><button className="fund-button full" disabled>Payments open soon <LockKeyhole size={17}/></button><small>Checkout is not connected. No charge is possible yet. After payment, a secure email link will let you claim your account.</small></div>}
      </section>
      <section className="operation-panel" aria-labelledby="operation-title">
        <div className="operation-top"><span className="bot-icon">X</span><div><h2 id="operation-title">Live activity</h2><span>{started ? "Sample activity · no live work" : "Live bot not connected yet"}</span></div><span className="mode-badge">{started ? "DEMO" : "PREVIEW"}</span></div>
        {!started ? <div className="operation-empty"><h3>Your 24/7 AI wholesaling bot.</h3><p>Built to find properties, follow up, and work toward closing. Watch a free example—no real estate experience needed.</p><button className="demo-button" onClick={start}>Run a free example <ArrowRight size={18}/></button><small>No typing. No sign-up. No card.</small></div> : <DemoRunner onFund={openFunding} />}
      </section>
      <div className="free-access-note"><Sparkles size={18}/><p><strong>Free to start. Fund more work when you choose.</strong><span>Research can run around the clock; calls and texts follow permitted hours. Live connections are still pending.</span></p></div>
    </main>
    <footer className="console-footer"><details className="inline-disclosures"><summary>How credits work & important details</summary><div><p><strong>Credits:</strong> One-time funding starts at $20 in this preview. Exact operation rates and free limits will be shown before checkout is enabled. iCash X charges can differ from its provider costs.</p><p><strong>Your control:</strong> Approve a daily limit and pause at any time. Auto-reload requires separate opt-in. Free use stops at its limit and does not silently become paid use.</p><p><strong>Results:</strong> No property, contract, buyer, closing, or income is guaranteed. Demo people and outcomes are fictional. AI estimates and documents need appropriate verification.</p><p><strong>Live work:</strong> Contact permissions, local rules, owner authority, and approved contract terms must pass before work is dispatched. Being a property buyer does not by itself exempt AI calls from applicable rules.</p><p>This is a product preview. Accounts, live data, outreach, and payments are not connected. Final rates and terms remain pending.</p></div></details></footer>
  </div>;
}
