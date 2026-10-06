/** Portable, purchase-based webinar allocation. No browser, database or brand dependencies. */
export type IntelligenceArm = {key:string;webinarId:string;revision:number;version:'day'|'night';priority:number};
export type IntelligenceMetric = {
 ad_key:string;webinar_id:string;revision:number;recording_version:'day'|'night';
 visitors:number;mature_visitors:number;buyers:number;revenue_cents:number;checkouts:number;average_watch_seconds:number;
 learning_visitors:number;learning_buyers:number;learning_value_cents:number;learning_value_squares:number;
};
export type IntelligenceMode='learning'|'explore'|'winner'|'holdout'|'single'|'fallback';
export type IntelligenceSettings={enabled:boolean;explorationPercent:number;minVisitors:number};
export type IntelligencePlan={phase:'waiting'|'learning'|'optimizing';source:'ad'|'shared';winnerKey:string|null;baselineKey:string|null;shares:{key:string;share:number}[]};
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
function confidentWinner(arms:IntelligenceArm[],rows:IntelligenceMetric[],adKey:string,minVisitors:number){
 const totalBuyers=rows.filter(r=>r.ad_key===adKey).reduce((n,r)=>n+number(r.learning_buyers),0);
 const totalValue=rows.filter(r=>r.ad_key===adKey).reduce((n,r)=>n+number(r.learning_value_cents),0);
 const purchaseValue=totalBuyers?totalValue/totalBuyers:0;
 // Use randomized traffic only. A 24-hour observation window is enforced by the adapter.
 // The conservative normal approximation is a promotion gate, not a claim of proven lift.
 const candidates=arms.flatMap(arm=>{
  const m=metric(arm,rows,adKey),n=number(m?.learning_visitors??0);
  if(n<minVisitors)return [];
  const value=number(m?.learning_value_cents??0),buyers=number(m?.learning_buyers??0);
  const mean=value/n,variance=Math.max(0,number(m?.learning_value_squares??0)/n-mean*mean);
  // Zero observed sales still have uncertainty; never give a zero-sale arm a zero-width bound.
  const error=1.96*Math.sqrt(Math.max(variance,purchaseValue*purchaseValue/(n+1))/n);
  return [{key:arm.key,mean,error,buyers}];
 }).sort((a,b)=>b.mean-a.mean||a.key.localeCompare(b.key));
 if(candidates.length<2||candidates[0].buyers<minimumBuyers)return null;
 const leader=candidates[0];
 return candidates.slice(1).every(r=>leader.mean-leader.error>r.mean+r.error)?leader.key:null;
}
export function intelligencePlan(arms:IntelligenceArm[],rows:IntelligenceMetric[],adKey:string,settings:IntelligenceSettings):IntelligencePlan{
 const sorted=[...arms].sort((a,b)=>b.priority-a.priority||a.key.localeCompare(b.key));
 const baselineKey=sorted[0]?.key??null;
 if(arms.length<2)return {phase:'waiting',source:'shared',winnerKey:null,baselineKey,shares:arms.map(a=>({key:a.key,share:1}))};
 const minVisitors=Math.max(20,number(settings.minVisitors)||100);
 const adRows=arms.map(a=>metric(a,rows,adKey));
 // Pool sparse ads within the same day/night and new/returning context.
 const useAd=adKey!=='*'&&adRows.filter(r=>number(r?.learning_visitors??0)>=minVisitors).length>=2;
 const source=useAd?'ad':'shared',sourceKey=useAd?adKey:'*';
 const winnerKey=settings.enabled?confidentWinner(arms,rows,sourceKey,minVisitors):null;
 const exploration=Math.min(.5,Math.max(.1,number(settings.explorationPercent)/100));
 const holdout=intelligenceHoldoutShare;
 const shares=arms.map(a=>({key:a.key,share:(a.key===baselineKey?holdout:0)+(winnerKey?exploration/arms.length+(a.key===winnerKey?1-holdout-exploration:0):(1-holdout)/arms.length)}));
 return {phase:winnerKey?'optimizing':'learning',source,winnerKey,baselineKey,shares};
}
/** Log conditional selection probability for later audit; keep all trials randomized. */
export function intelligenceChoice(arms:IntelligenceArm[],plan:IntelligencePlan,visitorBucket:number,random:number,settings:IntelligenceSettings):{arm:IntelligenceArm;mode:IntelligenceMode;probability:number}|null{
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
