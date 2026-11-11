import {pathToFileURL} from 'node:url';
import {discoverPage} from '../lib/discovery-pipeline.ts';
import {dealMachineRequest} from '../lib/dealmachine-request.ts';

/** Scoped diagnostic: one quota-admitted FREE estimate, never a purchase. */
export async function checkFinancialQueryContract(env=process.env,transport=fetch){
 if(env.VERCEL_ENV!=='preview'||env.VERCEL_GIT_COMMIT_REF!=='codex/daily-funded-outreach')return {status:'outside_review',paidRequests:0};
 if(!env.DEALMACHINE_API_KEY||!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY)return {status:'unconfigured',paidRequests:0};
 const db=async(path,method='GET',body)=>{
  const response=await transport(env.SUPABASE_URL+'/rest/v1/'+path,{method,headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('QUERY_CHECK_DATABASE_UNAVAILABLE');return response.status===204?null:response.json();
 };
 const configs=await db('icash_discovery_configs?enabled=eq.true&auto_enabled=eq.true&exhausted=eq.false&select=account_id,revision,next_page,zip,per_page&order=account_id&limit=25');
 let selected;
 for(const c of configs){
  const context=await db('rpc/icash_targeting_query_context','POST',{p_account:c.account_id,p_revision:c.revision,p_page:c.next_page});
  if(context?.ready&&context.policy?.version==='financial-prefilter-v1'){selected={c,policy:context.policy};break;}
 }
 if(!selected)return {status:'no_ready_query',paidRequests:0};
 const {c,policy}=selected;let result;let requests=0;
 const sanitize=value=>String(value??'').replaceAll(env.DEALMACHINE_API_KEY,'[redacted]').replaceAll(env.SUPABASE_SECRET_KEY,'[redacted]').replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi,'[id]').slice(0,350);
 await discoverPage({zip:c.zip,page:1,perPage:c.per_page,unitCostMicros:1,quotedDataCostMicros:100,filterPlan:{version:'seller-filters-v1',strategy:'baseline',providerPage:1,mode:'explore'},queryPolicy:policy},{
  request:async body=>{
   if(body.estimate_cost!==true||++requests!==1)throw Error('FREE_ESTIMATE_ONLY');
   const response=await dealMachineRequest(db,'search_estimate',()=>transport('https://api.v2.dealmachine.com/v1/properties/search',{method:'POST',headers:{Authorization:'Bearer '+env.DEALMACHINE_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(45000)}));
   result={status:response.ok?'accepted':'rejected',httpStatus:response.status,paidRequests:0,...(!response.ok&&response.status===400?{errorCode:sanitize(response.raw?.error?.code),message:sanitize(response.raw?.error?.message),issues:Array.isArray(response.raw?.error?.details?.issues)?response.raw.error.details.issues.slice(0,10).map(issue=>({path:sanitize(issue.path),message:sanitize(issue.message)})):[]}:{}),...(response.ok?{estimatedCredits:response.raw?.estimated_credits?.this_page}:{} )};
   // Stop after inspecting the free response, even if the provider rejects it.
   return {estimated_credits:{this_page:0,breakdown:{people:0}}};
  },reserveAndClaim:async()=>{throw Error('PURCHASE_DISABLED');},persist:async()=>{throw Error('PURCHASE_DISABLED');},
 });
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log('Financial query contract: '+JSON.stringify(await checkFinancialQueryContract()));}
 catch{console.log('Financial query contract: diagnostic unavailable; paid requests: 0.');}
}
