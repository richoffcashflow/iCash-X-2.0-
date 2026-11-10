import {z} from 'zod';
export const researchQueryPolicySchema=z.discriminatedUnion('version',[
 z.object({version:z.enum(['research-efficiency-v1','research-efficiency-v2']),exclusionListId:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).nullable()}).strict(),
 z.object({version:z.literal('financial-prefilter-v1'),exclusionListId:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),asOf:z.iso.date(),tier:z.number().int().min(0).max(2)}).strict(),
]);
export type ResearchQueryPolicy=z.infer<typeof researchQueryPolicySchema>;
export const researchQueryPolicyValid=(v:unknown):v is ResearchQueryPolicy=>researchQueryPolicySchema.safeParse(v).success;
/** Optional numeric lien fields are NULL on observed eligible records. A SQL-like
 * <=0 filter silently removes those records. Keep numeric evidence in the existing
 * financial screen; this query never establishes clear title or changes a hold.
 * Retain v1 exactly for original in-flight query identities. */
export const researchEligibilityFilters=(version:ResearchQueryPolicy['version'])=>[
 {filter_id:'has_active_lien',value:false},{filter_id:'has_hoa_lien',value:false},{filter_id:'is_tax_delinquent',value:false},
 ...(version==='research-efficiency-v1'?[
 {filter_id:'num_total_active_liens',operator:'less_than_or_equal',value:0},
 {filter_id:'num_total_open_liens',operator:'less_than_or_equal',value:0},
 {filter_id:'total_open_lien_amount',operator:'less_than_or_equal',value:0},
 ]:[]),
];

/** Only reviewed catalog filters. This narrows preliminary estimates, never
 * proves debt, title, ARV or realized investor profit. Keep old query bytes intact. */
export function financialPrefilters(policy:ResearchQueryPolicy,minimumRepairs=0):Record<string,unknown>[]{
 if(policy.version!=='financial-prefilter-v1')return [];
 if(!researchQueryPolicyValid(policy)||![0,25000].includes(minimumRepairs))throw Error('DISCOVERY_CONFIGURATION_INVALID');
 const filters:Record<string,unknown>[]=[
  {filter_id:'market_status',operator:'contains_any',value:[6]},
  // floor(10,000 dollars / 0.70 to cents): even zero repairs cannot produce
  // a positive seller ceiling at or below this value. No arbitrary price band.
  {filter_id:'estimated_value',operator:'greater_than',value:minimumRepairs===25000?50000:14285.72},
  {filter_id:'estimated_repair_cost',operator:'greater_than_or_equal',value:0},
  {filter_id:'num_total_active_liens',operator:'less_than_or_equal',value:0},
 ];
 if(policy.tier<2){
  const [year,month,day]=policy.asOf.split('-').map(Number),years=policy.tier===0?10:7;
  const last=new Date(Date.UTC(year-years,month,0)).getUTCDate();
  filters.push({filter_id:'estimated_equity_percentage',operator:'greater_than_or_equal',value:policy.tier===0?90:80},
   {filter_id:'last_sale_date',operator:'is_before',value:`${year-years}-${String(month).padStart(2,'0')}-${String(Math.min(day,last)).padStart(2,'0')}`});
  if(policy.tier===0)filters.push({filter_id:'has_absentee_owners',value:true});
 }
 return filters;
}
