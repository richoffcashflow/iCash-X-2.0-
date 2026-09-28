"use client";

import { Check, Radio } from "lucide-react";

export type ActivityItem = { id: string; title: string; detail: string; stage: string };

/** Live callers must supply persisted, verified events. This view invents no events or balances. */
export function ActivityFeed({ events, mode }: { events: ActivityItem[]; mode: "demo" | "live" }) {
  return <div className="stream-log" role="region" aria-label={mode === "demo" ? "Sample activity history" : "Live activity history"} tabIndex={0}>
    <div className="stream-log-heading"><Radio size={13}/><span>{mode === "demo" ? "SAMPLE ACTIVITY" : "ACTIVITY"}</span><span>{events.length} events</span></div>
    <ol>{[...events].reverse().map((event,index)=><li key={event.id} className={index === 0 ? "stream-event newest" : "stream-event"}><span className="stream-event-icon"><Check size={13}/></span><div><span className="stream-event-stage">{mode === "demo" ? "DEMO · " : ""}{event.stage}</span><strong>{event.title}</strong><p>{event.detail}</p></div></li>)}</ol>
  </div>;
}
