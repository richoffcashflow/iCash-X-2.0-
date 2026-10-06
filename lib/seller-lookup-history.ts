import {dealMachineAddress} from './dealmachine-address.ts';
type Activity={activity_id?:string;type?:string;created_at?:string;request?:unknown;result_summary?:unknown;entity_ids?:unknown};
/** Provider activity history is read-only and consumes no data credits.
 * Never rerun enrichment or retrieve new property/contact data here.
 */
export async function sellerLookupHistory(lead:{address:string;claimed_at:string|null;created_at:string},key:string|undefined,transport:typeof fetch=fetch){
 if(!key||!/^dm_sk_live_[A-Za-z0-9_-]+$/.test(key))throw Error('HISTORY_NOT_CONFIGURED');
 const at=Date.parse(lead.claimed_at??lead.created_at);
 if(!Number.isFinite(at))throw Error('INVALID_LOOKUP_TIME');
 const address=dealMachineAddress(lead.address);
 const query='street' in address?address.street:address.full_address.split(',')[0];
 const headers={Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
 async function read(path:string,body?:unknown){
  const r=await transport('https://api.v2.dealmachine.com/v1/activity/'+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error(`HISTORY_HTTP_${r.status}`);
  const text=await r.text();if(text.length>100000)throw Error('HISTORY_TOO_LARGE');return JSON.parse(text);
 }
 const search=await read('search',{query,filters:{type:['enrich_address']},date_range:{start:new Date(at-120000).toISOString(),end:new Date(at+120000).toISOString()},page:1,per_page:3});
 if(!Array.isArray(search?.data)||search.data.length>3)throw Error('HISTORY_RESPONSE_INVALID');
 const records=[];
 for(const item of search.data as Activity[]){
  if(typeof item.activity_id!=='string'||!/^act_[A-Za-z0-9_-]{1,100}$/.test(item.activity_id)||item.type!=='enrich_address')continue;
  const {data}=await read(item.activity_id+'?entity_page=1&entity_per_page=5') as {data:Activity};
  if(data?.activity_id!==item.activity_id||data.type!=='enrich_address')throw Error('HISTORY_RECORD_MISMATCH');
  records.push({activityId:data.activity_id,createdAt:data.created_at,request:data.request,result:data.result_summary,entities:data.entity_ids});
 }
 return {records,hasMore:search.pagination?.has_next_page===true};
}
