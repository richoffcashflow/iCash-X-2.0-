"use client";
import { Check, Radio } from "lucide-react";
export type ActivityItem = { id:string; title:string; detail:string; stage:string; explanation?:string; conversation?:{speaker:string;message:string}[] };
/** Only persisted provider events may be supplied in live mode. */
export function ActivityFeed({events,mode,onInspect}:{events:ActivityItem[];mode:"demo"|"live";onInspect?:()=>void}) {
 const recent=[...events].reverse();
 const milestoneIds=new Set(["interest","contract","buyer_agreement","deposit","closed"]);
 const highlights=recent.filter(e=>milestoneIds.has(e.id)).slice(0,2);
 function rows(items:ActivityItem[]) {
  return <ol>{items.map(event=><li key={event.id} className="stream-event"><span className="stream-event-icon"><Check size={13}/></span><div><strong>{event.title}</strong><p>{event.detail}</p>{event.explanation && <details className="event-explainer" onToggle={e=>{if(e.currentTarget.open)onInspect?.();}}><summary>What does this mean?</summary><p>{event.explanation}</p></details>}{event.conversation && <details className="event-conversation" onToggle={e=>{if(e.currentTarget.open)onInspect?.();}}><summary>Read conversation</summary><div className="conversation-thread">{event.conversation.map((line,i)=><div key={i} className={line.speaker==="Seller"?"seller-line":"bot-line"}><span>{line.speaker}</span><p>{line.message}</p></div>)}</div>{mode==="demo" && <small>Fictional conversation. No seller is connected.</small>}</details>}</div></li>)}</ol>;
 }
 return <div className="activity-summary">
  {highlights.length>0 && <div className="milestone-list"><div className="stream-log-heading"><Radio size={13}/><span>{mode==="demo"?"SAMPLE MILESTONES":"MILESTONES"}</span></div>{rows(highlights)}</div>}
  <details className="activity-history" onToggle={e=>{if(e.currentTarget.open)onInspect?.();}}><summary>View all activity <span>{events.length}</span></summary><div className="stream-log" role="region" aria-label={mode==="demo"?"Sample activity history":"Live activity history"} tabIndex={0}>{rows(recent)}</div></details>
 </div>;
}
