"use client";

import { Check, Radio } from "lucide-react";

export type ActivityItem = { id: string; title: string; detail: string; stage: string; explanation?: string; conversation?: { speaker: string; message: string }[] };

/** Live callers must supply persisted, verified events. This view invents no events or balances. */
export function ActivityFeed({ events, mode, onInspect }: { events: ActivityItem[]; mode: "demo" | "live"; onInspect?: () => void }) {
  return <div className="stream-log" role="region" aria-label={mode === "demo" ? "Sample activity history" : "Live activity history"} tabIndex={0}>
    <div className="stream-log-heading"><Radio size={13}/><span>{mode === "demo" ? "SAMPLE ACTIVITY" : "ACTIVITY"}</span><span>{events.length} events</span></div>
    <ol>{[...events].reverse().map((event,index)=><li key={event.id} className={index === 0 ? "stream-event newest" : "stream-event"}><span className="stream-event-icon"><Check size={13}/></span><div><span className="stream-event-stage">{mode === "demo" ? "DEMO · " : ""}{event.stage}</span><strong>{event.title}</strong><p>{event.detail}</p>{event.explanation && <details className="event-explainer" onToggle={event=>{if(event.currentTarget.open)onInspect?.();}}><summary>What does this mean?</summary><p>{event.explanation}</p></details>}{event.conversation && <details className="event-conversation" onToggle={event=>{if(event.currentTarget.open)onInspect?.();}}><summary>Read conversation</summary><div className="conversation-thread">{event.conversation.map((line,i)=><div key={i} className={line.speaker === "Seller" ? "seller-line" : "bot-line"}><span>{mode === "demo" ? "SAMPLE · " : ""}{line.speaker}</span><p>{line.message}</p></div>)}</div>{mode === "demo" && <div className="conversation-handoff"><span>When live, you can take over here.</span><div><button disabled>Call seller</button><button disabled>Text seller</button></div><small>Demo only. No real seller is connected.</small></div>}</details>}</div></li>)}</ol>
  </div>;
}
