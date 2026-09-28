import {writeFileSync} from 'node:fs';
import {discoverPage} from '../lib/discovery-pipeline.ts';
import {minimumEquityGate} from '../lib/equity-screen.ts';
const id='equity70-one-property-20260928';
let claimed=false,paid=false,receipt=null,validation=null,metadata=null;
async function db(query,method='GET',body){
 const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/icash_paid_lookup_diagnostics?'+query,{method,headers:{apikey:process.env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+process.env.SUPABASE_SECRET_KEY,'Content-Type':'application/json',Prefer:'return=representation'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('DIAGNOSTIC_LEDGER_UNAVAILABLE');return r.json();
}
let report={status:'skipped'};
if(process.env.VERCEL_ENV==='production'&&process.env.VERCEL_GIT_COMMIT_REF==='main'){
 try{
 if(!process.env.DEALMACHINE_API_KEY||!process.env.SUPABASE_SECRET_KEY||!process.env.SUPABASE_URL)throw new Error('PREVIEW_CREDENTIALS_MISSING');
 const [job]=await db('id=eq.'+id);
 if(!job||job.state!=='authorized'){report={status:'already_used_or_not_authorized'};}
 else{
 const outcome=await discoverPage({zip:job.zip,page:1,perPage:1,unitCostMicros:1,quotedDataCostMicros:job.max_credits},{
 request:async body=>{
 if(!body.estimate_cost){if(!claimed||paid)throw new Error('PAID_REPLAY_BLOCKED');paid=true;}
 const r=await fetch('https://api.v2.dealmachine.com/v1/properties/search',{method:'POST',headers:{Authorization:'Bearer '+process.env.DEALMACHINE_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!r.ok){const e=await r.json().catch(()=>({}));validation=JSON.stringify(e).replaceAll(process.env.DEALMACHINE_API_KEY,'[redacted]').slice(0,1500);throw new Error('PROVIDER_HTTP_'+r.status);}const value=await r.json();
 if(!body.estimate_cost)receipt={credits:value.credits??null,count:Array.isArray(value.data)?value.data.length:null};
 return value;
 },
 reserveAndClaim:async()=>{const rows=await db('id=eq.'+id+'&state=eq.authorized','PATCH',{state:'started',started_at:new Date().toISOString()});claimed=rows.length===1;return claimed;},
 persist:async result=>{report={status:'complete',estimatedCredits:result.estimatedCredits,actualCredits:result.creditsUsed,peopleCredits:result.peopleCredits,properties:result.rows.length,equity:result.rows.map(row=>minimumEquityGate(row)),fieldsPresent:result.rows.map(row=>({value:typeof row.estimated_value==='number',equityPercent:typeof row.estimated_equity_percentage==='number',repairCost:typeof row.estimated_repair_cost==='number',loanBalance:typeof row.total_estimated_loan_balance==='number'}))};await db('id=eq.'+id+'&state=eq.started','PATCH',{state:'complete',result:report,completed_at:new Date().toISOString()});}
 });if(!claimed)report={status:outcome.status};
 }
 }catch(e){report={status:'held',reason:/^[A-Z0-9_]+$/.test(e?.message??'')?e.message:'INVALID_RESPONSE_OR_NETWORK',paidRequestSent:paid,receipt,validation,metadata};if(claimed)try{await db('id=eq.'+id+'&state=eq.started','PATCH',{state:'held',result:report,completed_at:new Date().toISOString()});}catch{}}
}
// Only aggregate diagnostics. No credentials, addresses, owner names or phone numbers.
writeFileSync('public/paid-equity-diagnostic.json',JSON.stringify(report));console.log('ICASH_PAID_EQUITY '+JSON.stringify(report));
