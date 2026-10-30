import {z} from 'zod';
import {selectDiscoveryFilter,type DiscoveryFilterPlan} from './discovery-filters.ts';

export const targetingVersion='seller-targeting-v1';
const range=z.object({min:z.number().nonnegative(),max:z.number().nonnegative()}).strict().refine(v=>v.min<=v.max);
const buyerRanges=z.object({estimated_value:range.optional(),num_bedrooms:range.optional(),num_bathrooms:range.optional(),living_area_sqft:range.optional(),year_built:range.optional()}).strict().refine(v=>Object.keys(v).length>0);
export const targetingDefinitionSchema=z.object({
 id:z.uuid(),segment:z.enum(['off_market','sale_7_10','sale_10_plus','buyer_fit','out_of_state_absentee','vacant_absentee','mobile']),
 // A fixed date is part of the immutable experiment, never a moving cursor query.
 asOf:z.iso.date().refine(v=>v>='2020-01-01'),ranges:buyerRanges.optional(),
 buyerEvidence:z.object({accountId:z.uuid(),buyerId:z.uuid(),sourceReference:z.string().min(12).max(1000),observedAt:z.iso.datetime({offset:true}),expiresAt:z.iso.datetime({offset:true}),zips:z.array(z.string().regex(/^\d{5}$/)).min(1).max(100)}).strict().optional(),
}).strict().superRefine((d,c)=>{
 if(d.segment==='buyer_fit'&&(!d.ranges||!d.buyerEvidence))c.addIssue({code:'custom',message:'Dated, scoped buyer requirements are required'});
 if(d.segment!=='buyer_fit'&&(d.ranges||d.buyerEvidence))c.addIssue({code:'custom',message:'Buyer criteria belong only to buyer-fit experiments'});
});
export type TargetingDefinition=z.infer<typeof targetingDefinitionSchema>;
export type TargetingPlan={version:typeof targetingVersion;strategy:string;providerPage:number;mode:'explore';targeting:TargetingDefinition};
export type AnyDiscoveryPlan=DiscoveryFilterPlan|TargetingPlan;
export function isTargetingPlan(p:unknown):p is TargetingPlan{
 const r=z.object({version:z.literal(targetingVersion),strategy:z.string(),providerPage:z.number().int().min(1).max(999999999),mode:z.literal('explore'),targeting:targetingDefinitionSchema}).strict().safeParse(p);
 return r.success&&r.data.strategy==='target_'+r.data.targeting.id;
}
function yearsBefore(asOf:string,years:number){
 const [y,m,d]=asOf.split('-').map(Number),last=new Date(Date.UTC(y-years,m,0)).getUTCDate();
 return `${y-years}-${String(m).padStart(2,'0')}-${String(Math.min(d,last)).padStart(2,'0')}`;
}
export function targetingFilters(input:TargetingDefinition):Record<string,unknown>[]{
 const d=targetingDefinitionSchema.parse(input),bool=(filter_id:string)=>({filter_id,value:true});
 switch(d.segment){
  case 'off_market':return [bool('is_off_market')];
  // Provider is_before is strict: 7–10 includes the ten-year boundary; 10+ excludes it.
  case 'sale_7_10':return [{filter_id:'last_sale_date',operator:'date_range',value:{start:yearsBefore(d.asOf,10),end:yearsBefore(d.asOf,7)}}];
  case 'sale_10_plus':return [{filter_id:'last_sale_date',operator:'is_before',value:yearsBefore(d.asOf,10)}];
  case 'buyer_fit':return Object.entries(d.ranges!).sort(([a],[b])=>a.localeCompare(b)).map(([filter_id,value])=>({filter_id,operator:'range',value}));
  case 'out_of_state_absentee':return [bool('has_absentee_owners'),bool('has_out_of_state_owners')];
  case 'vacant_absentee':return [bool('is_vacant_home'),bool('has_absentee_owners')];
  case 'mobile':return [];
 }
}
/** Catalog presence is not entitlement. Premium/unknown metadata stays disabled. */
export function targetingCapabilityProblem(d:TargetingDefinition,raw:unknown,now=Date.now()):string|null{
 const parsed=z.object({status:z.literal('verified'),checkedAt:z.string(),plan:z.object({name:z.string(),is_paid:z.literal(true)}),filters:z.array(z.object({filter_id:z.string(),type:z.string(),allowed_operators:z.array(z.string()),is_premium_filter:z.boolean().nullable()}))}).safeParse(raw);
 if(!parsed.success||!(Date.parse(parsed.data.checkedAt)<=now&&Date.parse(parsed.data.checkedAt)>now-7*86400000))return 'account_capabilities_unverified';
 for(const f of targetingFilters(d)){
  const entries=parsed.data.filters.filter(x=>x.filter_id===f.filter_id),meta=entries[0];
  const type=typeof f.value==='boolean'?'BOOLEAN':f.filter_id==='last_sale_date'?'DATE':'NUMBER';
  if(entries.length!==1||meta.type!==type||meta.is_premium_filter!==false||f.operator&&!meta.allowed_operators.includes(String(f.operator)))return 'filter_entitlement_unverified';
 }
 return null;
}
export type TargetingState={enabled:boolean;capabilities:unknown;dedupReady:boolean;mobileVerified:boolean;experiments:{definition:TargetingDefinition;nextPage:number;pages:number;exhausted:boolean;blocked:boolean}[]};
/** Fixed exploration, never a winner from replies. Half of new slots retain the
 * existing audiences; every fourth slot explicitly retains the baseline. */
export function selectTargetingPlan(legacy:unknown,sequence:number,shared:unknown,raw:unknown,accountId:string,zip:string,now=Date.now()):AnyDiscoveryPlan|null{
 // Validate legacy state even on an experimental slot; never bypass its holds.
 const original=selectDiscoveryFilter(legacy,sequence,shared),fallback=()=>original;
 const s=raw as TargetingState|null;
 if(!s?.enabled||!s.dedupReady||!Array.isArray(s.experiments))return fallback();
 const eligible=s.experiments.filter(e=>{
  const parsed=targetingDefinitionSchema.safeParse(e.definition);if(!parsed.success)return false;
  const d=parsed.data,b=d.buyerEvidence;
  return Number.isSafeInteger(e.nextPage)&&e.nextPage>0&&Number.isSafeInteger(e.pages)&&e.pages>=0&&!e.exhausted&&!e.blocked
   &&d.asOf<=new Date(now).toISOString().slice(0,10)&&!targetingCapabilityProblem(d,s.capabilities,now)
   &&(d.segment!=='mobile'||s.mobileVerified)
   &&(!b||b.accountId===accountId&&b.zips.includes(zip)&&Date.parse(b.observedAt)<=now&&Date.parse(b.expiresAt)>now&&Date.parse(b.expiresAt)<=Date.parse(b.observedAt)+30*86400000);
 });
 if(sequence%4===0&&Array.isArray(legacy)){
  const baseline=legacy.find(x=>x.strategy==='baseline'&&!x.exhausted&&!x.blocked);
  if(baseline)return {version:'seller-filters-v1',strategy:'baseline',providerPage:baseline.nextPage,mode:'explore'};
 }
 if(!eligible.length||sequence%2===0&&original)return fallback();
 eligible.sort((a,b)=>a.pages-b.pages||a.definition.id.localeCompare(b.definition.id));
 const e=eligible[0];return {version:targetingVersion,strategy:'target_'+e.definition.id,providerPage:e.nextPage,mode:'explore',targeting:e.definition};
}
