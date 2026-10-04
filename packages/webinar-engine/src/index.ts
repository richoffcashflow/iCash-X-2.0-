/** Portable webinar decisions. No framework, database, brand, AI vendor or billing dependencies. */
export type Audience='all'|'day'|'night'|'returning';
export type WebinarDefinition={id:string;revision:number;status:'draft'|'published';audience:Audience;priority:number;videoUrl:string};
export type WatchHistory={webinar_id:string;revision:number;progress_seconds:number;completed_at:string|null;updated_at:string;created_at?:string};
export type OptimizerSettings={enabled:boolean;explorationPercent:number;minVisitors:number};
export type RoutingSettings={nightStartsAt:number;nightEndsAt:number};
export type TimelineMessage={id:string;at:number;name:string;text:string;kind:'host'|'replay'|'ai';variations?:string[]};
export function localHour(timezone:string,now=new Date()){try{return Number(new Intl.DateTimeFormat('en-US',{timeZone:timezone,hour:'numeric',hourCycle:'h23'}).format(now));}catch{return now.getUTCHours();}}
export function visitorTimezone(ipTimezone:string|null,browserTimezone:string){for(const zone of [ipTimezone,browserTimezone,'America/Chicago']){if(!zone)continue;try{new Intl.DateTimeFormat('en-US',{timeZone:zone});return zone;}catch{/* Try the browser, then the default. */}}return 'America/Chicago';}
export function sameLocalDay(value:string,timezone:string,now=new Date()){try{const f=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'});return f.format(new Date(value))===f.format(now);}catch{return false;}}
export function isNight(timezone:string,now=new Date(),routing={nightStartsAt:18,nightEndsAt:6}){const hour=localHour(timezone,now);return routing.nightStartsAt>routing.nightEndsAt?hour>=routing.nightStartsAt||hour<routing.nightEndsAt:hour>=routing.nightStartsAt&&hour<routing.nightEndsAt;}
export type ReturnSession=WatchHistory&{id:string;created_at:string;superseded_at:string|null;is_preview:boolean;max_seconds:number;offer_seen_at:string|null;config:{pitchAt:number}};
export type ReturnVisit={kind:'new'}|{kind:'resume'|'advance';sessionId:string}|{kind:'checkout';sessionId:string;until:string};
/** A fixed offer window never extends when someone refreshes or opens another tab. */
export function returnVisit(history:ReturnSession[],timezone:string,checkoutWindowHours=3,now=new Date()):ReturnVisit{
 const latest=[...history].filter(s=>!s.is_preview&&!s.superseded_at).sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.updated_at.localeCompare(a.updated_at))[0];
 if(!latest)return {kind:'new'};
 const timestamps=[latest.completed_at,...(latest.max_seconds>=latest.config.pitchAt?[latest.offer_seen_at]:[])].filter((v):v is string=>!!v).map(Date.parse).filter(t=>Number.isFinite(t)&&t<=now.getTime());
 if(timestamps.length){
  const started=Math.min(...timestamps),hours=Number.isFinite(checkoutWindowHours)?Math.min(72,Math.max(0,checkoutWindowHours)):3,until=started+hours*3600000;
  if(now.getTime()<until)return {kind:'checkout',sessionId:latest.id,until:new Date(until).toISOString()};
  return {kind:'advance',sessionId:latest.id};
 }
 return {kind:!latest.completed_at&&sameLocalDay(latest.updated_at,timezone,now)?'resume':'advance',sessionId:latest.id};
}
export type WebinarPerformance={webinar_id:string;revision:number;visitors:number;mature_visitors:number;purchases:number;value_cents:number;mature_value_cents:number;viewers?:number;buyers?:number;close_rate?:number};
export type Allocation={webinar_id:string;revision:number;share:number;valuePerVisitor:number;phase:'learning'|'optimizing'};
export function eligibleVariants<T extends WebinarDefinition>(webinars:T[],history:WatchHistory[],timezone:string,now=new Date(),routing={nightStartsAt:18,nightEndsAt:6}){
 const night=isNight(timezone,now,routing),seen=new Set(history.map(h=>h.webinar_id));
 const pool=webinars.filter(w=>w.status==='published'&&w.videoUrl&&(w.audience==='all'||w.audience===(night?'night':'day')||(seen.size>0&&w.audience==='returning')));
 const unseen=pool.filter(w=>!seen.has(w.id));
 const last=[...history].sort((a,b)=>(b.created_at??b.updated_at).localeCompare(a.created_at??a.updated_at))[0]?.webinar_id;
 const rotated=pool.length>1?pool.filter(w=>w.id!==last):pool,options=unseen.length?unseen:rotated;
 // A dedicated local-time session takes priority over the generic fallback.
 const timed=options.filter(w=>w.audience===(night?'night':'day'));
 return timed.length?timed:options;
}
export function allocation<T extends WebinarDefinition>(pool:T[],stats:WebinarPerformance[],settings:OptimizerSettings):Allocation[]{
 if(!pool.length)return [];
 const rows=pool.map(w=>({w,s:stats.find(s=>s.webinar_id===w.id&&s.revision===w.revision)}));
 const pooledVisitors=rows.reduce((n,r)=>n+(r.s?.mature_visitors??0),0),pooledValue=rows.reduce((n,r)=>n+(r.s?.mature_value_cents??0),0),prior=pooledVisitors?pooledValue/pooledVisitors:0;
 const learning=rows.some(r=>(r.s?.mature_visitors??0)<settings.minVisitors)||pooledValue===0||!settings.enabled;
 // Shrink noisy early results toward the pooled average; keep exploration for every variant.
 const scores=rows.map(r=>((r.s?.mature_value_cents??0)+prior*20)/((r.s?.mature_visitors??0)+20));
 const total=scores.reduce((n,v)=>n+v,0),exploration=settings.explorationPercent/100;
 return rows.map((r,n)=>({webinar_id:r.w.id,revision:r.w.revision,share:learning?1/pool.length:exploration/pool.length+(1-exploration)*scores[n]/total,valuePerVisitor:r.s?.mature_visitors?(r.s.mature_value_cents/r.s.mature_visitors)/100:0,phase:learning?'learning':'optimizing'}));
}
export function optimizedWebinar<T extends WebinarDefinition>(webinars:T[],history:WatchHistory[],timezone:string,stats:WebinarPerformance[],settings:OptimizerSettings,random=Math.random(),now=new Date(),routing={nightStartsAt:18,nightEndsAt:6}):T|null{
 const pool=eligibleVariants(webinars,history,timezone,now,routing),weights=allocation(pool,stats,settings);
 if(!settings.enabled)return [...pool].sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id))[0]??null;
 if(history.length){
  // Returning prospects advance to the strongest remaining eligible version.
  const ranked=[...weights].sort((a,b)=>b.share-a.share||(pool.find(w=>w.id===b.webinar_id)?.priority??0)-(pool.find(w=>w.id===a.webinar_id)?.priority??0)||a.webinar_id.localeCompare(b.webinar_id));
  return pool.find(w=>w.id===ranked[0]?.webinar_id)??null;
 }
 let pick=Math.max(0,Math.min(.999999999,random));
 for(const row of weights){pick-=row.share;if(pick<0)return pool.find(w=>w.id===row.webinar_id)!;}
 return pool.at(-1)??null;
}

function choice(seed:string,length:number){let hash=2166136261;for(const char of seed){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return (hash>>>0)%length;}
/** Persist the result as a session snapshot; never recompute it on a resume. */
export function freezeTimeline(chat:TimelineMessage[],sessionId:string,enabled:boolean,assistantName:string):TimelineMessage[]{
 return chat.map(({variations,...cue})=>{
  if(!enabled||cue.kind==='replay'||!variations?.length)return cue;
  return {...cue,text:variations[choice(sessionId+':'+cue.id,variations.length)],name:assistantName,kind:'ai'};
 });
}

export type TimedOffer={id:string;at:number;expiresAt:string|null};
/** Previously revealed offers stay available until their actual deadline. */
export function availableOffers<T extends TimedOffer>(offers:T[],seconds:number,now=Date.now()):T[]{
 return offers.filter(o=>o.at<=seconds&&(!o.expiresAt||Date.parse(o.expiresAt)>now)).sort((a,b)=>a.at-b.at);
}
export function selectOffer<T extends TimedOffer>(offers:T[],seconds:number,now=Date.now(),preferredId?:string|null):T|null{
 const available=availableOffers(offers,seconds,now);
 return available.find(o=>o.id===preferredId)??available.at(-1)??null;
}
export function splitDuration(seconds:number){const n=Math.max(0,Math.floor(Number.isFinite(seconds)?seconds:0));return {hours:Math.floor(n/3600),minutes:Math.floor(n%3600/60),seconds:n%60};}
export function changeDurationUnit(total:number,unit:'hours'|'minutes'|'seconds',value:number,max=14400){
 const parts=splitDuration(total);parts[unit]=Math.max(0,Math.min(unit==='hours'?Math.floor(max/3600):59,Math.floor(Number.isFinite(value)?value:0)));
 return Math.min(max,parts.hours*3600+parts.minutes*60+parts.seconds);
}
