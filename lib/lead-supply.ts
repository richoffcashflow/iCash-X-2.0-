import {z} from 'zod';

const count=z.number().int().nonnegative().safe();
export const leadSupplyStatsSchema=z.object({
 checkedAt:z.string().datetime({offset:true}),
 activeAccounts:count,coveredAccounts24h:count,qualified24h:count,
 pausedAccounts:count,unfundedAccounts:count,setupAccounts:count,
 matureLeads:count,matureDeliveries:count,resolvedRequests7d:count,qualifiedRequests7d:count,
}).refine(s=>s.coveredAccounts24h<=s.activeAccounts&&s.qualifiedRequests7d<=s.resolvedRequests7d
 &&s.matureDeliveries<=s.matureLeads*3);
export type LeadSupplyStats=z.infer<typeof leadSupplyStatsSchema>;

/** Internal planning target: one inbound delivery per ready account per day.
 * Three is the lifetime sharing limit, not immediate delivery capacity.
 * Until ten completed cohorts exist, budget for one recipient per new lead.
 */
export function leadSupplyPlan(s:LeadSupplyStats){
 const observed=s.matureLeads>=10&&s.matureDeliveries>0;
 const recipientsPerLead=s.activeAccounts===0?1:Math.min(s.activeAccounts,3,observed?s.matureDeliveries/s.matureLeads:1);
 const minimumDaily=Math.ceil(s.activeAccounts/recipientsPerLead);
 const healthyDaily=Math.ceil(s.activeAccounts*1.2/recipientsPerLead);
 const gap=Math.max(0,healthyDaily-s.qualified24h);
 const waitingAccounts=s.activeAccounts-s.coveredAccounts24h;
 const qualificationRate=s.resolvedRequests7d>=20&&s.qualifiedRequests7d>0?s.qualifiedRequests7d/s.resolvedRequests7d:null;
 return {...s,minimumDaily,healthyDaily,gap,waitingAccounts,recipientsPerLead,
  yieldSource:observed?'observed' as const:'startup' as const,
  qualificationRate,submissionsDaily:healthyDaily===0?0:qualificationRate===null?null:Math.ceil(healthyDaily/qualificationRate),
  status:s.activeAccounts===0?'idle' as const:gap>0?'short' as const:waitingAccounts>0?'delivery_gap' as const:'healthy' as const,
 };
}
export type LeadSupplyPlan=ReturnType<typeof leadSupplyPlan>;

export function validLeadSupplyPlan(value:unknown):value is LeadSupplyPlan{
 const parsed=leadSupplyStatsSchema.safeParse(value);
 if(!parsed.success)return false;
 const expected=leadSupplyPlan(parsed.data),v=value as Record<string,unknown>;
 return Object.entries(expected).every(([key,n])=>v[key]===n);
}
