"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, ChevronLeft, House, LandPlot, LockKeyhole, Pause, Sparkles } from "lucide-react";
import { previewCreditPacks } from "@/config/credit-packs";
import { rankProspect, type Prospect, type RankedProspect } from "@/lib/prospect-policy";

type Kind = "houses" | "land";
type Step = "start" | "free" | "fund" | "activity";

function sampleProperty(kind: Kind, now: number): Prospect {
  const evidence = (value: number, confidence: number) => ({ value, confidence, updatedAt: now });
  return {
    id: `sample-${kind}`,
    equityRatio: evidence(kind === "houses" ? 0.74 : 0.67, 0.82),
    repairSeverity: evidence(kind === "houses" ? 0.62 : 0.36, 0.66),
    sellerIntent: evidence(kind === "houses" ? 0.72 : 0.78, 0.85),
    buyerFit: evidence(kind === "houses" ? 0.79 : 0.71, 0.78),
    requiredSignersIdentified: false,
    requiredSignersAligned: false,
    titleReviewed: false,
  };
}

const demoMoments = [
  { tag: "01 / FIND", title: "Opportunity ranked", text: "iCash X weighs seller intent, estimated equity, condition, and buyer fit before spending on outreach." },
  { tag: "02 / TALK", title: "Seller conversation", text: "iCash X can qualify timing and motivation. AI calling requires an approved contact path." },
  { tag: "03 / OFFER", title: "Offer evaluated", text: "Illustrative offer: $140,000. Owner authority, property facts, and title would need verification." },
  { tag: "04 / CONTRACT", title: "Contract milestone", text: "In a real deal, a signed agreement is verified before buyer outreach or title coordination." },
  { tag: "05 / BUYER", title: "Cash buyer matched", text: "Illustrative buyer price: $160,000. Buyer terms and escrow deposit depend on an approved contract." },
  { tag: "06 / CLOSE", title: "$20,000 gross spread", text: "Fictional example before transaction costs and taxes. No deal, closing, or income is guaranteed." },
];

export default function Home() {
  const [step, setStep] = useState<Step>("start");
  const [kind, setKind] = useState<Kind>("houses");
  const [analysis, setAnalysis] = useState<RankedProspect | null>(null);
  const [demoStage, setDemoStage] = useState(0);
  const [selectedPack, setSelectedPack] = useState(10000);

  useEffect(() => {
    if (step !== "free" || demoStage >= demoMoments.length - 1) return;
    const timer = window.setTimeout(() => setDemoStage(stage => stage + 1), 1550);
    return () => window.clearTimeout(timer);
  }, [step, demoStage]);

  function runFreePreview() {
    const now = Date.now();
    setAnalysis(rankProspect(sampleProperty(kind, now), now));
    setDemoStage(0);
    setStep("free");
  }

  return <div className="app-shell">
    <header className="topbar"><button className="brand" onClick={() => setStep("start")} aria-label="iCash X home"><Image src="/icash-x-logo.png" alt="iCash X" width={120} height={68} priority /></button><span className="preview-tag">EARLY PREVIEW</span></header>
    <main className="main-area"><div className="workspace">
      {step === "start" && <section className="flow-screen" aria-labelledby="start-title">
        <div className="flow-kicker"><span className="pulse-dot" /> YOUR AI WHOLESALING OPERATION</div>
        <h1 id="start-title">Real estate deals.<br /><span>Less work for you.</span></h1>
        <p className="lead">iCash X finds opportunities, works permitted seller conversations, helps get contracts signed, and moves deals toward closing.</p>
        <div className="choice-heading">What kind of deals do you want?</div>
        <div className="choice-grid" role="group" aria-label="Choose property type">
          <button className={kind === "houses" ? "choice selected" : "choice"} onClick={() => setKind("houses")} aria-pressed={kind === "houses"}><House size={27} strokeWidth={1.8} /><span>Houses</span><span className="choice-mark">{kind === "houses" && <Check size={18} />}</span></button>
          <button className={kind === "land" ? "choice selected" : "choice"} onClick={() => setKind("land")} aria-pressed={kind === "land"}><LandPlot size={27} strokeWidth={1.8} /><span>Land</span><span className="choice-mark">{kind === "land" && <Check size={18} />}</span></button>
        </div>
        <button className="primary-action" onClick={runFreePreview}>See iCash X work free <ArrowRight size={20} /></button>
        <p className="under-action">No card. No setup. A fast sample run.</p>
        <div className="journey" aria-label="How iCash X works"><span>FIND</span><span>TALK</span><span>OFFER</span><span>CONTRACT</span><span>CLOSE</span></div>
      </section>}

      {step === "free" && analysis && <section className="flow-screen" aria-labelledby="free-title">
        <button className="back-link" onClick={() => setStep("start")}><ChevronLeft size={18} /> Back</button>
        <div className="flow-kicker"><Sparkles size={15} /> FREE SIMULATION / {kind.toUpperCase()}</div>
        <h1 id="free-title">Watch the deal<br /><span>move forward.</span></h1>
        <p className="lead">A fictional deal path powered by iCash X&apos;s real ranking rules. No property was contacted and no credits were used.</p>
        <div className="sim-card" aria-live="polite">
          <div className="sim-head"><span>SIMULATION · NOT A LIVE DEAL</span><span>{String(demoStage + 1).padStart(2, "0")} / 06</span></div>
          <div className="sim-progress">{demoMoments.map((moment, i) => <span className={i <= demoStage ? "lit" : ""} key={moment.tag} />)}</div>
          <div className="sim-stage" key={demoStage}><small>{demoMoments[demoStage].tag}</small><strong className={demoStage === 5 ? "sim-win" : ""}>{demoMoments[demoStage].title}</strong><p>{demoMoments[demoStage].text}</p>{demoStage === 1 && <div className="sim-chat" aria-label="Fictional seller conversation"><div><b>iCash X · example</b><span>Would you consider an offer on your property?</span></div><div><b>Sample seller</b><span>Maybe, if the timing works for me.</span></div></div>}</div>
          <div className="sim-footer"><span>Sample rank</span><strong>{analysis.score}/100</strong><span>·</span><span>{analysis.reasons.slice(0, 2).join(" + ")}</span></div>
        </div>
        <p className="sample-truth">This is an example, not a real property, seller, contract, buyer, or payout. A live operation needs data access, payment, and approved outreach controls.</p>
        <button className="primary-action" onClick={() => setStep("fund")}>Put iCash X to work <ArrowRight size={20} /></button>
        <p className="under-action">See funding options before making any commitment.</p>
      </section>}

      {step === "fund" && <section className="flow-screen" aria-labelledby="fund-title">
        <button className="back-link" onClick={() => setStep("free")}><ChevronLeft size={18} /> Back to free run</button>
        <div className="flow-kicker"><span className="pulse-dot" /> NEXT / FUND THE OPERATION</div>
        <h1 id="fund-title">Make it work<br /><span>your market.</span></h1>
        <p className="lead">Credits pay for real research and permitted outreach. You choose a daily limit, see every charge, and can pause anytime.</p>
        <div className="fund-card"><div className="fund-card-title"><span>CHOOSE YOUR STARTING BALANCE</span><span>ONE TIME</span></div>
          <div className="pack-options">{previewCreditPacks.filter(pack => pack.amountCents >= 10000).map(pack => <button key={pack.amountCents} className={selectedPack === pack.amountCents ? "pack selected" : "pack"} onClick={() => setSelectedPack(pack.amountCents)} aria-pressed={selectedPack === pack.amountCents}><strong>{pack.label}</strong><span>{pack.description}</span><span className="pack-mark">{selectedPack === pack.amountCents && <Check size={17} />}</span></button>)}</div>
          <button className="primary-action" disabled>Funding opens soon <LockKeyhole size={17} /></button>
          <p className="fund-note">Preview only. No payment, property search, or seller contact can start yet.</p>
        </div>
        <Link className="document-link" href="/costs-and-disclosures">How credits work & disclosures <ArrowRight size={16} /></Link>
        <button className="quiet-link" onClick={() => setStep("activity")}>See operation status <ArrowRight size={16} /></button>
      </section>}

      {step === "activity" && <section className="flow-screen" aria-labelledby="activity-title">
        <button className="back-link" onClick={() => setStep("fund")}><ChevronLeft size={18} /> Back</button>
        <div className="flow-kicker"><span className="pulse-dot" /> OPERATION STATUS / STANDBY</div>
        <h1 id="activity-title">Nothing is<br /><span>running yet.</span></h1>
        <div className="standby-card"><Pause size={24} /><strong>STANDBY</strong><p>No properties analyzed, calls placed, charges made, or deals created. Verified progress will appear here when iCash X is live.</p></div>
      </section>}
    </div></main><footer><span>iCash X</span><span>© 2026</span></footer>
  </div>;
}
