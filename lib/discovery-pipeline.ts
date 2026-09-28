/** Bounded property-only acquisition. Dependencies are server-owned; never accept rates from a browser. */
export const discoveryFields=['dm_property_id','full_address','address','city','state','zip','estimated_value','estimated_equity_percentage','estimated_equity_amount','total_estimated_loan_balance','has_active_lien','has_hoa_lien','num_total_active_liens','num_total_open_liens','total_open_lien_amount','is_tax_delinquent','is_free_and_clear','estimated_repair_cost','estimated_repair_cost_low','estimated_repair_cost_high','building_condition','living_area_sqft','num_bedrooms','num_bathrooms','year_built'];
export type DiscoveryConfig={zip:string;page:number;perPage:number;unitCostMicros:number;quotedDataCostMicros:number};
type Dependencies={request:(body:object)=>Promise<unknown>;reserveAndClaim:()=>Promise<boolean>;persist:(result:DiscoveryResult)=>Promise<void>};
export type DiscoveryResult={creditsUsed:number;peopleCredits:number;estimatedCredits:number;hasNextPage:boolean;fetchedAt:string;rows:Record<string,unknown>[]};
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
export async function discoverPage(c:DiscoveryConfig,d:Dependencies){
 if(!/^\d{5}$/.test(c.zip)||!integer(c.page)||c.page<1||!integer(c.perPage)||c.perPage<1||c.perPage>10||!integer(c.unitCostMicros)||c.unitCostMicros===0||!integer(c.quotedDataCostMicros))throw new Error('DISCOVERY_CONFIGURATION_INVALID');
 const body={locations:[{type:'zip_code',code:c.zip}],anchor:'properties',contact_audience:'none',filters:[{filter_id:'property_type',operator:'contains_any',value:[1]},{filter_id:'estimated_equity_percentage',operator:'greater_than_or_equal',value:70}],fields:discoveryFields,page:c.page,per_page:c.perPage};
 const estimate=await d.request({...body,estimate_cost:true}) as {estimated_credits?:{this_page?:unknown;breakdown?:{people?:unknown}}};
 const credits=estimate?.estimated_credits?.this_page;
 if(!integer(credits)||credits>c.perPage||estimate?.estimated_credits?.breakdown?.people!==0)throw new Error('DISCOVERY_ESTIMATE_INVALID');
 if(credits===0)return {status:'empty' as const};
 if(BigInt(credits)*BigInt(c.unitCostMicros)>BigInt(c.quotedDataCostMicros))throw new Error('DISCOVERY_RATE_TOO_LOW');
 if(!await d.reserveAndClaim())return {status:'held' as const};
 // Any failure after claim is ambiguous; never replay or release spend automatically.
 const raw=await d.request({...body,estimate_cost:false}) as {data?:Record<string,unknown>[];credits?:{used?:unknown;people?:unknown};pagination?:{has_next_page?:unknown}};
 if(!Array.isArray(raw?.data)||raw.data.length>c.perPage||!integer(raw.credits?.used)||raw.credits?.people!==0||typeof raw.pagination?.has_next_page!=='boolean')throw new Error('DISCOVERY_RESPONSE_REQUIRES_RECONCILIATION');
 const seen=new Set<string>();
 const rows=raw.data.map(row=>{
  if(!row||typeof row.dm_property_id!=='string'||!/^prop_\d{1,20}$/.test(row.dm_property_id)||seen.has(row.dm_property_id))throw new Error('DISCOVERY_RESPONSE_REQUIRES_RECONCILIATION');
  seen.add(row.dm_property_id);
  // Keep only requested property fields, never accidentally persist contacts.
  const clean:Record<string,unknown>={};for(const field of discoveryFields)if(field in row)clean[field]=row[field];
  if(typeof clean.full_address!=='string'||!clean.full_address.trim()){
   if(typeof row.address!=='string'||typeof row.city!=='string'||typeof row.state!=='string')throw new Error('DISCOVERY_RESPONSE_REQUIRES_RECONCILIATION');
   clean.full_address=[row.address,row.city,row.state,row.zip].filter(x=>typeof x==='string'&&x).join(', ');
  }
  return clean;
 });
 // Persist reported spend even if the provider exceeded its estimate; reconciliation handles overrun.
 const result:DiscoveryResult={creditsUsed:raw.credits.used,peopleCredits:0,estimatedCredits:credits,hasNextPage:raw.pagination.has_next_page,fetchedAt:new Date().toISOString(),rows};
 await d.persist(result);
 return {status:raw.credits.used>credits?'needs_reconciliation' as const:'screening_queued' as const,properties:rows.length};
}
