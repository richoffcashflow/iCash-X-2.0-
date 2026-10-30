import {pathToFileURL} from 'node:url';
import {dealMachineRequest} from '../lib/dealmachine-request.ts';
import {canSaveSharedIntegrationCheck} from './integration-check-write-policy.mjs';

export const targetingFilterIds=['is_off_market','last_sale_date','estimated_value','num_bedrooms','num_bathrooms','living_area_sqft','year_built','has_absentee_owners','has_out_of_state_owners','is_vacant_home'];
/** GET-only, bounded and shared-quota admitted. No contacts, purchases or plan changes. */
export async function checkTargetingCapabilities(env=process.env,transport=fetch){
 if(!env.DEALMACHINE_API_KEY||!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY)return {status:'unconfigured',paidRequests:0};
 const db=async(path,method='GET',body)=>{
  const r=await transport(env.SUPABASE_URL+'/rest/v1/'+path,{method,headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('TARGETING_METADATA_DATABASE_UNAVAILABLE');return r.status===204?null:r.json();
 };
 const get=async(path)=>{
  const r=await dealMachineRequest(db,'owner_preview',()=>transport('https://api.v2.dealmachine.com/v1'+path,{method:'GET',headers:{Authorization:'Bearer '+env.DEALMACHINE_API_KEY},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)}));
  if(!r.ok)throw Error('TARGETING_METADATA_HTTP_'+r.status);return r.raw;
 };
 const cached=await db('icash_integration_checks?provider=eq.dealmachine_targeting&select=checked_at,result');
 if(cached[0]?.result?.status==='verified'&&Date.parse(cached[0].checked_at)>Date.now()-86400000)return cached[0].result;
 const account=await get('/account');
 const plan=account?.data?.plan;
 if(typeof plan?.name!=='string'||typeof plan?.is_paid!=='boolean')throw Error('TARGETING_ACCOUNT_SHAPE');
 const filters=[];let complete=false;
 for(let page=1;page<=3;page++){
  const raw=await get('/filters?source_type=properties&per_page=250&page='+page);
  if(!Array.isArray(raw?.data)||typeof raw?.pagination?.has_next_page!=='boolean')throw Error('TARGETING_CATALOG_SHAPE');
  for(const f of raw.data)if(targetingFilterIds.includes(f.filter_id))filters.push({filter_id:f.filter_id,type:f.type,allowed_operators:f.allowed_operators,is_premium_filter:typeof f.is_premium_filter==='boolean'?f.is_premium_filter:null});
  if(!raw.pagination.has_next_page){complete=true;break;}
 }
 const result={status:complete?'verified':'incomplete',checkedAt:new Date().toISOString(),plan:{name:plan.name,is_paid:plan.is_paid},filters,exportOptions:{mobile_only:'documented_not_paid_tested',active_phones_only:'existing_verified_contract'},paidRequests:0};
 if(canSaveSharedIntegrationCheck(env)&&complete)await db('icash_integration_checks?on_conflict=provider','POST',{provider:'dealmachine_targeting',checked_at:result.checkedAt,result});
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log('DealMachine targeting capabilities: '+JSON.stringify(await checkTargetingCapabilities()));}
 catch(e){console.log('DealMachine targeting capabilities: unavailable; '+(e instanceof Error?e.message:'metadata error')+'; paid requests: 0.');}
}
