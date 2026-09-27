"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, ChevronRight, House, LandPlot, Pause, Play, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

type View = "start" | "home" | "activity" | "credits";

export default function Home() {
  const [type, setType] = useState<"houses" | "land">("houses");
  const [market, setMarket] = useState("");
  const [view, setView] = useState<View>("start");

  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool?: (tool: object, options?: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(context.registerTool({
        name: "stage_icash_workspace",
        title: "Choose an iCash X market",
        description: "Choose Houses or Land and a market, then open the paused workspace preview. This does not start outreach or spend credits.",
        inputSchema: { type: "object", properties: { propertyType: { type: "string", enum: ["houses", "land"] }, market: { type: "string", minLength: 1, maxLength: 120 } }, required: ["propertyType", "market"], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input: unknown) {
          const value = input as { propertyType?: unknown; market?: unknown };
          if ((value.propertyType !== "houses" && value.propertyType !== "land") || typeof value.market !== "string" || !value.market.trim() || value.market.length > 120) throw new Error("Choose Houses or Land and enter a market.");
          setType(value.propertyType); setMarket(value.market.trim()); setView("home");
          return { status: "staged", liveOperations: false, market: value.market.trim(), propertyType: value.propertyType };
        },
      }, { signal: lifecycle.signal })).catch(() => {});
    } catch { /* Browsers without WebMCP still use the visible form. */ }
    return () => lifecycle.abort();
  }, []);

  return <div className="app-shell">
    <header className="topbar"><button className="brand" onClick={() => setView("start")} aria-label="iCash X home"><Image src="/icash-x-logo.png" alt="iCash X" width={132} height={75} priority /></button><span className="preview-tag">EARLY ACCESS PREVIEW</span></header>
    <main className="main-area">
      {view === "start" && <section className="start-view" aria-labelledby="start-title">
        <div className="intro"><div className="eyebrow"><span className="eyebrow-line" /> YOUR OPERATION, ONE TAP AWAY</div><h1 id="start-title">Put iCash X<br /><em>to work.</em></h1><p className="lead">Choose Houses or Land and your market. Once funded, iCash X works the outbound process for you.</p></div>
        <div className="selection-card"><span className="field-label">WHAT ARE YOU LOOKING FOR?</span><div className="type-options" role="group" aria-label="Property type">
          <button className={type === "houses" ? "type-option selected" : "type-option"} onClick={() => setType("houses")} aria-pressed={type === "houses"}><House size={25} strokeWidth={1.8} /><span>Houses</span><span className="option-check">{type === "houses" && <Check size={14} />}</span></button>
          <button className={type === "land" ? "type-option selected" : "type-option"} onClick={() => setType("land")} aria-pressed={type === "land"}><LandPlot size={25} strokeWidth={1.8} /><span>Land</span><span className="option-check">{type === "land" && <Check size={14} />}</span></button>
        </div><label className="field-label market-label" htmlFor="market">YOUR MARKET</label><input id="market" value={market} onChange={e => setMarket(e.target.value)} placeholder="City or ZIP code" autoComplete="address-level2" /><Button className="primary-action" disabled={!market.trim()} onClick={() => setView("home")}>Continue <ArrowRight size={19} /></Button><p className="form-note">Free to explore. No card needed.</p></div>
        <div className="trust-line"><ShieldCheck size={17} /> Your credits stay within an approved daily limit.</div>
      </section>}
      {view !== "start" && <section className="workspace" aria-label="iCash X workspace"><div className="workspace-head"><span className="eyebrow"><span className="eyebrow-line" /> {market.toUpperCase()} · {type.toUpperCase()}</span><button className="text-button" onClick={() => setView("start")}>Edit</button></div>
        {view === "home" && <><div className="status-card"><div className="status-top"><span className="status-pill"><span /> NOT STARTED</span><span className="status-icon"><Pause size={19} /></span></div><h1>Ready when<br /><em>you are.</em></h1><p>Add credits to give iCash X an approved budget. It will work within your daily limit and show each charge.</p><Button className="primary-action" onClick={() => setView("credits")}>Add credits & start <ArrowRight size={19} /></Button></div><div className="metrics"><div><strong>$0</strong><span>Credits available</span></div><div><strong>0</strong><span>Active opportunities</span></div><div><strong>0</strong><span>Needs you</span></div></div><button className="row-link" onClick={() => setView("activity")}><span>Activity <small>See what iCash X is doing</small></span><ChevronRight size={21} /></button><button className="row-link" onClick={() => setView("credits")}><span>Credits <small>Usage, balance, and limits</small></span><ChevronRight size={21} /></button></>}
        {view === "activity" && <><button className="back-link" onClick={() => setView("home")}>← Back</button><h1>Activity</h1><div className="empty-card"><Play size={23} /><h2>Nothing has run yet</h2><p>Real property and outreach events will appear here after setup. We never show made-up activity.</p><Button className="secondary-action" onClick={() => setView("credits")}>View credits</Button></div></>}
        {view === "credits" && <><button className="back-link" onClick={() => setView("home")}>← Back</button><h1>Credits</h1><div className="empty-card"><strong className="balance">$0.00</strong><p>Available balance</p><div className="divider" /><h2>Funding opens soon</h2><p>The proposed first pack is $100. You will see the exact credit charges and daily limit before paying. Payment is disabled in this preview.</p><Link className="document-link" href="/costs-and-disclosures">How credits and costs work →</Link></div></>}

      </section>}
    </main><footer>iCash X <span>© 2026</span></footer>
  </div>;
}
