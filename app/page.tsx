"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, ChevronRight, House, LandPlot, Pause, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

type View = "home" | "activity" | "credits";

export default function Home() {
  const [view, setView] = useState<View>("home");
  const [kind, setKind] = useState<"houses" | "land">("houses");
  const [entity, setEntity] = useState<"individual" | "company">("individual");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [company, setCompany] = useState("");
  const hasName = entity === "company" ? !!company.trim() : !!first.trim() && !!last.trim();

  return <div className="app-shell">
    <header className="topbar"><button className="brand" onClick={() => setView("home")} aria-label="iCash X home"><Image src="/icash-x-logo.png" alt="iCash X" width={120} height={68} priority /></button><span className="preview-tag">PREVIEW</span></header>
    <main className="main-area"><div className="workspace">
      {view === "home" && <>
        <div className="status-line"><span className="status-dot" /> PAUSED · NO CREDITS ADDED</div>
        <h1>Let's get a<br />deal moving.</h1>
        <p className="lead">Pick what you want. Add credits. iCash X handles the outbound work and shows you real progress.</p>
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
        <div className="below-card"><ShieldCheck size={18} /><span>You control the daily credit limit and can pause outreach anytime.</span></div>
        <button className="row-link" onClick={() => setView("activity")}><span>Activity <small>Real updates will appear here</small></span><ChevronRight size={20} /></button>
      </>}
      {view === "activity" && <><button className="back-link" onClick={() => setView("home")}>← Back</button><h1>Activity.</h1><div className="empty-card"><Pause size={23} /><h2>Nothing has run yet</h2><p>iCash X is paused. Properties, conversations, contracts, and closing milestones will appear only after they actually happen.</p></div></>}
      {view === "credits" && <><button className="back-link" onClick={() => setView("home")}>← Back</button><h1>Fund iCash X.</h1><div className="empty-card"><strong className="balance">$0.00</strong><p>Available credits</p><div className="divider" /><h2>Funding opens soon</h2><p>The proposed first pack is $100. Before paying, you'll see exact credit rates, your daily limit, and terms. This preview cannot charge you or start outreach.</p><Link className="document-link" href="/costs-and-disclosures">Costs & disclosures <ArrowRight size={16} /></Link></div></>}
    </div></main><footer><span>iCash X</span><span>© 2026</span></footer>
  </div>;
}
