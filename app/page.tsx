"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, LockKeyhole, RotateCcw } from "lucide-react";
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
  const [finished, setFinished] = useState(false);
  function start() { setScore(sampleRank()); setStarted(true); setMove(0); setFinished(false); }
  function next() { if (move < moves.length - 1) setMove(value => value + 1); else setFinished(true); }

  return <div className="entry-shell">
    <header className="entry-header"><Image src="/icash-x-logo.png" alt="iCash X" width={111} height={62} priority /><span>PRODUCT PREVIEW</span></header>
    <main className={started ? "entry-main is-running" : "entry-main"}>
      {!started ? <>
        <section className="entry-hero" aria-labelledby="entry-title">
          <span className="entry-eyebrow">AI FOR REAL ESTATE WHOLESALING</span>
          <h1 id="entry-title">Put your AI<br />to work.</h1>
          <p>Find properties. Talk to sellers. Work toward a deal. Your bot handles the steps.</p>
          <button className="entry-cta" onClick={start}>Try the bot free <ArrowRight size={20} /></button>
          <div className="entry-reassurance">Free demo • No sign-up • No card</div>
        </section>
      </> : <section className="guided-workspace" aria-label="Guided product preview">
        <div className="guided-heading"><button className="restart-link" onClick={start}><RotateCcw size={14}/> Restart example</button><span>FICTIONAL EXAMPLE</span></div>
        <div className="guided-card">
          <div className="guided-top"><span className="entry-avatar">X</span><div><strong>iCash X</strong><span>{finished ? "Example complete" : `Step ${move + 1} of 4`}</span></div><span className="example-tag">DEMO</span></div>
          {!finished ? <>
            <div className="guided-progress" aria-label={`Step ${move + 1} of 4`}>{moves.map((item,i)=><span key={item.name} className={i<=move ? "done" : ""}/>)}</div>
            <div className="guided-body" key={move} aria-live="polite">
              <h1>{moves[move].name}</h1>
              <p className="guided-copy">{moves[move].action(score)}</p>
              {"seller" in moves[move] && <div className="guided-quote"><span>SAMPLE SELLER</span><p>“{moves[move].seller}”</p></div>}
              <div className="guided-lesson"><Check size={17}/><span>{moves[move].lesson}</span></div>
            </div>
            <div className="guided-action"><button className="entry-cta dark" onClick={next}>{move === 3 ? "What happens next?" : "Continue"}<ArrowRight size={20}/></button><span>Go at your own pace.</span></div>
          </> : <div className="guided-finish">
            <span className="finish-icon"><Check size={26}/></span><h1>Now you get it.</h1><p>Your bot works. You watch the progress, set the budget, and stay in control.</p>
            <div className="free-summary"><strong>Start free.</strong><p>The live version will include a small allowance for real property research. No card needed.</p></div>
            <button className="entry-cta dark" disabled>Live free access opens soon <LockKeyhole size={17}/></button>
            <p className="connection-note">This preview is ready. Live accounts and property data are still being connected.</p>
            <div className="later-funding"><span>NEED MORE LATER?</span><strong>Fund your bot from {previewCreditPacks[0].label}.</strong><p>Only when you choose. The bot pauses at your limit.</p></div>
          </div>}
        </div>
        <p className="guided-disclosure">This example uses fictional people and deal outcomes. No seller is contacted. No earnings or deals are guaranteed.</p>
      </section>}
    </main>
    <footer className="entry-footer"><span>iCash X</span><Link href="/costs-and-disclosures">How credits work</Link></footer>
  </div>;
}
