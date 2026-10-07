import {dispatchAttentionNotification} from './attention-notifications-service';
import {dispatchCustomerUpdate} from './customer-updates-service';
import {normalizeDocuseal as normalize,type Submission} from './docuseal-policy.ts';
import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {dispatchReservedOperation} from '@/lib/operating-costs';
import {signingReadiness,signingDocumentReadiness,signingTermsHash,signingFields,verifiedSigningStatus,type Signer,type SigningKind,type ProviderDocument} from './signing-policy.ts';
import {dealTermsSchema} from './deal-documents.ts';
type Template={max_legal_description_chars:number;customer_consent_field:string|null;provider:string;customer_signature_field:string|null;automated_signing_reviewed:boolean;id:string;provider_template_id:string;placeholder_names:string[];field_map:Record<string,string>;test_mode:boolean;rate_id:string|null;reviewed_until:string};
type Envelope={id:string;account_id:string;deal_id:string;terms:unknown;kind:SigningKind;terms_hash:string;template_id:string;provider_id:string|null;state:string;test_mode:boolean;recipients:{id:string;email?:string|null;phone?:string|null;name:string;placeholder_name:string}[]};
async function request(path:string,body?:unknown,testMode=false,method='POST'){
 const key=testMode?process.env.DOCUSEAL_TEST_API_KEY:process.env.DOCUSEAL_API_KEY;if(!key)throw new Error('Signing setup is not finished.');
 const r=await fetch(`https://api.docuseal.com/${path}`,{method:body?method:'GET',headers:{'X-Auth-Token':key,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw new Error('Signing provider request failed. Do not resend until its status is checked.');return r;
}
const numericId=(id:unknown)=>String(z.coerce.number().int().positive().safe().parse(id));
export async function sendForSignatures(i:{accountId:string;userId:string;customerEmail:string;dealId:string;kind:SigningKind;signers:Signer[];autoSignature?:string}){
 if(!process.env.DOCUSEAL_API_KEY&&!process.env.DOCUSEAL_TEST_API_KEY)throw new Error('Signing setup is not finished.');
 const [deal]=await db<{terms:unknown;stage:string}[]>(`icash_deal_files?id=eq.${i.dealId}&account_id=eq.${i.accountId}&select=terms,stage`);
 const [identity]=await db<{principal:string}[]>(`icash_customer_identities?account_id=eq.${i.accountId}&select=principal`);
 if(!deal||!identity)throw new Error('Deal or legal name missing.');
 const terms=dealTermsSchema.parse(deal.terms);signingReadiness(i.kind,terms,i.signers,identity.principal,deal.stage);
 if(i.signers.some(s=>s.email?.toLowerCase()===i.customerEmail.toLowerCase()))throw new Error('Each party must use their own email.');
 for(const signer of i.signers.filter(s=>s.phone)){
  const threads=await db<{id:string}[]>(`icash_text_threads?account_id=eq.${i.accountId}&deal_id=eq.${i.dealId}&recipient=eq.${encodeURIComponent(signer.phone!)}&party=eq.${i.kind==='purchase'?'seller':'buyer'}&select=id&limit=2`);
  if(threads.length!==1||!await db<boolean>('rpc/icash_sms_thread_review_current','POST',{p_account:i.accountId,p_thread:threads[0].id,p_check_hour:true}))throw Error('This signing number needs a current text conversation for this property.');
  const blocked=await db<{phone:string}[]>(`icash_text_suppressions?phone=eq.${encodeURIComponent(signer.phone!)}&select=phone&limit=1`);
  if(blocked.length)throw Error('This contact has stopped text messages.');
 }
 const testMode=process.env.DOCUSEAL_MODE!=='live';
 if(!testMode&&process.env.ICASH_LIVE_WORK_READY!=='true')throw new Error('Live work is not ready.');
 if(!(testMode?process.env.DOCUSEAL_TEST_API_KEY:process.env.DOCUSEAL_API_KEY))throw new Error('Signing key for this mode is not configured.');
 // Prefer an exact configured form, then the explicitly generic standard form.
 // state_code on a standard form is historical routing metadata, not a legal certification.
 const templateQuery=`kind=eq.${i.kind}&signer_count=eq.${i.signers.length}&test_mode=eq.${testMode}&provider=eq.docuseal&enabled=eq.true&reviewed_until=gt.${encodeURIComponent(new Date().toISOString())}&select=*&limit=2`;
 const exact=await db<Template[]>(`icash_signing_templates?template_scope=eq.state&state_code=eq.${terms.state}&${templateQuery}`);
 const usable=async(candidates:Template[])=>{
  if(candidates.length>1)throw new Error('Duplicate contract template configuration.');
  const candidate=candidates[0];if(!candidate||!(Date.parse(candidate.reviewed_until)>Date.now()))return null;
  if(!testMode){
   const rates=candidate.rate_id?await db<{operation:string;enabled:boolean;expires_at:string;costs_micros?:{messaging?:number}}[]>(`icash_operation_rates?id=eq.${candidate.rate_id}&select=operation,enabled,expires_at,costs_micros`):[];
   const rate=rates.length===1?rates[0]:null;
   if(!rate?.enabled||rate.operation!=='contract_signing'||!(Date.parse(rate.expires_at)>Date.now()))return null;
   // Phone delivery and phone verification each have a provider SMS fee.
   if((rate.costs_micros?.messaging??0)<400000*i.signers.filter(s=>s.phone).length)throw Error('Contract text pricing needs setup. Your agreement has not been sent.');
  }
  return candidate;
 };
 const template=await usable(exact)??await usable(await db<Template[]>(`icash_signing_templates?template_scope=eq.standard&${templateQuery}`));
 if(!template||!(Date.parse(template.reviewed_until)>Date.now()))throw new Error('An active contract template supporting every required signer is needed.');
 if(terms.legalDescription.length>template.max_legal_description_chars)throw new Error('Legal description needs an attached exhibit before signing.');
 if(i.autoSignature&&(!template.automated_signing_reviewed||!template.customer_signature_field||!template.customer_consent_field))throw new Error('Auto-signing authorization is not enabled for this template.');
 const values=signingFields(terms,i.kind);
 // Every term must be deliberately mapped; silently dropping a term is not acceptable.
 if(Object.keys(values).some(k=>!template.field_map[k])||new Set(Object.values(template.field_map)).size!==Object.keys(values).length)throw new Error('Contract field mapping needs review.');
 const recipients=[...i.signers,{name:identity.principal,email:i.customerEmail}].map((s,n)=>({...s,id:String(n+1),placeholder_name:template.placeholder_names[n],delivery_method:'phone' in s&&s.phone?'sms':'email'}));
 if(recipients.some(r=>!r.placeholder_name))throw new Error('Signer mapping needs review.');
 const envelope=await db<Envelope>('rpc/icash_begin_signing','POST',{p_user:i.userId,p_account:i.accountId,p_deal:i.dealId,p_kind:i.kind,p_template:template.id,p_hash:signingTermsHash(terms),p_recipients:recipients});
 try{
  if(signingTermsHash(envelope.terms)!==envelope.terms_hash)throw new Error('Contract changed. Review required before sending.');
  const send=async()=>{
   signingReadiness(i.kind,dealTermsSchema.parse(envelope.terms),i.signers,identity.principal,deal.stage);
   if(i.autoSignature)await db('icash_signature_authorizations','POST',{envelope_id:envelope.id,account_id:i.accountId,actor_user_id:i.userId,terms_hash:envelope.terms_hash,signature_text:i.autoSignature,expires_at:new Date(Math.min(Date.now()+30*86400000,Date.parse(template.reviewed_until))).toISOString()});
   const raw=await (await request('submissions',{template_id:Number(numericId(template.provider_template_id)),order:'preserved',send_email:true,send_sms:false,submitters:recipients.map((r,n)=>({name:r.name,...(r.email?{email:r.email}:{}),...('phone' in r&&r.phone?{phone:r.phone,send_email:false,send_sms:true,require_phone_2fa:true}:{}),role:r.placeholder_name,order:n,external_id:`${envelope.id}:${r.id}`,metadata:{terms_hash:envelope.terms_hash},require_email_2fa:!('phone' in r&&r.phone),fields:n===0?Object.entries(values).map(([k,v])=>({name:template.field_map[k],default_value:v,readonly:true})):[]}))},testMode)).json();
   if(!Array.isArray(raw)||raw.length!==recipients.length||raw.some(r=>r.submission_id!==raw[0].submission_id))throw new Error('Signature response needs review.');
   const providerId=numericId(raw[0].submission_id);
   await db(`icash_signing_envelopes?id=eq.${envelope.id}&state=eq.creating`,'PATCH',{provider_id:providerId,state:'awaiting_counterparty',provider_status:'Created'});
  };
  if(testMode)await send();else await dispatchReservedOperation({accountId:i.accountId,operationKey:`signing:${envelope.id}`,rateId:template.rate_id!,permissionUntil:template.reviewed_until},send);
  return {id:envelope.id,testMode,message:testMode?'Test signing request sent. It cannot put the property under contract.':'Signing request created. The other party signs first. You can review and sign from your workspace.'};
 }catch(e){await db(`icash_signing_envelopes?id=eq.${envelope.id}`,'PATCH',{state:'needs_review'});throw e;}
}
export async function refreshSigning(accountId:string,id:string){
 const [e]=await db<Envelope[]>(`icash_signing_envelopes?id=eq.${id}&account_id=eq.${accountId}&select=*`);
 if(!e?.provider_id)return {status:'needs_review'};
 if(['completed','test_completed'].includes(e.state))return {status:e.state};
 if(!await db<boolean>('rpc/icash_claim_signing_poll','POST',{p_account:accountId,p_id:id}))return {status:e.state};
 let raw=await (await request(`submissions/${numericId(e.provider_id)}`,undefined,e.test_mode)).json() as Submission;
 let d=normalize(raw,e);
 let state=verifiedSigningStatus(d,{providerId:e.provider_id,id:e.id,termsHash:e.terms_hash,testMode:e.test_mode,recipients:e.recipients});
 if(state==='customer_signature_needed'){
  const [reviewedTemplate]=await db<Template[]>(`icash_signing_templates?id=eq.${e.template_id}&select=*`);
  const expectedFields=signingFields(dealTermsSchema.parse(e.terms),e.kind);
  const actualFields=raw.submitters.flatMap(s=>s.values??[]);
  if(Object.entries(expectedFields).some(([key,value])=>!actualFields.some(f=>f.field===reviewedTemplate.field_map[key]&&String(f.value??'')===value)))throw new Error('Agreement field values need review before signing.');
  await db('rpc/icash_save_signing_status','POST',{p_id:e.id,p_state:state,p_evidence:d});
  // A send-time pass does not authorize an expired or incomplete agreement to be signed days later.
  signingDocumentReadiness(e.kind,dealTermsSchema.parse(e.terms));
  // Poll/save existing evidence while new live signatures remain blocked.
  if(!e.test_mode&&process.env.ICASH_LIVE_WORK_READY!=='true')return {status:state};
  const signature=await db<string|null>('rpc/icash_claim_auto_signature','POST',{p_account:accountId,p_envelope:e.id,p_hash:e.terms_hash});
  if(signature){
   const [template]=await db<Template[]>(`icash_signing_templates?id=eq.${e.template_id}&select=*`);
   const customer=raw.submitters.find(s=>s.external_id===`${e.id}:${e.recipients.at(-1)!.id}`)!;
   // One claim, one write. Unknown completion is resolved with GET on later polls, never re-signed blindly.
   signingDocumentReadiness(e.kind,dealTermsSchema.parse(e.terms));
   await request(`submitters/${numericId(customer.id)}`,{completed:true,fields:[{name:template.customer_signature_field,default_value:signature,readonly:true},{name:template.customer_consent_field,default_value:true,readonly:true}]},e.test_mode,'PUT');
   raw=await (await request(`submissions/${numericId(e.provider_id)}`,undefined,e.test_mode)).json();d=normalize(raw,e);
   state=verifiedSigningStatus(d,{providerId:e.provider_id,id:e.id,termsHash:e.terms_hash,testMode:e.test_mode,recipients:e.recipients});
  }
 }
 // Do not retain provider signing URLs, passcodes or edit capabilities in customer-visible evidence.
 const evidence={id:d.id,status:d.status,test_mode:d.test_mode,metadata:d.metadata,apply_signing_order:d.apply_signing_order,recipients:d.recipients.map(r=>({id:r.id,email:r.email,phone:r.phone,status:r.status,signing_order:r.signing_order}))};
 await db('rpc/icash_save_signing_status','POST',{p_id:e.id,p_state:state,p_evidence:evidence});
 if(!e.test_mode&&state==='customer_signature_needed')try{await dispatchAttentionNotification(accountId,{db});}catch{/* Durable notification sources remain available to the worker. */}
 if(!e.test_mode&&['customer_signature_needed','completed'].includes(state))try{await dispatchCustomerUpdate(accountId,{db});}catch{/* Delivery retries remain idempotent in the notification worker. */}
 return {status:state};
}
export async function completedSigningPdf(accountId:string,id:string,audit=false){
 const [e]=await db<Envelope[]>(`icash_signing_envelopes?id=eq.${id}&account_id=eq.${accountId}&select=*`);
 if(!e?.provider_id||!['completed','test_completed'].includes(e.state))throw new Error('Completed signatures required.');
 const raw=await (await request(`submissions/${numericId(e.provider_id)}`,undefined,e.test_mode)).json() as Submission;
 const d=normalize(raw,e);const state=verifiedSigningStatus(d,{providerId:e.provider_id,id:e.id,termsHash:e.terms_hash,testMode:e.test_mode,recipients:e.recipients});
 if(!['completed','test_completed'].includes(state))throw new Error('Completed signatures required.');
 const docs=audit?null:await (await request(`submissions/${numericId(e.provider_id)}/documents?merge=true`,undefined,e.test_mode)).json() as {url:string}[];
 const url=new URL(audit?(raw.audit_log_url??''):(docs?.[0]?.url??''));if(url.protocol!=='https:'||url.hostname!=='docuseal.com'||!['/blobs/','/file/'].some(prefix=>url.pathname.startsWith(prefix)))throw new Error('Combined PDF not ready.');
 const r=await fetch(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(25000)});
 if(!r.ok||!r.headers.get('content-type')?.includes('application/pdf'))throw new Error('Signed PDF is not ready.');
 const bytes=await r.arrayBuffer();if(bytes.byteLength>20*1024*1024)throw new Error('PDF too large.');return bytes;
}
export async function customerSigningLink(accountId:string,id:string,email:string){
 const [e]=await db<Envelope[]>(`icash_signing_envelopes?id=eq.${id}&account_id=eq.${accountId}&select=*`);
 if(!e?.provider_id)throw new Error('Signing request not ready.');
 const raw=await (await request(`submissions/${numericId(e.provider_id)}`,undefined,e.test_mode)).json() as Submission;const d=normalize(raw,e);
 const status=verifiedSigningStatus(d,{providerId:e.provider_id,id:e.id,termsHash:e.terms_hash,testMode:e.test_mode,recipients:e.recipients});
 if(status!=='customer_signature_needed')throw new Error('Waiting for the other party to sign.');
 signingDocumentReadiness(e.kind,dealTermsSchema.parse(e.terms));
 const last=e.recipients.at(-1)!;const r=raw.submitters.find(x=>x.external_id===`${e.id}:${last.id}`);
 if(!r||r.email?.toLowerCase()!==email.toLowerCase()||!/^[a-zA-Z0-9_-]+$/.test(r.slug))throw new Error('Use the signing email sent to your verified address.');
 return {url:`https://docuseal.com/s/${r.slug}`};
}

/** Read the next counterparty's link without exposing it to an LLM or another signer. */
export async function pendingCounterpartySigningLink(accountId:string,id:string,phone:string){
 const [e]=await db<Envelope[]>(`icash_signing_envelopes?id=eq.${id}&account_id=eq.${accountId}&select=*`);
 if(!e?.provider_id||e.test_mode||e.state!=='awaiting_counterparty')throw Error('An approved live contract is required.');
 const raw=await (await request(`submissions/${numericId(e.provider_id)}`,undefined,false)).json() as Submission;
 const d=normalize(raw,e);if(verifiedSigningStatus(d,{providerId:e.provider_id,id:e.id,termsHash:e.terms_hash,testMode:e.test_mode,recipients:e.recipients})!=='awaiting_counterparty')throw Error('Waiting for another signing step.');
 signingDocumentReadiness(e.kind,dealTermsSchema.parse(e.terms));
 const next=d.recipients.find(r=>r.status!=='signed');
 const expected=e.recipients.find(r=>r.id===next?.id);
 const recipient=raw.submitters.find(s=>s.external_id===`${e.id}:${next?.id}`);
 if(!expected||expected.id===e.recipients.at(-1)?.id||expected.phone!==phone||recipient?.phone!==phone||!/^[a-zA-Z0-9_-]+$/.test(recipient.slug))throw Error('This call is not the next signer.');
 return {signerId:expected.id,url:`https://docuseal.com/s/${recipient.slug}`};
}
