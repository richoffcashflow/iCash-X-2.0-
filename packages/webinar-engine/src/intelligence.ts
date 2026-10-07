/** Portable, purchase-based webinar allocation. No browser, database or brand dependencies. */
export type IntelligenceArm = {key:string;webinarId:string;revision:number;version:'day'|'night';priority:number};
export type IntelligenceMetric = {
 ad_key:string;webinar_id:string;revision:number;recording_version:'day'|'night';
 visitors:number;mature_visitors:number;buyers:number;revenue_cents:number;checkouts:number;average_watch_seconds:number;
 learning_visitors:number;learning_buyers:number;learning_value_cents:number;learning_value_squares:number;
};
export type IntelligenceMode='learning'|'explore'|'winner'|'holdout'|'single'|'fallback';
export type IntelligenceSettings={enabled:boolean;explorationPercent:number;minVisitors:number};
export type IntelligenceStop={ad_key:string;arm_key:string;winner_key:string|null};
export type IntelligencePlan={phase:'waiting'|'learning'|'optimizing';source:'ad'|'shared';winnerKey:string|null;baselineKey:string|null;stoppedKeys:string[];newStops:IntelligenceStop[];shares:{key:string;share:number}[]};
export const intelligencePolicyVersion=1;
export const intelligenceHoldoutShare=.05;
const minimumBuyers=10;
const number=(v:number)=>Number.isFinite(Number(v))&&Number(v)>=0?Number(v):0;
export const armKey=(w:{id:string;revision:number;recordingVersion?:'day'|'night'})=>`${w.id}:${w.revision}:${w.recordingVersion??'day'}`;
export function adIdentity(attribution:Record<string,string>|undefined){
 const id=attribution?.ad_id||attribution?.utm_content||'';
 return /^\d{5,30}$/.test(id)?`ad:${id}`:'direct';
}
/** Stable control membership, independent of ad, local time, and return visits. */
export function intelligenceBucket(visitorId:string){
 let hash=2166136261;
 for(const c of `webinar-intelligence:${intelligencePolicyVersion}:${visitorId}`){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619);}
 return (hash>>>0)/4294967296;
}
function metric(arm:IntelligenceArm,rows:IntelligenceMetric[],adKey:string){return rows.find(r=>r.ad_key===adKey&&r.webinar_id===arm.webinarId&&Number(r.revision)===arm.revision&&r.recording_version===arm.version);}
function evidence(arms:IntelligenceArm[],rows:IntelligenceMetric[],adKey:string,minVisitors:number){
 const totalBuyers=rows.filter(r=>r.ad_key===adKey).reduce((n,r)=>n+number(r.learning_buyers),0);
 const totalValue=rows.filter(r=>r.ad_key===adKey).reduce((n,r)=>n+number(r.learning_value_cents),0);
 const purchaseValue=totalBuyers?totalValue/totalBuyers:0;
 // Use randomized traffic only. A 24-hour observation window is enforced by the adapter.
 // The conservative normal approximation is a promotion gate, not a claim of proven lift.
 return arms.flatMap(arm=>{
  const m=metric(arm,rows,adKey),n=number(m?.learning_visitors??0);
  if(n<minVisitors)return [];
  const value=number(m?.learning_value_cents??0),buyers=number(m?.learning_buyers??0);
  const mean=value/n,variance=Math.max(0,number(m?.learning_value_squares??0)/n-mean*mean);
  // Zero observed sales still have uncertainty; never give a zero-sale arm a zero-width bound.
  const error=1.96*Math.sqrt(Math.max(variance,purchaseValue*purchaseValue/(n+1))/n);
  return [{key:arm.key,mean,error,buyers}];
 }).sort((a,b)=>b.mean-a.mean||a.key.localeCompare(b.key));
}
export function intelligencePlan(arms:IntelligenceArm[],rows:IntelligenceMetric[],adKey:string,settings:IntelligenceSettings,savedStops:IntelligenceStop[]=[]):IntelligencePlan{
 const minVisitors=Math.max(20,number(settings.minVisitors)||100);
 const adRows=arms.map(a=>metric(a,rows,adKey));
 // Pool sparse ads within the same day/night and new/returning context.
 const useAd=adKey!=='*'&&(adRows.filter(r=>number(r?.learning_visitors??0)>=minVisitors).length>=2||savedStops.some(s=>s.ad_key===adKey));
 const source=useAd?'ad':'shared',sourceKey=useAd?adKey:'*';
 // Stops belong to this audience context (enforced by the adapter), ad and exact revision.
 // An ad with its own evidence can have a different winner from the shared audience.
 const applicable=settings.enabled?savedStops.filter(s=>s.ad_key===adKey||(!useAd&&s.ad_key==='*')):[];
 const stopped=new Set(applicable.filter(s=>arms.some(a=>a.key===s.arm_key)).map(s=>s.arm_key));
 const candidates=settings.enabled?evidence(arms,rows,sourceKey,minVisitors):[];
 const leader=candidates.find(c=>!stopped.has(c.key));
 const newStops:IntelligenceStop[]=[];
 if(leader&&leader.buyers>=minimumBuyers)for(const other of candidates){
  if(other.key!==leader.key&&!stopped.has(other.key)&&leader.mean-leader.error>other.mean+other.error){
   stopped.add(other.key);newStops.push({ad_key:sourceKey,arm_key:other.key,winner_key:leader.key});
  }
 }
 const active=arms.filter(a=>!stopped.has(a.key));
 const baselineKey=[...active].sort((a,b)=>b.priority-a.priority||a.key.localeCompare(b.key))[0]?.key??null;
 const proven=leader&&leader.buyers>=minimumBuyers&&candidates.length>=2&&candidates.every(c=>c.key===leader.key||stopped.has(c.key))?leader.key:null;
 // Eliminating third place does not establish a winner between two tied leaders.
 for(const stop of newStops)stop.winner_key=proven;
 // Keep the established leader when old evidence leaves the reporting window. New
 // challengers still get a bounded test. Editing a revision starts fresh.
 const remembered=applicable.map(s=>s.winner_key).find(key=>key!==null&&active.some(a=>a.key===key))??null;
 const winnerKey=proven??remembered;
 const exploration=Math.min(.5,Math.max(.1,number(settings.explorationPercent)/100));
 const holdout=intelligenceHoldoutShare;
 const shares=arms.map(a=>({key:a.key,share:stopped.has(a.key)?0:active.length===1?1:(a.key===baselineKey?holdout:0)+(winnerKey?exploration/active.length+(a.key===winnerKey?1-holdout-exploration:0):(1-holdout)/active.length)}));
 return {phase:winnerKey?'optimizing':active.length<2?'waiting':'learning',source,winnerKey,baselineKey,stoppedKeys:[...stopped],newStops,shares};
}
/** Log conditional selection probability for later audit; keep all trials randomized. */
export function intelligenceChoice(arms:IntelligenceArm[],plan:IntelligencePlan,visitorBucket:number,random:number,settings:IntelligenceSettings):{arm:IntelligenceArm;mode:IntelligenceMode;probability:number}|null{
 arms=arms.filter(a=>!plan.stoppedKeys.includes(a.key));
 if(!arms.length)return null;
 if(arms.length===1)return {arm:arms[0],mode:'single',probability:1};
 const baseline=arms.find(a=>a.key===plan.baselineKey)??arms[0];
 if(visitorBucket<intelligenceHoldoutShare)return {arm:baseline,mode:'holdout',probability:1};
 const pick=Math.max(0,Math.min(.999999999,Number.isFinite(random)?random:0));
 if(!plan.winnerKey)return {arm:arms[Math.floor(pick*arms.length)],mode:'learning',probability:1/arms.length};
 const exploration=Math.min(.5,Math.max(.1,number(settings.explorationPercent)/100))/(1-intelligenceHoldoutShare);
 if(pick<exploration)return {arm:arms[Math.min(arms.length-1,Math.floor(pick/exploration*arms.length))],mode:'explore',probability:1/arms.length};
 return {arm:arms.find(a=>a.key===plan.winnerKey)??baseline,mode:'winner',probability:1};
}
