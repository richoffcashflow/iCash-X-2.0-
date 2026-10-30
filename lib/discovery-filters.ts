import {sharedLearningStats,sharedEvidenceReady,learningObjective,learningScore} from './shared-learning.ts';
/** Reviewed property audiences only. Learning can allocate work, never invent filters. */
export const discoveryFilterVersion='seller-filters-v1';
export const discoveryStrategies=['baseline','vacant','absentee','repairs'] as const;
export type DiscoveryStrategy=typeof discoveryStrategies[number];
export type DiscoveryFilterPlan={version:typeof discoveryFilterVersion;strategy:DiscoveryStrategy;providerPage:number;mode:'explore'|'learned'};
export type DiscoveryFilterStat={strategy:DiscoveryStrategy;nextPage:number;exhausted:boolean;blocked?:boolean;pages:number;attempted:number;matureAttempts:number;pendingAttempts:number;interested:number;optedOut:number;costCents:number;costsComplete:boolean;recentUnproductivePages:number};
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
export function discoveryFilterPlanValid(p:unknown):p is DiscoveryFilterPlan{
 if(!p||typeof p!=='object')return false;
 const x=p as DiscoveryFilterPlan;
 return x.version===discoveryFilterVersion&&discoveryStrategies.includes(x.strategy)&&integer(x.providerPage)&&x.providerPage>0&&['explore','learned'].includes(x.mode);
}
export function discoveryFilters(strategy:DiscoveryStrategy='baseline'){
 const filters:Record<string,unknown>[]=[{filter_id:'property_type',operator:'contains_any',value:[1]},{filter_id:'estimated_equity_percentage',operator:'greater_than_or_equal',value:70}];
 if(strategy==='vacant')filters.push({filter_id:'is_vacant_home',value:true});
 else if(strategy==='absentee')filters.push({filter_id:'has_absentee_owners',value:true});
 else if(strategy==='repairs')filters.push({filter_id:'estimated_repair_cost',operator:'greater_than_or_equal',value:25000});
 else if(strategy!=='baseline')throw Error('DISCOVERY_FILTER_INVALID');
 return filters;
}
/** Shrink small samples using the Wilson lower endpoint (z=1.645).
 * This is an allocation heuristic, not a significance test on adaptive samples.
 * Unanswered young attempts remain pending; only confirmed interest earns reward.
 */
export function discoveryInterestScore(s:DiscoveryFilterStat){
 if(s.attempted===0||s.costCents<=0||!s.costsComplete)return 0;
 const n=s.attempted,p=s.interested/n,z=1.645,z2=z*z;
 const lower=(p+z2/(2*n)-z*Math.sqrt(p*(1-p)/n+z2/(4*n*n)))/(1+z2/n);
 return Math.max(0,lower*n-0.5*s.optedOut)/(s.costCents+1000);
}
/** Use confirmed positives immediately, without waiting for every other arm.
 * Ten attempts and three interested properties can earn 40% learned slots;
 * 30 resolved attempts can earn 60%. The rest continue exploring.
 * Three settled duplicate/no-owner pages reduce an arm to periodic probes.
 * Shared evidence pools comparable ZIPs; cursors, costs and permissions stay owned.
 */
export function selectDiscoveryFilter(raw:unknown,sequence:number,shared:unknown=[]):DiscoveryFilterPlan|null{
 if(!integer(sequence)||sequence<1||!Array.isArray(raw)||raw.length!==4)throw Error('DISCOVERY_FILTER_STATE_INVALID');
 const seen=new Set<string>();
 const stats=raw.map((row):DiscoveryFilterStat=>{
  if(!row||typeof row!=='object')throw Error('DISCOVERY_FILTER_STATE_INVALID');
  const s=row as DiscoveryFilterStat;
  if(!discoveryStrategies.includes(s.strategy)||seen.has(s.strategy)||![s.nextPage,s.pages,s.attempted,s.matureAttempts,s.pendingAttempts,s.interested,s.optedOut,s.costCents,s.recentUnproductivePages].every(integer)||s.nextPage<1||typeof s.exhausted!=='boolean'||typeof s.costsComplete!=='boolean'||s.matureAttempts>s.attempted||s.pendingAttempts>s.attempted-s.matureAttempts||s.interested+s.optedOut>s.attempted-s.pendingAttempts||s.attempted-s.pendingAttempts>s.matureAttempts+s.interested+s.optedOut||s.recentUnproductivePages>3)throw Error('DISCOVERY_FILTER_STATE_INVALID');
  if(s.blocked!==undefined&&typeof s.blocked!=='boolean')throw Error('DISCOVERY_FILTER_STATE_INVALID');
  seen.add(s.strategy);return s;
 });
 const available=stats.filter(s=>!s.exhausted&&!s.blocked);
 if(!available.length)return null;
 const rotation=sequence%4;
 const tie=(s:DiscoveryFilterStat)=>(discoveryStrategies.indexOf(s.strategy)-rotation+4)%4;
 const balanced=(pool:DiscoveryFilterStat[])=>[...pool].sort((a,b)=>a.pages-b.pages||tie(a)-tie(b))[0];
 const productive=available.filter(s=>s.recentUnproductivePages<3);
 const cooled=available.filter(s=>s.recentUnproductivePages===3);
 // Market-level duplicate evidence survives a new account/revision. A fresh
 // cursor must not promote a known duplicate-only audience back to cold start.
 const cold=productive.filter(s=>s.pages===0);
 // One in five slots probes cooled arms. Never permanently discard a market.
 const probe=sequence%5===4&&cooled.length>0;
 const pool=probe?cooled:productive.length?productive:available;
 const explore=balanced(probe?pool:cold.length?cold:pool);
 const localWinner=cold.length?null:[...productive].filter(s=>s.attempted>=10&&s.interested>=3&&discoveryInterestScore(s)>0)
  .sort((a,b)=>discoveryInterestScore(b)-discoveryInterestScore(a)||tie(a)-tie(b))[0];
 const evidence=sharedLearningStats(shared).filter(s=>productive.some(p=>p.strategy===s.variant)&&sharedEvidenceReady(s)&&s.costs_complete&&s.effective_cost_cents>0);
 const objective=learningObjective(evidence);
 const value=(s:typeof evidence[number])=>Math.max(0,learningScore(s,objective)*s.effective_attempts-0.5*s.effective_opted_out)/(s.effective_cost_cents+1000);
 const peer=evidence.length>=2?[...evidence].sort((a,b)=>value(b)-value(a)||a.variant.localeCompare(b.variant))[0]:undefined;
 const sharedWinner=peer&&value(peer)>0?productive.find(s=>s.strategy===peer.variant):undefined;
 const winner=sharedWinner??localWinner;
 const learnedSlots=sharedWinner||winner&&winner.attempted-winner.pendingAttempts>=30?3:2;
 const learned=!!winner&&sequence%5<learnedSlots;
 const chosen=learned?winner!:explore;
 return {version:discoveryFilterVersion,strategy:chosen.strategy,providerPage:chosen.nextPage,mode:learned?'learned':'explore'};
}
/** Only a rejected FREE estimate can retire an unavailable test audience. */
export class DiscoveryFilterUnavailable extends Error{
 constructor(){super('DISCOVERY_FILTER_UNAVAILABLE');}
}
