import {propertyContext,propertyIdPattern} from './property-context.ts';
/** A single bounded, billable property lookup. Call only after reserving an allowance. */
export async function loadTestProperty(id:string,key:string,transport:typeof fetch=fetch){
 if(typeof window!=='undefined'||!propertyIdPattern.test(id)||!/^dm_sk_live_[A-Za-z0-9_-]+$/.test(key))throw new Error('PROPERTY_LOOKUP_NOT_CONFIGURED');
 const fields=['estimated_value','estimated_equity_amount','total_estimated_loan_balance','has_active_lien','has_hoa_lien','num_total_active_liens','num_total_open_liens','total_open_lien_amount','is_tax_delinquent','is_free_and_clear','estimated_repair_cost','estimated_repair_cost_low','estimated_repair_cost_high','building_condition','living_area_sqft','num_bedrooms','num_bathrooms','year_built'];
 const query=new URLSearchParams({enrich:'true',contact_audience:'none',fields:fields.join(',')});
 // No automatic retry, no contacts, no user-controlled endpoint, no shared data cache.
 try{
  const r=await transport(`https://api.v2.dealmachine.com/v1/properties/${id}?${query}`,{headers:{Authorization:`Bearer ${key}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error('PROPERTY_LOOKUP_FAILED');
  return propertyContext(await r.json(),id,new Date().toISOString());
 }catch{throw new Error('PROPERTY_LOOKUP_FAILED_NO_RETRY');}
}
