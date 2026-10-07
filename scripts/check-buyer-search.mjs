import {canSaveSharedIntegrationCheck} from './integration-check-write-policy.mjs';
// Free estimate only. This script cannot retrieve property/contact records.
const key=process.env.DEALMACHINE_API_KEY;
const result={configured:!!key,status:'missing_key',supported:false,estimatedCredits:null};
if(key)try{
 const since=new Date(Date.now()-365*86400000).toISOString().slice(0,10);
 const r=await fetch('https://api.v2.dealmachine.com/v1/properties/search',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({locations:[{type:'zip_code',code:'75201'}],anchor:'people',contact_audience:'owners',fields:['full_address'],filters:[{filter_id:'is_corporate_owned',value:true},{filter_id:'num_mortgages',operator:'equals',value:0},{filter_id:'last_sale_date',operator:'is_after',value:since}],page:1,per_page:10,estimate_cost:true}),redirect:'error',signal:AbortSignal.timeout(15000)});
 result.status=`provider_http_${r.status}`;
 if(r.ok){const d=await r.json();const c=d.estimated_credits;if(Number.isSafeInteger(c?.this_page)&&c.this_page>=0&&c.breakdown?.properties===0){result.supported=true;result.status='estimate_verified';result.estimatedCredits=c.this_page;}else result.status='estimate_needs_review';}
}catch{result.status='connection_failed';}
if(canSaveSharedIntegrationCheck()&&process.env.SUPABASE_URL&&process.env.SUPABASE_SECRET_KEY)try{
 await fetch(`${process.env.SUPABASE_URL}/rest/v1/icash_integration_checks?on_conflict=provider`,{method:'POST',headers:{apikey:process.env.SUPABASE_SECRET_KEY,Authorization:`Bearer ${process.env.SUPABASE_SECRET_KEY}`,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'},body:JSON.stringify({provider:'dealmachine_buyer_search',checked_at:new Date().toISOString(),result}),signal:AbortSignal.timeout(10000)});
}catch{/* No paid fallback. */}
console.log(`Buyer search preflight: ${result.status}. No records requested.`);
