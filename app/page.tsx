"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, ChevronLeft, LockKeyhole, Pause, Sparkles } from "lucide-react";
import { previewCreditPacks } from "@/config/credit-packs";
import { rankProspect, type Prospect, type RankedProspect } from "@/lib/prospect-policy";

type Step = "start" | "sandbox" | "fund" | "activity";
type Moment = { phase: string; bot: string; seller?: string; lesson: string };

function sampleProperty(now: number): Prospect {
  const evidence = (value: number, confidence: number) => ({ value, confidence, updatedAt: now });
  return {
    id: "fictional-sandbox-house",
    equityRatio: evidence(0.74, 0.82), repairSeverity: evidence(0.62, 0.66),
    sellerIntent: evidence(0.72, 0.85), buyerFit: evidence(0.79, 0.78),
    requiredSignersIdentified: false, requiredSignersAligned: false, titleReviewed: false,
  };
}

function moments(score: number): Moment[] { return [
  { phase: "FIND", bot: `I search houses and land, then rank the opportunities. This fictional house scores ${score}/100 based on estimated equity, condition, seller interest, and buyer demand.`, lesson: "The bot spends more time on promising opportunities, not every property." },
  { phase: "CONTACT", bot: "Before any real outreach, I check the number, local time, permission, and your credit limit. In this sandbox, the seller agreed to talk.", seller: "I might sell. The kitchen needs work, and my sister is on the deed.", lesson: "Seller motivation, condition, and every owner matter." },
  { phase: "ANALYZE", bot: "Sample after-repair value: $220k. Estimated repairs: $25k. I would verify photos, comps, payoff, and title. I cannot prepare a real offer while ownership is unresolved.", lesson: "Estimates guide the offer; verified facts and signing authority gate it." },
  { phase: "OFFER", bot: "In this fictional run, both owners and title are cleared. The approved offer limit is $119k. I negotiate a $115k contract, within the limit.", seller: "That timing and price work for us.", lesson: "The bot negotiates only within the user's authorized terms." },
  { phase: "BUYER + TITLE", bot: "Sample contract signed. I match a cash buyer at $135k, coordinate with title, and request the agreed buyer deposit be paid to escrow. I never hold that deposit.", lesson: "The buyer and title work follows a valid seller agreement." },
  { phase: "CLOSE", bot: "$20k fictional gross spread: $135k buyer price minus $115k seller contract. Actual proceeds would depend on closing, costs, taxes, and the signed terms.", lesson: "No contract, buyer, closing, or income is guaranteed." },
]; }

export default function Home() {
  const [step, setStep] = useState<Step>("start");
  const [analysis, setAnalysis] = useState<RankedProspect | null>(null);
  const [moment, setMoment] = useState(0);
  const [selectedPack, setSelectedPack] = useState(2000);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => { window.scrollTo(0, 0); }, [step]);
  useEffect(() => {
    if (step !== "sandbox" || moment >= 5) return;
    const timer = window.setTimeout(() => setMoment(current => current + 1), moment === 1 ? 3600 : 2600);
    return () => window.clearTimeout(timer);
  }, [step, moment]);
  useEffect(() => {
    if (step === "sandbox" && feedRef.current) feedRef.current.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [step, moment]);

  function startSandbox() {
    const now = Date.now();
    setAnalysis(rankProspect(sampleProperty(now), now));
    setMoment(0);
    setStep("sandbox");
  }

  const story = moments(analysis?.score ?? 0);

  return <div className="app-shell">
    <header className="topbar"><button className="brand" onClick={() => setStep("start")} aria-label="iCash X home"><Image src="/icash-x-logo.png" alt="iCash X" width={120} height={68} priority /></button><span className="preview-tag">SANDBOX PREVIEW</span></header>
    <main className="main-area"><div className="workspace">
      {step === "start" && <section className="flow-screen start-screen" aria-labelledby="start-title">
        <div className="flow-kicker"><span className="pulse-dot" /> MEET YOUR AI WHOLESALING BOT</div>
        <h1 id="start-title">Real estate<br />wholesaling,<br />made easy.</h1>
        <p className="lead">iCash X finds opportunities, talks to sellers where permitted, works offers, finds buyers, and helps move deals to closing. You stay in control.</p>
        <button className="primary-action" onClick={startSandbox}>Try the AI bot free <ArrowRight size={20} /></button>
        <p className="under-action">No card. No setup. See how a deal works.</p>
        <div className="simple-path"><span><b>01</b> Try the sandbox</span><span><b>02</b> Fund your bot</span><span><b>03</b> Watch real work</span></div>
      </section>}

      {step === "sandbox" && analysis && <section className="flow-screen sandbox-screen" aria-labelledby="sandbox-title">
        <button className="back-link" onClick={() => setStep("start")}><ChevronLeft size={18} /> Back</button>
        <div className="flow-kicker"><Sparkles size={16} /> FREE SANDBOX</div>
        <h1 id="sandbox-title">See your bot<br />work a deal.</h1>
        <p className="lead">This is a guided fictional deal. The ranking calculation is real; the property, seller, contract, buyer, and payout are examples.</p>
        <div className="bot-window">
          <div className="bot-top"><div className="bot-avatar">X</div><div><strong>iCash X</strong><span>Sandbox · example only</span></div><div className="bot-count">{moment + 1} / 6</div></div>
          <div className="bot-feed" ref={feedRef} aria-live="polite">{story.slice(0, moment + 1).map((item, i) => <div className="bot-moment" key={item.phase}>
            <div className="phase-label"><span>{String(i + 1).padStart(2, "0")}</span> {item.phase}</div>
            <div className="bot-bubble">{item.bot}</div>
            {item.seller && <div className="seller-bubble"><small>FICTIONAL SELLER</small>{item.seller}</div>}
            <div className="lesson"><Check size={14} /><span>{item.lesson}</span></div>
          </div>)}</div>
          <div className="bot-bottom"><span>{moment === 5 ? "Sandbox complete" : "Bot working through the example…"}</span><span className="bot-progress"><i style={{ width: `${((moment + 1) / 6) * 100}%` }} /></span></div>
        </div>
        <p className="sample-truth">Sandbox only. No actual search, call, message, agreement, buyer, payment, or earnings occurred.</p>
        <button className="primary-action" onClick={() => setStep("fund")}>Fund my AI bot <ArrowRight size={20} /></button>
        <p className="under-action">Start with $20 when live funding opens. No deal is guaranteed.</p>
      </section>}

      {step === "fund" && <section className="flow-screen fund-screen" aria-labelledby="fund-title">
        <button className="back-link" onClick={() => setStep("sandbox")}><ChevronLeft size={18} /> Back to sandbox</button>
        <div className="flow-kicker"><span className="pulse-dot" /> NEXT / FUND YOUR BOT</div>
        <h1 id="fund-title">Put your AI bot<br />to work.</h1>
        <p className="lead">Start small. Credits cover real research and permitted outreach. The bot paces spending, you set a daily limit, and you can pause anytime.</p>
        <div className="fund-card"><div className="fund-card-title"><span>CHOOSE CREDITS</span><span>ONE TIME</span></div>
          <div className="pack-options">{previewCreditPacks.map(pack => <button key={pack.amountCents} className={selectedPack === pack.amountCents ? "pack selected" : "pack"} onClick={() => setSelectedPack(pack.amountCents)} aria-pressed={selectedPack === pack.amountCents}><strong>{pack.label}</strong><span>{pack.description}</span><span className="pack-mark">{selectedPack === pack.amountCents && <Check size={17} />}</span></button>)}</div>
          <button className="primary-action" disabled>Funding opens soon <LockKeyhole size={17} /></button>
          <p className="fund-note">Preview only. No charge, property search, or outreach can start yet.</p>
        </div>
        <Link className="document-link" href="/costs-and-disclosures">Credits & disclosures <ArrowRight size={16} /></Link>
        <button className="quiet-link" onClick={() => setStep("activity")}>Operation status <ArrowRight size={16} /></button>
      </section>}

      {step === "activity" && <section className="flow-screen" aria-labelledby="activity-title">
        <button className="back-link" onClick={() => setStep("fund")}><ChevronLeft size={18} /> Back</button>
        <div className="flow-kicker"><span className="pulse-dot" /> OPERATION STATUS</div>
        <h1 id="activity-title">Standing by.</h1>
        <div className="standby-card"><Pause size={24} /><strong>NO LIVE WORK YET</strong><p>No property searches, seller contacts, charges, contracts, or closings have occurred. Actual progress will appear here when the integrations and payments are live.</p></div>
      </section>}
    </div></main><footer><span>iCash X</span><span>© 2026</span></footer>
  </div>;
}
