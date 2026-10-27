import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {assertPaidProviderSimulationsAllowed} from './test-automatic-offer-provider.mjs';
import {finishAdmittedDealMachineRequest} from '../lib/dealmachine-request.ts';

export const activeExportProbeProvider='dealmachine_active_phone_export_verification_20261027_v1';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
// One distinct owner, people fields only: at most one people data credit under
// DealMachine's documented per-entity export pricing. No extra property fields,
// filters, locations, lists, fallback purchase, calls or texts are possible.
export function activeExportProbeRequest(personId){
 if(typeof personId!=='string'||!/^per_[1-9][0-9]{0,30}$/.test(personId))throw Error('PROBE_OWNER_ID_INVALID');
 return {people_ids:[personId],fields:['dm_person_id','full_name','phones'],property_match:'owner',anchor:'person',
  require_phone:true,scrub_dnc:true,active_phones_only:true};
}
export const activeExportProbeHash=body=>createHash('sha256').update(JSON.stringify(body)).digest('hex');

/** Prepared verification only. A future approved entry point must use the
 * service-role database adapter and a fresh explicit owner approval row.
 * Nothing in production/CI calls this. The executable below remains disabled.
 * The unique private integration-check row is claimed by compare-and-swap
 * before the only paid request. A lost claim/response cannot authorize replay.
 */
export async function verifyActiveExportOnce({db,transport=fetch,env=process.env,clock=Date.now}){
 const now=clock();
 if(env.VERCEL_ENV!=='preview'||env.VERCEL_GIT_COMMIT_REF!=='codex/dealmachine-active-phone-contract-20261027')return {status:'not_requested',paidRequests:0};
 const path=`icash_integration_checks?provider=eq.${activeExportProbeProvider}`;
 const rows=await db(path+'&select=result');
 if(!Array.isArray(rows)||rows.length!==1||!plain(rows[0]?.result))return {status:'approval_required',paidRequests:0};
 const approval=rows[0].result;
 if(approval.status!=='approved')return {status:'already_consumed_or_unapproved',paidRequests:0};
 if(approval.version!==1||approval.maxCredits!==1||approval.explicitOwnerApproval!==true||!uuid(approval.approvalId)
  ||!uuid(approval.accountId)||!uuid(approval.screeningId)||!/^prop_[1-9][0-9]{0,19}$/.test(approval.propertyId??'')
  ||!Number.isFinite(Date.parse(approval.approvedAt))||!Number.isFinite(Date.parse(approval.expiresAt))
  ||Date.parse(approval.approvedAt)>now||Date.parse(approval.expiresAt)<=now
  ||Date.parse(approval.expiresAt)-Date.parse(approval.approvedAt)>3600000)throw Error('PROBE_APPROVAL_INVALID');
 const body=activeExportProbeRequest(approval.personId),requestHash=activeExportProbeHash(body);
 if(approval.requestHash!==requestHash)throw Error('PROBE_APPROVAL_INVALID');
 if(!/^dm_sk_live_[A-Za-z0-9_-]+$/.test(env.DEALMACHINE_API_KEY??''))throw Error('PROBE_CONFIGURATION_REQUIRED');
 const contacts=await db(`icash_owner_contacts?account_id=eq.${approval.accountId}&screening_id=eq.${approval.screeningId}&select=result,created_at`);
 if(!Array.isArray(contacts)||contacts.length!==1)throw Error('PROBE_SOURCE_INVALID');
 const source=contacts[0],result=source.result;
 const matched=Array.isArray(result?.contacts)?result.contacts.filter(c=>c.personId===approval.personId):[];
 if(result?.propertyId!==approval.propertyId||!Array.isArray(result.requestedPersonIds)||!result.requestedPersonIds.includes(approval.personId)
  ||matched.length!==1||matched[0].likelyOwner!==true||matched[0].matchFlags?.is_likely_renter===true
  ||(matched[0].propertyContactType!==null&&matched[0].propertyContactType!=='owner')
  ||!Array.isArray(matched[0].phones)||!matched[0].phones.some(p=>typeof p.number==='string'&&p.doNotCall===false)
  ||!Number.isFinite(Date.parse(source.created_at))||Date.parse(source.created_at)>now||now-Date.parse(source.created_at)>86400000)throw Error('PROBE_SOURCE_INVALID');
 // Existing source proof binds the original completed owner batch/receipt.
 const started=await db('rpc/icash_dealmachine_owner_source_started_at','POST',{p_account:approval.accountId,p_screening:approval.screeningId});
 if(typeof started!=='string'||!Number.isFinite(Date.parse(started))||Date.parse(started)>Date.parse(source.created_at))throw Error('PROBE_SOURCE_INVALID');
 const claimTime=clock();
 if(Date.parse(approval.expiresAt)<=claimTime)return {status:'approval_expired',paidRequests:0};
 const runId=randomUUID(),claim={...approval,status:'started',runId,request:body,startedAt:new Date(claimTime).toISOString(),outreach:false};
 const claimFilter=path+`&result->>status=eq.approved&result->>approvalId=eq.${approval.approvalId}&result->>requestHash=eq.${requestHash}`;
 const claimed=await db(claimFilter,'PATCH',{checked_at:new Date(claimTime).toISOString(),result:claim});
 if(!Array.isArray(claimed)||claimed.length!==1||claimed[0]?.result?.runId!==runId)return {status:'claim_not_confirmed',paidRequests:0};
 const receiptPath=path+`&result->>status=eq.started&result->>runId=eq.${runId}`;
 const admitted=await db('rpc/icash_take_dealmachine_request','POST',{p_kind:'owner_lookup',p_account:approval.accountId,p_operation:activeExportProbeProvider,p_request:runId});
 if(admitted!==true){
  await db(receiptPath,'PATCH',{checked_at:new Date().toISOString(),result:{...claim,status:'quota_not_admitted'}});
  return {status:'quota_not_admitted',paidRequests:0};
 }
 let response,receipt;
 try{
  response=await finishAdmittedDealMachineRequest(db,runId,()=>transport('https://api.v2.dealmachine.com/v1/people/export',{method:'POST',headers:{Authorization:`Bearer ${env.DEALMACHINE_API_KEY}`,'Content-Type':'application/json'},
   body:JSON.stringify(body),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(120000)}));
  receipt=response.raw;
  if(receipt===null)throw Error('PROBE_RESPONSE_UNREADABLE');
 }catch{
  await db(receiptPath,'PATCH',{checked_at:new Date().toISOString(),result:{...claim,status:'unknown',reason:'original_response_unavailable'}}).catch(()=>null);
  return {status:'unknown_no_retry',paidRequests:1};
 }
 // Save the original provider response before interpreting the credit/export
 // contract. HTTP errors and missing credit fields are not inferred zero costs.
 const saved=await db(receiptPath,'PATCH',{checked_at:new Date().toISOString(),result:{...claim,status:'response_saved',httpStatus:response.status,receipt}});
 if(!Array.isArray(saved)||saved.length!==1||saved[0]?.result?.runId!==runId)throw Error('PROBE_RECEIPT_RECONCILIATION_REQUIRED');
 const used=Number.isSafeInteger(receipt?.credits?.used)&&receipt.credits.used>=0?receipt.credits.used:null;
 return {status:'response_saved',paidRequests:1,httpStatus:response.status,creditsUsed:used,
  creditLimitExceeded:used!==null&&used>1,hasExport:typeof receipt?.export_id==='string'};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 // Preserve the owner's existing global stop. Fresh explicit approval of this
 // exact one-credit test is required before a reviewed executable is enabled.
 assertPaidProviderSimulationsAllowed();
}
