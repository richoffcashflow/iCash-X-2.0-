/** Reviewed property audiences only. Learning can allocate work, never invent filters. */
export const discoveryFilterVersion='seller-filters-v1';
export const discoveryStrategies=['baseline','vacant','absentee','repairs'] as const;
export type DiscoveryStrategy=typeof discoveryStrategies[number];
export type DiscoveryFilterPlan={version:typeof discoveryFilterVersion;strategy:DiscoveryStrategy;providerPage:number;mode:'explore'|'learned'};
export type DiscoveryFilterStat={strategy:DiscoveryStrategy;nextPage:number;exhausted:boolean;pages:number;matureAttempts:number;interested:number;optedOut:number;costCents:number;costsComplete:boolean};
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
/** Balance cold-start batches. After 30 mature attempts per available group,
 * use 60% of batch slots for a supported winner and retain 40% exploration.
 * Samples and settled customer costs come from the same account and ZIP.
 */
export function selectDiscoveryFilter(raw:unknown,sequence:number):DiscoveryFilterPlan|null{
 if(!integer(sequence)||sequence<1||!Array.isArray(raw)||raw.length!==4)throw Error('DISCOVERY_FILTER_STATE_INVALID');
 const seen=new Set<string>();
 const stats=raw.map((row):DiscoveryFilterStat=>{
  if(!row||typeof row!=='object')throw Error('DISCOVERY_FILTER_STATE_INVALID');
  const s=row as DiscoveryFilterStat;
  if(!discoveryStrategies.includes(s.strategy)||seen.has(s.strategy)||![s.nextPage,s.pages,s.matureAttempts,s.interested,s.optedOut,s.costCents].every(integer)||s.nextPage<1||typeof s.exhausted!=='boolean'||typeof s.costsComplete!=='boolean'||s.interested>s.matureAttempts||s.optedOut>s.matureAttempts)throw Error('DISCOVERY_FILTER_STATE_INVALID');
  seen.add(s.strategy);return s;
 });
 const available=stats.filter(s=>!s.exhausted);
 if(!available.length)return null;
 const rotation=sequence%4;
 const tie=(s:DiscoveryFilterStat)=>(discoveryStrategies.indexOf(s.strategy)-rotation+4)%4;
 const explore=[...available].sort((a,b)=>a.pages-b.pages||tie(a)-tie(b))[0];
 const ready=available.every(s=>s.matureAttempts>=30&&s.costsComplete);
 const score=(s:DiscoveryFilterStat)=>Math.max(0,s.interested+1-0.5*s.optedOut)/(s.costCents+1000);
 const winner=ready?[...available].filter(s=>s.interested>=3&&s.costCents>0).sort((a,b)=>score(b)-score(a)||tie(a)-tie(b))[0]:null;
 const learned=!!winner&&sequence%5<3;
 const chosen=learned?winner!:explore;
 return {version:discoveryFilterVersion,strategy:chosen.strategy,providerPage:chosen.nextPage,mode:learned?'learned':'explore'};
}
/** Only a rejected FREE estimate can retire an unavailable test audience. */
export class DiscoveryFilterUnavailable extends Error{
 constructor(){super('DISCOVERY_FILTER_UNAVAILABLE');}
}
