import {normalizeDocuseal,type Submission} from './docuseal-policy.ts';
import {verifiedSigningStatus,signingDocumentReadiness,type SigningKind} from './signing-policy.ts';
import {dealTermsSchema} from './deal-documents.ts';

type Db=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Job={id:string;accountId:string;envelopeId:string;signerId:string;phone:string;providerId:string;submitterId:number;termsHash:string};
type Envelope={id:string;account_id:string;provider_id:string;terms_hash:string;test_mode:boolean;state:string;kind:SigningKind;terms:unknown;recipients:{id:string;email?:string|null;phone?:string|null}[]};
type Dependencies={db:Db;key:string;fetcher?:typeof fetch};

/** One explicit authorization, one provider attempt. Never create, edit, or sign an agreement. */
export async function resendContractText(hash:string,{db,key,fetcher=fetch}:Dependencies){
 if(!/^[a-f0-9]{64}$/.test(hash)||!key)throw Error('CONFIGURATION_REQUIRED');
 const job=await db<Job|null>('rpc/icash_claim_contract_text_resend','POST',{p_hash:hash});
 if(!job)return {status:'not_authorized' as const};
 let attempted=false;
 const request=async(path:string,method='GET',body?:unknown)=>{
  const r=await fetcher('https://api.docuseal.com/'+path,{method,
   headers:{'X-Auth-Token':key,'Content-Type':'application/json'},
   ...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('PROVIDER_REQUEST_FAILED');
  return r.json();
 };
 try{
  const [e]=await db<Envelope[]>(`icash_signing_envelopes?id=eq.${job.envelopeId}&account_id=eq.${job.accountId}&select=id,account_id,provider_id,terms_hash,test_mode,state,kind,terms,recipients`);
  if(!e||e.id!==job.envelopeId||e.account_id!==job.accountId||e.test_mode||e.state!=='awaiting_counterparty'||e.provider_id!==job.providerId||e.terms_hash!==job.termsHash||!/^\d+$/.test(job.providerId)||!Number.isSafeInteger(job.submitterId)||job.submitterId<=0)throw Error('ENVELOPE_CHANGED');
  const raw=await request('submissions/'+job.providerId) as Submission & {archived_at?:string|null};
  if(raw.archived_at||['expired','declined','completed'].includes(raw.status??''))throw Error('AGREEMENT_NOT_PENDING');
  const d=normalizeDocuseal(raw,e);
  if(verifiedSigningStatus(d,{providerId:e.provider_id,id:e.id,termsHash:e.terms_hash,testMode:false,recipients:e.recipients})!=='awaiting_counterparty')throw Error('SIGNING_ORDER_CHANGED');
  signingDocumentReadiness(e.kind,dealTermsSchema.parse(e.terms));
  const next=d.recipients.find(r=>r.status!=='signed');
  const expected=e.recipients.find(r=>r.id===job.signerId);
  const signer=raw.submitters.find(s=>s.external_id===`${e.id}:${job.signerId}`);
  if(next?.id!==job.signerId||!expected||expected.phone!==job.phone||expected.id===e.recipients.at(-1)?.id||signer?.id!==job.submitterId||signer.phone!==job.phone||signer.completed_at)throw Error('SIGNER_CHANGED');
  // Do not send phone, fields, completed, or any other term/signature mutation.
  attempted=true;
  const receipt=await request('submitters/'+job.submitterId,'PUT',{send_sms:true,send_email:false});
  if(receipt.id!==job.submitterId||receipt.submission_id!==Number(job.providerId)||receipt.phone!==job.phone||receipt.external_id!==signer.external_id)throw Error('RECEIPT_MISMATCH');
  const saved=await db<{id:string}[]>(`icash_contract_text_resends?id=eq.${job.id}&state=eq.dispatching`,'PATCH',{state:'accepted',updated_at:new Date().toISOString()});
  if(saved.length!==1)throw Error('RECEIPT_STORAGE_FAILED');
  return {status:'accepted' as const,received:false};
 }catch{
  try{await db(`icash_contract_text_resends?id=eq.${job.id}&state=eq.dispatching`,'PATCH',{state:'needs_review',error_code:attempted?'PROVIDER_OR_STORAGE_OUTCOME_UNKNOWN':'PRE_SEND_CHECK_FAILED',updated_at:new Date().toISOString()});}catch{/* A dispatching claim remains spent; never retry automatically. */}
  return {status:'needs_review_do_not_retry' as const};
 }
}
