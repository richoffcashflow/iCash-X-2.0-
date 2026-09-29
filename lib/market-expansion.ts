import {z} from 'zod';
const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const marketCounts=z.object({total_properties:count,total_people:count,total_results:count});
export const marketLocations=z.object({data:z.array(z.object({type:z.literal('zip_code'),code:z.string().regex(/^\d{5}$/),state:z.string().regex(/^[A-Z]{2}$/),name:z.string(),property_count:count})).max(50),pagination:z.object({page:z.number().int().positive(),total_pages:z.number().int().nonnegative()})});
export function marketCountBodies(zip:string,now=new Date()){
 if(!/^\d{5}$/.test(zip))throw Error('Invalid ZIP');
 const locations=[{type:'zip_code',code:zip}];
 return [
 {locations,anchor:'properties'},
 {locations,anchor:'properties',filters:[{filter_id:'property_type',operator:'contains_any',value:[1]},{filter_id:'estimated_equity_percentage',operator:'greater_than_or_equal',value:70}]},
 {locations,anchor:'people',contact_audience:'owners',filters:[{filter_id:'is_corporate_owned',value:true},{filter_id:'num_mortgages',operator:'equals',value:0},{filter_id:'last_sale_date',operator:'is_after',value:new Date(now.getTime()-365*86400000).toISOString().slice(0,10)}]}
 ];
}
