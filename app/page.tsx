"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, ChevronRight, House, LandPlot, Pause, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { previewCreditPacks } from "@/config/credit-packs";

type View = "home" | "activity" | "credits";

export default function Home() {
  const [view, setView] = useState<View>("home");
  const [kind, setKind] = useState<"houses" | "land">("houses");
  const [entity, setEntity] = useState<"individual" | "company">("individual");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [company, setCompany] = useState("");
  const [selectedPack, setSelectedPack] = useState(10000);
  const [showSampleAlert, setShowSampleAlert] = useState(false);
  const hasName = entity === "company" ? !!company.trim() : !!first.trim() && !!last.trim();

  return <div className="app-shell">
    <header className="topbar"><button className="brand" onClick={() => setView("home")} aria-label="iCash X home"><Image src="/icash-x-logo.png" alt="iCash X" width={120} height={68} priority /></button><span className="preview-tag">PREVIEW</span></header>
    <main className="main-area"><div className="workspace">
      {view === "home" && <>
        <div className="status-line"><span className="status-dot" /> OPERATION STATUS / STANDBY</div>
        <h1>Let's get a<br />deal moving.</h1>
        <p className="lead">Choose the deals you want. iCash X finds owners, reaches out to buy their property, works offers within your limits, finds buyers, and coordinates closing. You see every real milestone.</p>
        <div className="setup-card">
          <span className="field-label">I WANT DEALS ON</span>
          <div className="type-options" role="group" aria-label="Property type">
            <button className={kind === "houses" ? "type-option selected" : "type-option"} onClick={() => setKind("houses")} aria-pressed={kind === "houses"}><House size={22} /><span>Houses</span>{kind === "houses" && <Check size={18} />}</button>
            <button className={kind === "land" ? "type-option selected" : "type-option"} onClick={() => setKind("land")} aria-pressed={kind === "land"}><LandPlot size={22} /><span>Land</span>{kind === "land" && <Check size={18} />}</button>
          </div>
          <span className="field-label identity-label">NAME FOR YOUR CONTRACTS</span>
          <div className="entity-options" role="group" aria-label="Contract name type"><button className={entity === "individual" ? "active" : ""} onClick={() => setEntity("individual")} aria-pressed={entity === "individual"}>My name</button><button className={entity === "company" ? "active" : ""} onClick={() => setEntity("company")} aria-pressed={entity === "company"}>Company</button></div>
          {entity === "individual" ? <div className="name-fields"><label><span>First name</span><input value={first} onChange={e => setFirst(e.target.value)} autoComplete="given-name" placeholder="First name" /></label><label><span>Last name</span><input value={last} onChange={e => setLast(e.target.value)} autoComplete="family-name" placeholder="Last name" /></label></div> : <label className="company-field"><span>Legal company name</span><input value={company} onChange={e => setCompany(e.target.value)} autoComplete="organization" placeholder="Company name" /></label>}
          <Button className="primary-action" disabled={!hasName} onClick={() => setView("credits")}>Add credits & start <ArrowRight size={19} /></Button>
          <p className="form-note">Funding is disabled in this preview. No charges or calls can start.</p>
        </div>
        <div className="signal-card" aria-label="Current operation status"><div className="signal-top"><span>iCASH X / OUTBOUND ENGINE</span><span>01 — STANDBY</span></div><strong>Waiting for fuel.</strong><p>No calls or charges have started.</p><div className="signal-track">{["FIND", "TALK", "OFFER", "CONTRACT", "BUYER", "CLOSE"].map((step, index) => <span key={step}><i>{String(index + 1).padStart(2,"0")}</i>{step}</span>)}</div></div>
        <div className="below-card"><ShieldCheck size={18} /><span>You control the daily credit limit and can pause outreach anytime.</span></div>
        <button className="row-link" onClick={() => setView("activity")}><span>Activity <small>Real updates will appear here</small></span><ChevronRight size={20} /></button>
      </>}
      {view === "activity" && <><button className="back-link" onClick={() => setView("home")}>← Back</button><h1>Activity.</h1><div className="empty-card"><Pause size={23} /><h2>Nothing has run yet</h2><p>iCash X is paused. Properties, conversations, contracts, and closing milestones will appear only after they actually happen.</p></div><button className="sample-trigger" onClick={() => setShowSampleAlert(!showSampleAlert)}>{showSampleAlert ? "Hide sample" : "Preview a contract alert"} <ArrowRight size={16} /></button>{showSampleAlert && <div className="milestone-sample" role="status"><span className="sample-label">SAMPLE ONLY · NOT A LIVE DEAL</span><div className="milestone-burst">✦</div><p>REAL MILESTONE / 04</p><strong>DEAL UNDER<br />CONTRACT.</strong><span>The signed agreement is ready to view. iCash X is moving to buyer matching.</span></div>}</>}
      {view === "credits" && <><button className="back-link" onClick={() => setView("home")}>← Back</button><h1>What do you<br />want to work with?</h1><p className="lead">Pick an amount. You control how quickly iCash X uses it.</p><div className="empty-card credit-card"><span className="field-label">CHOOSE CREDITS</span><div className="pack-options">{previewCreditPacks.map(pack => <button key={pack.amountCents} className={selectedPack === pack.amountCents ? "pack selected" : "pack"} onClick={() => setSelectedPack(pack.amountCents)} aria-pressed={selectedPack === pack.amountCents}><strong>{pack.label}</strong><span>{pack.description}</span>{selectedPack === pack.amountCents && <Check size={18} />}</button>)}</div><div className="credit-summary"><span>Available now</span><strong>$0.00</strong></div><Button className="primary-action" disabled>Funding opens soon</Button><p className="form-note">Preview only. No payment or outreach will start.</p><Link className="document-link" href="/costs-and-disclosures">Costs & disclosures <ArrowRight size={16} /></Link></div></>}
    </div></main><footer><span>iCash X</span><span>© 2026</span></footer>
  </div>;
}
