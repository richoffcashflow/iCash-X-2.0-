"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, LockKeyhole } from "lucide-react";
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
    action: (score: number) => `I look across houses and land. This sample house ranks ${score}/100 using estimated owner equity, condition, seller interest, and buyer demand.`,
    lesson: "The bot focuses its budget on better opportunities.",
  },
  {
    name: "Talk to the seller",
    action: () => "I check whether contact is allowed and whether the number, local time, and credit limit pass. In this example, the seller agreed to talk.",
    seller: "I might sell. The kitchen needs work, and my sister is on the deed.",
    lesson: "The bot learns the seller's timing, property condition, and who must sign.",
  },
  {
    name: "Work the offer",
    action: () => "Sample value after repairs: $220,000. Estimated repairs: $25,000. After checking the owners and title in this fictional deal, I stay under the approved $119,000 limit and agree on $115,000.",
    lesson: "The bot cannot commit above your limit or skip owner and title checks.",
  },
  {
    name: "Find a buyer and close",
    action: () => "In this fictional deal, a buyer agrees to $135,000, pays any agreed deposit to title escrow, and closing is completed. The difference is $20,000 before other costs and taxes.",
    lesson: "That $20,000 is a sandbox example, not a real deal or promised payout.",
  },
] as const;

export default function Home() {
  const [started, setStarted] = useState(false);
  const [move, setMove] = useState(0);
  const [score, setScore] = useState(0);
  const [selectedPack, setSelectedPack] = useState(2000);
  const [fundingShown, setFundingShown] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [asked, setAsked] = useState("");

  function show(id: string) { window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })); }
  function start(event?: FormEvent) { event?.preventDefault(); setAsked(prompt.trim()); setScore(sampleRank()); setMove(0); setStarted(true); setFundingShown(false); show("sandbox"); }
  function onPromptKey(event: KeyboardEvent<HTMLTextAreaElement>) { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); start(); } }
  function continueDemo() {
    if (move < moves.length - 1) setMove(current => current + 1);
    else { setFundingShown(true); show("funding"); }
  }

  return <div className="single-shell">
    <header className="black-head"><div className="head-inner"><span className="head-brand"><Image src="/icash-x-logo.png" alt="iCash X" width={120} height={68} priority /></span><span className="head-label">FREE SANDBOX</span></div></header>
    <main>
      <section className="hero" aria-labelledby="hero-title"><div className="hero-inner">
        <span className="hero-kicker">iCASH X DOES THE WORK</span>
        <h1 id="hero-title">Real estate<br />wholesaling,<br />made easy.</h1>
        <p>iCash X finds opportunities, talks to sellers where permitted, works offers, finds buyers, and helps move deals to closing.</p>
        <form className="prompt-box" onSubmit={start}><label htmlFor="first-prompt">Try it free</label><div className="prompt-row"><textarea id="first-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={onPromptKey} maxLength={180} rows={2} placeholder="Show me how it works…" /><button type="submit">Show me <ArrowRight size={20} /></button></div></form>
        <span className="hero-small">No sign-in or card. Start with a sample deal, then try a small live free run when available.</span>
      </div></section>

      <div className="single-content">
        <section id="sandbox" className="single-section" aria-labelledby="sandbox-title">
          <div className="section-heading"><div><span className="eyebrow">SAMPLE DEAL</span><h2 id="sandbox-title">See it work.</h2></div><span className="sandbox-pill">EXAMPLE</span></div>
          <p className="section-intro">A quick example to show you what the bot does. No real seller is involved.</p>
          <div className="work-panel">
            <div className="work-panel-top"><span className="bot-monogram">X</span><span><strong>iCash X</strong><small>{started ? `Sample move ${move + 1} of 4` : "Ready to show you"}</small></span><span className="status-chip">{started ? "SANDBOX" : "STANDBY"}</span></div>
            {!started ? <div className="work-body welcome"><strong>Your bot does the work.</strong><p>Tap “Show me” above. Then see it find a property, talk to a sample seller, and work toward closing.</p><span>Nothing live starts in this preview.</span></div> : <div className="work-body" key={move}>
              {asked && <div className="user-prompt"><span>YOU ASKED</span><p>{asked}</p></div>}
              <div className="work-progress" aria-label={`Move ${move + 1} of 4`}>{moves.map((item, i) => <span key={item.name} className={i <= move ? "active" : ""} />)}</div>
              <div className="move-label">{String(move + 1).padStart(2, "0")} / 04</div>
              <h3>{moves[move].name}</h3>
              <div className="ai-message"><span>iCASH X</span><p>{moves[move].action(score)}</p></div>
              {"seller" in moves[move] && <div className="seller-message"><span>FICTIONAL SELLER</span><p>{moves[move].seller}</p></div>}
              <div className="why-line"><Check size={17} /><span>{moves[move].lesson}</span></div>
            </div>}
            {started && <div className="work-panel-bottom"><button className="next-action" onClick={continueDemo}>{move === 3 ? "Try the real bot free" : "Next"} <ArrowRight size={19} /></button></div>}
          </div>
          <p className="truth-line">Sandbox: fictional property, seller, contract, buyer, and $20,000 example. The property ranking calculation uses real iCash X logic. No earnings are guaranteed.</p>
        </section>

        {fundingShown && <section id="funding" className="single-section funding-section" aria-labelledby="fund-title">
          <div className="section-heading"><div><span className="eyebrow">NEXT / LIVE FREE BOT</span><h2 id="fund-title">Let it run for free.</h2></div></div>
          <p className="section-intro">After a free account, the bot will check real properties with a small, clear limit. See what it finds before you pay.</p>
          <div className="free-card"><span className="free-badge">FREE FIRST</span><strong>Real work. Small limit.</strong><p>No card needed. See real findings and how much free use is left. The bot pauses at the limit.</p><button className="primary-action" disabled>Free live run opens soon <LockKeyhole size={18} /></button><small>Live accounts and property data are still being connected. No real work happens in this preview.</small></div>
          <div className="section-heading fund-heading"><div><span className="eyebrow">WHEN YOU WANT MORE</span><h2>Fund your bot.</h2></div></div>
          <p className="section-intro">If you want more work after the free limit, start with $20. You control the daily limit and can pause any time.</p>
          <div className="fund-card"><div className="fund-card-title"><span>CHOOSE CREDITS</span><span>ONE TIME</span></div><div className="pack-options">{previewCreditPacks.map(pack => <button key={pack.amountCents} className={selectedPack === pack.amountCents ? "pack selected" : "pack"} onClick={() => setSelectedPack(pack.amountCents)} aria-pressed={selectedPack === pack.amountCents}><strong>{pack.label}</strong><span>{pack.description}</span><span className="pack-mark">{selectedPack === pack.amountCents && <Check size={17} />}</span></button>)}</div><button className="primary-action" disabled>Funding opens soon <LockKeyhole size={18} /></button><p className="fund-note">Preview only. No charges or outreach can start yet. A deal is never guaranteed.</p></div>
          <Link className="document-link" href="/costs-and-disclosures">Credits & disclosures <ArrowRight size={16} /></Link>
        </section>}

      </div>
    </main><footer><span>iCash X</span><span>© 2026</span></footer>
  </div>;
}
