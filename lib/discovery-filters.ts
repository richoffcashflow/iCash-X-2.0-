import {sharedLearningDecision,learningBounds} from './shared-learning.ts';
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
/** Confidence-adjusted resolved interest per settled customer cost. Pending
 * outcomes never increase yield; this observational score does not prove lift. */
export function discoveryInterestScore(s:DiscoveryFilterStat){
 const trials=s.attempted-s.pendingAttempts;
 if(trials<=0||s.costCents<=0||!s.costsComplete)return 0;
 return Math.max(0,learningBounds(s.interested,trials).lower*trials-0.5*s.optedOut)/s.costCents;
}
function localDiscoveryWinner(stats:DiscoveryFilterStat[]){
 if(stats.length<2||stats.some(s=>s.attempted-s.pendingAttempts<100||!s.costsComplete||s.costCents<=0))return undefined;
 const ranked=stats.map(s=>({stat:s,lower:discoveryInterestScore(s),
  upper:learningBounds(s.interested,s.attempted-s.pendingAttempts).upper*(s.attempted-s.pendingAttempts)/s.costCents}))
  .sort((a,b)=>b.lower-a.lower||a.stat.strategy.localeCompare(b.stat.strategy));
 const winner=ranked[0];
 return winner.stat.interested>=10&&winner.lower>0&&ranked.slice(1).every(s=>winner.lower>s.upper*1.05)?winner.stat:undefined;
}
/** Local and shared promotion require resolved evidence, complete costs and a
 * 95% cost-adjusted comparison. Otherwise balance the existing audiences.
 * Three duplicate/no-owner pages still earn periodic probes, not retirement. */
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
 const safety=sharedLearningDecision(shared,discoveryStrategies);
 const available=stats.filter(s=>!s.exhausted&&!s.blocked&&safety.allowedChoices.includes(s.strategy)
  &&!(s.attempted>=20&&s.optedOut>=3&&s.optedOut/s.attempted>0.05));
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
 const explorePool=probe?pool:cold.length?cold:pool;
 const localWinner=cold.length?undefined:localDiscoveryWinner(productive);
 const decision=sharedLearningDecision(shared,productive.map(s=>s.strategy));
 const sharedWinner=decision.status==='shared'?productive.find(s=>s.strategy===decision.winner):undefined;
 const winner=sharedWinner??localWinner;
 const learned=!!winner&&sequence%5<3;
 // Qualified winners do not also consume challenger slots. Cold-start and
 // duplicate-waste probes keep their existing preference among challengers.
 const preferredChallengers=winner?explorePool.filter(s=>s.strategy!==winner.strategy):explorePool;
 const otherChallengers=winner?pool.filter(s=>s.strategy!==winner.strategy):pool;
 const explore=balanced(preferredChallengers.length?preferredChallengers:otherChallengers.length?otherChallengers:explorePool);
 const chosen=learned?winner!:explore;
 return {version:discoveryFilterVersion,strategy:chosen.strategy,providerPage:chosen.nextPage,mode:learned?'learned':'explore'};
}
/** Only a rejected FREE estimate can retire an unavailable test audience. */
export class DiscoveryFilterUnavailable extends Error{
 constructor(){super('DISCOVERY_FILTER_UNAVAILABLE');}
}
