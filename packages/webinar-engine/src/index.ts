/** Portable webinar decisions. No framework, database, brand, AI vendor or billing dependencies. */
export type Audience='all'|'day'|'night'|'returning';
export type WebinarDefinition={id:string;revision:number;status:'draft'|'published';audience:Audience;priority:number;videoUrl:string};
export type WatchHistory={webinar_id:string;revision:number;progress_seconds:number;completed_at:string|null;updated_at:string;created_at?:string};
export type OptimizerSettings={enabled:boolean;explorationPercent:number;minVisitors:number};
export type RoutingSettings={nightStartsAt:number;nightEndsAt:number};
export type ViewerLocation={latitude:number;longitude:number};
export type TimelineMessage={id:string;at:number;name:string;text:string;kind:'host'|'replay'|'ai';variations?:string[]};
export function localHour(timezone:string,now=new Date()){try{return Number(new Intl.DateTimeFormat('en-US',{timeZone:timezone,hour:'numeric',hourCycle:'h23'}).format(now));}catch{return now.getUTCHours();}}
export function visitorTimezone(ipTimezone:string|null,browserTimezone:string){for(const zone of [ipTimezone,browserTimezone,'America/Chicago']){if(!zone)continue;try{new Intl.DateTimeFormat('en-US',{timeZone:zone});return zone;}catch{/* Try the browser, then the default. */}}return 'America/Chicago';}
export function sameLocalDay(value:string,timezone:string,now=new Date()){try{const f=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'});return f.format(new Date(value))===f.format(now);}catch{return false;}}
/** Approximate sunrise/sunset at this instant, including seasonal and polar daylight.
 * NOAA solar-position equations: https://gml.noaa.gov/grad/solcalc/solareqns.PDF
 * UTC inputs avoid local-date and DST ambiguity. No remote lookup is required.
 */
export function solarNight(location:ViewerLocation|null|undefined,now=new Date()):boolean|null{
 if(!location||!Number.isFinite(location.latitude)||Math.abs(location.latitude)>90||!Number.isFinite(location.longitude)||Math.abs(location.longitude)>180||!Number.isFinite(now.getTime()))return null;
 const year=now.getUTCFullYear(),start=Date.UTC(year,0,1),days=(Date.UTC(year+1,0,1)-start)/86400000;
 const gamma=2*Math.PI/days*((now.getTime()-start)/86400000-.5),radians=Math.PI/180;
 const equation=229.18*(.000075+.001868*Math.cos(gamma)-.032077*Math.sin(gamma)-.014615*Math.cos(2*gamma)-.040849*Math.sin(2*gamma));
 const declination=.006918-.399912*Math.cos(gamma)+.070257*Math.sin(gamma)-.006758*Math.cos(2*gamma)+.000907*Math.sin(2*gamma)-.002697*Math.cos(3*gamma)+.00148*Math.sin(3*gamma);
 const minutes=now.getUTCHours()*60+now.getUTCMinutes()+now.getUTCSeconds()/60+now.getUTCMilliseconds()/60000;
 const hourAngle=((minutes+equation+4*location.longitude)/4-180)*radians,latitude=location.latitude*radians;
 const cosineZenith=Math.sin(latitude)*Math.sin(declination)+Math.cos(latitude)*Math.cos(declination)*Math.cos(hourAngle);
 // The solar disk and atmospheric refraction put sunrise/sunset at 90.833°.
 return cosineZenith<Math.cos(90.833*radians);
}
export function isNight(timezone:string,now=new Date(),routing:RoutingSettings={nightStartsAt:18,nightEndsAt:6},location?:ViewerLocation|null){
 const solar=solarNight(location,now);if(solar!==null)return solar;
 const hour=localHour(timezone,now);return routing.nightStartsAt>routing.nightEndsAt?hour>=routing.nightStartsAt||hour<routing.nightEndsAt:hour>=routing.nightStartsAt&&hour<routing.nightEndsAt;
}
export type ReturnSession=WatchHistory&{id:string;created_at:string;superseded_at:string|null;is_preview:boolean;max_seconds:number;offer_seen_at:string|null;config:{pitchAt:number}};
export type ReturnVisit={kind:'new'}|{kind:'resume'|'advance';sessionId:string}|{kind:'checkout';sessionId:string;until:string};
/** A fixed offer window never extends when someone refreshes or opens another tab. */
export function returnVisit(history:ReturnSession[],timezone:string,checkoutWindowHours=8,now=new Date()):ReturnVisit{
 const latest=[...history].filter(s=>!s.is_preview&&!s.superseded_at).sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.updated_at.localeCompare(a.updated_at))[0];
 if(!latest)return {kind:'new'};
 // Completion starts its own full window, even when the offer appeared earlier.
 const completion=latest.completed_at?Date.parse(latest.completed_at):NaN;
 const timestamps=Number.isFinite(completion)&&completion<=now.getTime()?[completion]:(latest.max_seconds>=latest.config.pitchAt&&latest.offer_seen_at?[Date.parse(latest.offer_seen_at)]:[]).filter(t=>Number.isFinite(t)&&t<=now.getTime());
 if(timestamps.length){
  const started=Math.min(...timestamps),hours=Number.isFinite(checkoutWindowHours)?Math.min(72,Math.max(0,checkoutWindowHours)):8,until=started+hours*3600000;
  if(now.getTime()<until)return {kind:'checkout',sessionId:latest.id,until:new Date(until).toISOString()};
  return {kind:'advance',sessionId:latest.id};
 }
 return {kind:!latest.completed_at&&sameLocalDay(latest.updated_at,timezone,now)?'resume':'advance',sessionId:latest.id};
}
/** Only this arrival's explicit paid-ad tags qualify; saved attribution is not an arrival. */
export function paidAdArrival(attribution:Record<string,string>={}){
 return /^\d{5,30}$/.test(attribution.ad_id??'')||!!attribution.utm_source?.trim()&&/^(paid[_ -]?social|paid|cpc|ppc|cpv|display)$/i.test(attribution.utm_medium??'');
}
export type ConfirmedWatch={is_preview:boolean;completed_at:string|null;watched_seconds?:number;config:{durationSeconds:number}};
/** Opening a page or seeking to the ending does not confirm that it was watched. */
export function confirmedWatch(session:ConfirmedWatch,now=new Date()){
 const completed=session.completed_at?Date.parse(session.completed_at):NaN;
 return !session.is_preview&&Number.isFinite(completed)&&completed<=now.getTime()&&Number.isFinite(session.config.durationSeconds)&&session.config.durationSeconds>0&&Number.isFinite(session.watched_seconds)&&(session.watched_seconds??0)>=session.config.durationSeconds*.9;
}
export type ConversionRecording={webinarId:string;version:'day'|'night';viewers:number;cohortBuyers:number};
export type ConversionCandidate={id:string;publicCode?:string|null;recordingVersion:'day'|'night'};
export function stableWebinarOrder(a:ConversionCandidate,b:ConversionCandidate){return Number(a.publicCode??Number.MAX_SAFE_INTEGER)-Number(b.publicCode??Number.MAX_SAFE_INTEGER)||a.id.localeCompare(b.id);}
/** Observed paid close rate, never randomized traffic or a Meta spending decision. */
export function bestConvertingWebinar<T extends ConversionCandidate>(pool:T[],stats:ConversionRecording[]):T|null{
 const ranked=pool.flatMap(webinar=>{const row=stats.find(s=>s.webinarId===webinar.id&&s.version===webinar.recordingVersion);return row&&Number.isFinite(row.viewers)&&Number.isFinite(row.cohortBuyers)&&row.viewers>=20&&row.cohortBuyers>=1&&row.cohortBuyers<=row.viewers?[{webinar,rate:row.cohortBuyers/row.viewers,viewers:row.viewers}]:[];});
 ranked.sort((a,b)=>b.rate-a.rate||b.viewers-a.viewers||stableWebinarOrder(a.webinar,b.webinar));
 return ranked[0]?.webinar??null;
}
export type WebinarPerformance={webinar_id:string;revision:number;visitors:number;mature_visitors:number;purchases:number;value_cents:number;mature_value_cents:number;viewers?:number;buyers?:number;close_rate?:number};
export type Allocation={webinar_id:string;revision:number;share:number;valuePerVisitor:number;phase:'learning'|'optimizing'};
export function eligibleVariants<T extends WebinarDefinition>(webinars:T[],history:WatchHistory[],timezone:string,now=new Date(),routing={nightStartsAt:18,nightEndsAt:6}){
 const night=isNight(timezone,now,routing),seen=new Set(history.map(h=>h.webinar_id));
 const published=webinars.filter(w=>w.status==='published'&&w.videoUrl),period=night?'night':'day';
 // Until the other time-of-day recording is published, the available one runs both.
 const hasMatching=published.some(w=>w.audience===period);
 const pool=published.filter(w=>w.audience==='all'||w.audience===period||(!hasMatching&&w.audience===(night?'day':'night'))||(seen.size>0&&w.audience==='returning'));
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

export type AudienceDisplay={mode:'actual'|'fixed'|'simulated';fixedCount:number;minimum:number;maximum:number};
/** A labeled simulation, stable for a session and playback position. Never used for analytics. */
export function simulatedAudience(config:AudienceDisplay,sessionId:string,seconds:number,durationSeconds=1800):number|null{
 if(config.mode==='actual')return null;
 const bounded=(n:number)=>Math.max(0,Math.min(100000,Math.floor(Number.isFinite(n)?n:0)));
 // Keep the saved `fixed` mode and field compatible: the number is now a target.
 if(config.mode==='fixed'){
  const target=bounded(config.fixedCount);
  const duration=Number.isFinite(durationSeconds)&&durationSeconds>0?Math.max(10,durationSeconds):1800;
  const time=Math.max(0,Number.isFinite(seconds)?seconds:0),cadence=Math.max(1,Math.min(10,duration/60));
  const elapsed=time>=duration?duration:Math.floor(time/cadence)*cadence,progress=elapsed/duration;
  const seeded=(key:string)=>choice(sessionId+':target-audience:'+key,10001)/10000;
  const smooth=(value:number)=>{const n=Math.max(0,Math.min(1,value));return n*n*(3-2*n);};
  const start=.5+seeded('start')*.12,rampUntil=.18+seeded('ramp')*.08;
  const taperAt=.72+seeded('taper')*.08,finish=.72+seeded('finish')*.1;
  const trend=start+(1-start)*smooth(progress/rampUntil)-(1-finish)*smooth((progress-taperAt)/(1-taperAt));
  // Gentle arrivals and departures continue around the target between the ramp and taper.
  const position=elapsed/Math.min(90,duration/16),step=Math.floor(position);
  const from=seeded('wave:'+step)*2-1,to=seeded('wave:'+(step+1))*2-1;
  const variation=(from+(to-from)*smooth(position-step))*.04;
  return bounded(Math.round(target*trend*(1+variation)));
 }
 const low=bounded(config.minimum),high=Math.max(low,bounded(config.maximum));
 const position=Math.floor(Math.max(0,Number.isFinite(seconds)?seconds:0)/10)*10/120,step=Math.floor(position),fraction=position-step;
 const from=choice(sessionId+':audience:'+step,high-low+1),to=choice(sessionId+':audience:'+(step+1),high-low+1);
 return low+Math.round(from+(to-from)*fraction);
}
