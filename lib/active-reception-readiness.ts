import {createRecordedReceptionProviders} from './recorded-reception-provider.ts';
import {validRecordedReceptionConfig,inspectRecordedReceptionAgent,type RecordedReceptionConfig} from './recorded-reception.ts';
import {receptionTarget,receptionWorkspacePostcallAbsent} from './general-reception.ts';
import {sellerAgreementReceptionEnabled} from './seller-agreement-reception.ts';
import {boundedBytes} from './required-call-recording-provider.ts';
import {object} from './required-call-recording.ts';

/** Actual active reception template, not a prepared historical branch. All
 * provider requests are GETs; the database RPC only reads configuration. */
export async function readActiveReceptionReadiness(env:Record<string,string|undefined>,fetcher:typeof fetch=fetch){
 if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY)return {status:'unavailable',providerChecksPass:false};
 const signal=AbortSignal.timeout(12000);
 const response=await fetcher(env.SUPABASE_URL+'/rest/v1/rpc/icash_get_recorded_reception_config',{method:'POST',headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY,'Content-Type':'application/json'},body:JSON.stringify({p_called_number:receptionTarget.calledNumber}),redirect:'error',cache:'no-store',signal});
 if(!response.ok)throw Error('RECEPTION_READBACK_UNAVAILABLE');
 const c=JSON.parse((await boundedBytes(response,65536)).toString('utf8')) as RecordedReceptionConfig|null;
 if(!validRecordedReceptionConfig(c)||c.provider_account_sid!==env.TWILIO_ACCOUNT_SID)return {status:'configuration_unavailable',providerChecksPass:false};
 const p=createRecordedReceptionProviders(env,fetcher,signal);
 const [agent,branches,workspace,stop,agreement]=await Promise.all([p.agent(c),p.branches(c),p.workspace(),p.tool(c.stop_tool_id),sellerAgreementReceptionEnabled(c)?p.tool(String(c.agreement_tool_id)):Promise.resolve(undefined)]);
 const rows=branches.results,meta=object(branches.meta),complete=Array.isArray(rows)&&rows.length<100&&(meta.total===undefined||meta.total===rows.length);
 const matches=Array.isArray(rows)?rows.filter(r=>object(r).id===c.branch_id):[];
 const inspected=inspectRecordedReceptionAgent(c,agent,matches[0],receptionWorkspacePostcallAbsent(workspace),stop,agreement);
 return {status:'checked',providerChecksPass:complete&&matches.length===1&&inspected.safe,configId:c.id,branchId:c.branch_id,versionId:c.reviewed_version_id,approvedHash:c.config_hash,observedHash:inspected.hash,hashMatch:inspected.hashMatch,checks:{...inspected.checks,branchListComplete:complete,uniqueBranch:matches.length===1},callsPlaced:0};
}
