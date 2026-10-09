import {normalizeDocuseal,type Submission} from './docuseal-policy.ts';
import {verifiedSigningStatus,signingDocumentReadiness,type SigningKind} from './signing-policy.ts';
import {dealTermsSchema} from './deal-documents.ts';

type Db=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Job={id:string;accountId:string;envelopeId:string;signerId:string;phone:string;providerId:string;submitterId:number;termsHash:string};
type Envelope={id:string;template_id:string;account_id:string;provider_id:string;terms_hash:string;test_mode:boolean;state:string;kind:SigningKind;terms:unknown;recipients:{id:string;email?:string|null;phone?:string|null}[]};
type Dependencies={db:Db;key:string;fetcher?:typeof fetch};

/** Read provider send events for a spent authorization. This path cannot send or re-arm it. */
export async function inspectContractTextResend(hash:string,{db,key,fetcher=fetch}:Dependencies){
 if(!/^[a-f0-9]{64}$/.test(hash)||!key)throw Error('CONFIGURATION_REQUIRED');
 type Row={id:string;envelope_id:string;signer_id:string;recipient:string;expected_provider_id:string;expected_submitter_id:number;terms_hash:string;state:string};
 const [j]=await db<Row[]>(`icash_contract_text_resends?token_hash=eq.${hash}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&state=in.(dispatching,accepted,needs_review)&select=id,envelope_id,signer_id,recipient,expected_provider_id,expected_submitter_id,terms_hash,state&limit=1`);
 if(!j)return {status:'not_authorized' as const};
 if(!Number.isSafeInteger(j.expected_submitter_id)||j.expected_submitter_id<=0)throw Error('SIGNER_BINDING_MISMATCH');
 const r=await fetcher(`https://api.docuseal.com/submitters/${j.expected_submitter_id}`,{method:'GET',headers:{'X-Auth-Token':key},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!r.ok)return {status:'inspection_unavailable' as const,code:`PROVIDER_HTTP_${r.status}`};
 const p=await r.json();
 if(p.id!==j.expected_submitter_id||String(p.submission_id??p.submission?.id)!==j.expected_provider_id||p.external_id!==`${j.envelope_id}:${j.signer_id}`||p.phone!==j.recipient||p.metadata?.terms_hash!==j.terms_hash)throw Error('SIGNER_BINDING_MISMATCH');
 const submissionResponse=await fetcher(`https://api.docuseal.com/submissions/${j.expected_provider_id}`,{method:'GET',headers:{'X-Auth-Token':key},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!submissionResponse.ok)return {status:'inspection_unavailable' as const,code:`PROVIDER_HTTP_${submissionResponse.status}`};
 const submission=await submissionResponse.json();
 if(String(submission.id)!==j.expected_provider_id||!submission.submitters?.some((s:{id?:number;external_id?:string})=>s.id===j.expected_submitter_id&&s.external_id===p.external_id))throw Error('SIGNER_BINDING_MISMATCH');
 const creatorEmail=submission.created_by_user?.email;
 const rawEvents=Array.isArray(p.submission_events)?p.submission_events:[];
 const events=rawEvents.filter((e:{submitter_id?:number})=>e.submitter_id===undefined||e.submitter_id===j.expected_submitter_id).slice(-40).map((e:{event_type?:unknown;event_timestamp?:unknown;data?:Record<string,unknown>})=>({
  type:typeof e.event_type==='string'?e.event_type.slice(0,80):null,
  at:typeof e.event_timestamp==='string'?e.event_timestamp.slice(0,40):null,
  dataKeys:e.data&&typeof e.data==='object'?Object.keys(e.data).slice(0,15):[],
  codes:Object.fromEntries(Object.entries(e.data??{}).filter(([k,v])=>['status','code','error_code'].includes(k)&&typeof v==='string'&&/^[A-Za-z0-9_ .-]{1,100}$/.test(v)))
 }));
 return {status:'inspected' as const,recipientLast4:j.recipient.slice(-4),attemptState:j.state,signerStatus:p.status,
  templateName:typeof p.template?.name==='string'?p.template.name.slice(0,200):null,
  providerTestUser:typeof creatorEmail==='string'?/\+test@/i.test(creatorEmail):null,
  submissionName:typeof submission.name==='string'?submission.name.slice(0,200):null,
  documentNames:Array.isArray(p.documents)?p.documents.map((d:{name?:unknown})=>typeof d.name==='string'?d.name.slice(0,200):null):[],
  sentAt:p.sent_at??null,openedAt:p.opened_at??null,completedAt:p.completed_at??null,
  smsPreference:p.preferences?.send_sms??null,events};
}

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
  const [e]=await db<Envelope[]>(`icash_signing_envelopes?id=eq.${job.envelopeId}&account_id=eq.${job.accountId}&select=id,template_id,account_id,provider_id,terms_hash,test_mode,state,kind,terms,recipients`);
  if(!e||e.id!==job.envelopeId||e.account_id!==job.accountId||e.test_mode||e.state!=='awaiting_counterparty'||e.provider_id!==job.providerId||e.terms_hash!==job.termsHash||!/^\d+$/.test(job.providerId)||!Number.isSafeInteger(job.submitterId)||job.submitterId<=0)throw Error('ENVELOPE_CHANGED');
  const raw=await request('submissions/'+job.providerId) as Submission & {archived_at?:string|null};
  if(raw.archived_at||['expired','declined','completed'].includes(raw.status??''))throw Error('AGREEMENT_NOT_PENDING');
  const d=normalizeDocuseal(raw,e);
  if(verifiedSigningStatus(d,{providerId:e.provider_id,id:e.id,termsHash:e.terms_hash,testMode:false,recipients:e.recipients})!=='awaiting_counterparty')throw Error('SIGNING_ORDER_CHANGED');
  const [template]=await db<{form_profile:string}[]>(`icash_signing_templates?id=eq.${e.template_id}&select=form_profile`);
  if(!template)throw Error('TEMPLATE_MISSING');
  signingDocumentReadiness(e.kind,dealTermsSchema.parse(e.terms),Date.now(),template.form_profile);
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
