/** Normalize provider estimates; this never marks them reviewed or authorizes an offer. */
function dollarsToCents(value: unknown): number | null {
 if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
 const cents = Math.round(value * 100);
 return Number.isSafeInteger(cents) && Math.abs(value * 100 - cents) < 0.000001 ? cents : null;
}
export function normalizeDealMachineRepairs(data: Record<string, unknown>, fetchedAt: string) {
 if (typeof data.dm_property_id !== 'string' || !/^prop_\d+$/.test(data.dm_property_id) || !Number.isFinite(Date.parse(fetchedAt))) throw new Error('Property identity and fetch time required');
 // The scalar is the sole calculation input. Legacy ranges are audit-only.
 const baselineCents=dollarsToCents(data.estimated_repair_cost);
 const estimateStatus=baselineCents!==null?'available' as const:data.estimated_repair_cost==null?'missing' as const:'invalid' as const;
 const low=dollarsToCents(data.estimated_repair_cost_low);
 const high=dollarsToCents(data.estimated_repair_cost_high);
 const supplied = data.estimated_repair_cost_low != null || data.estimated_repair_cost_high != null;
 const validRange=low!==null && high!==null && low<=high && (baselineCents===null || (low<=baselineCents && baselineCents<=high));
 return {
  provider:'dealmachine' as const,propertyId:data.dm_property_id,fetchedAt,
  kind:'automated_estimate' as const,reviewed:false as const,
  baselineCents,sourceField:'estimated_repair_cost' as const,estimateStatus,rangeCents:validRange?{low,high}:null,
  rangeStatus:validRange?'available' as const:supplied?'invalid' as const:'missing' as const,
  condition:typeof data.building_condition==='string' && data.building_condition.trim()?data.building_condition:null,
  livingAreaSqft:typeof data.living_area_sqft==='number' && Number.isFinite(data.living_area_sqft) && data.living_area_sqft>0?data.living_area_sqft:null,
 };
}
