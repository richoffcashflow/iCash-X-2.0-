"use client";
import { useRef, useState } from "react";
import { Check } from "lucide-react";
export type ActivityItem = { id:string; emoji?:string; title:string; detail:string; stage:string; explanation?:string; conversation?:{speaker:string;message:string}[] };
const PAGE_SIZE=20;
/** Only persisted provider events may be supplied in live mode.
 * Keep the home view compact and never mount an unbounded activity history.
 * Snapshot on open so incoming activity cannot shift the text being read.
 */
export function ActivityFeed({events,mode,onInspect}:{events:ActivityItem[];mode:"demo"|"live";onInspect?:()=>void}) {
 const [snapshot,setSnapshot]=useState<ActivityItem[]|null>(null);
 const [page,setPage]=useState(0);
 const log=useRef<HTMLDivElement>(null);
 function changePage(next:number){setPage(next);log.current?.scrollTo({top:0});}
 const rows=snapshot?.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE)??[];
 return <div className="activity-summary">
  <details className="activity-history" onToggle={e=>{if(e.target!==e.currentTarget)return;if(e.currentTarget.open){setSnapshot([...events].reverse());setPage(0);onInspect?.();}else{setSnapshot(null);setPage(0);}}}>
   <summary>Activity history <span>{events.length}</span></summary>
   {snapshot&&<div className="history-content"><div ref={log} className="stream-log" role="region" aria-label={mode==="demo"?"Test activity history":"Live activity history"} tabIndex={0}><ol>{rows.map(event=><li key={event.id} className="stream-event"><span className={`stream-event-icon ${event.emoji?"activity-emoji":""}`} aria-hidden="true">{event.emoji??<Check size={13}/>}</span><div><strong>{event.title}</strong><p>{event.detail}</p>{event.explanation&&<details className="event-explainer"><summary>What does this mean?</summary><p>{event.explanation}</p></details>}{event.conversation&&<details className="event-conversation"><summary>Read conversation</summary><div className="conversation-thread">{event.conversation.map((line,i)=><div key={i} className={line.speaker==="Seller"?"seller-line":"bot-line"}><span>{line.speaker}</span><p>{line.message}</p></div>)}</div>{mode==="demo"&&<small>Fictional conversation. No seller is connected.</small>}</details>}</div></li>)}</ol></div>
   {snapshot.length>PAGE_SIZE&&<nav className="history-pages" aria-label="Activity pages"><button disabled={page===0} onClick={()=>changePage(page-1)}>Newer</button><span aria-live="polite">{page*PAGE_SIZE+1}–{Math.min((page+1)*PAGE_SIZE,snapshot.length)} of {snapshot.length}</span><button disabled={(page+1)*PAGE_SIZE>=snapshot.length} onClick={()=>changePage(page+1)}>Older</button></nav>}
   </div>}
  </details>
 </div>;
}
