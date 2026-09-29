import {normalizeDocuseal as normalize,type Submission} from './docuseal-policy.ts';
import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {dispatchReservedOperation} from '@/lib/operating-costs';
import {signingReadiness,signingTermsHash,signingFields,verifiedSigningStatus,type Signer,type SigningKind,type ProviderDocument} from './signing-policy.ts';
import {dealTermsSchema} from './deal-documents.ts';
type Template={max_legal_description_chars:number;customer_consent_field:string|null;provider:string;customer_signature_field:string|null;automated_signing_reviewed:boolean;id:string;provider_template_id:string;placeholder_names:string[];field_map:Record<string,string>;test_mode:boolean;rate_id:string|null;reviewed_until:string};
type Envelope={id:string;account_id:string;deal_id:string;terms:unknown;kind:SigningKind;terms_hash:string;template_id:string;provider_id:string|null;state:string;test_mode:boolean;recipients:{id:string;email:string;name:string;placeholder_name:string}[]};
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
 if(i.signers.some(s=>s.email.toLowerCase()===i.customerEmail.toLowerCase()))throw new Error('Each party must use their own email.');
 const testMode=process.env.DOCUSEAL_MODE!=='live';
 if(!(testMode?process.env.DOCUSEAL_TEST_API_KEY:process.env.DOCUSEAL_API_KEY))throw new Error('Signing key for this mode is not configured.');
 const [template]=await db<Template[]>(`icash_signing_templates?state_code=eq.${terms.state}&kind=eq.${i.kind}&signer_count=eq.${i.signers.length}&test_mode=eq.${testMode}&provider=eq.docuseal&enabled=eq.true&select=*`);
 if(!template||Date.parse(template.reviewed_until)<=Date.now())throw new Error('A reviewed signing template is needed for this state and signer count.');
 if(terms.legalDescription.length>template.max_legal_description_chars)throw new Error('Legal description needs an attached exhibit before signing.');
 if(i.autoSignature&&(!template.automated_signing_reviewed||!template.customer_signature_field||!template.customer_consent_field))throw new Error('Auto-signing authorization is not enabled for this template.');
 const values=signingFields(terms,i.kind);
 // Every term must be deliberately mapped; silently dropping a term is not acceptable.
 if(Object.keys(values).some(k=>!template.field_map[k])||new Set(Object.values(template.field_map)).size!==Object.keys(values).length)throw new Error('Contract field mapping needs review.');
 const recipients=[...i.signers,{name:identity.principal,email:i.customerEmail}].map((s,n)=>({...s,id:String(n+1),placeholder_name:template.placeholder_names[n],delivery_method:'email'}));
 if(recipients.some(r=>!r.placeholder_name))throw new Error('Signer mapping needs review.');
 if(!testMode){const [rate]=template.rate_id?await db<{operation:string;enabled:boolean}[]>(`icash_operation_rates?id=eq.${template.rate_id}&select=operation,enabled`):[];if(!rate?.enabled||rate.operation!=='contract_signing')throw new Error('Signing cost configuration is not ready.');}
 const envelope=await db<Envelope>('rpc/icash_begin_signing','POST',{p_user:i.userId,p_account:i.accountId,p_deal:i.dealId,p_kind:i.kind,p_template:template.id,p_hash:signingTermsHash(terms),p_recipients:recipients});
 try{
  if(signingTermsHash(envelope.terms)!==envelope.terms_hash)throw new Error('Contract changed. Review required before sending.');
  const send=async()=>{
   if(i.autoSignature)await db('icash_signature_authorizations','POST',{envelope_id:envelope.id,account_id:i.accountId,actor_user_id:i.userId,terms_hash:envelope.terms_hash,signature_text:i.autoSignature,expires_at:new Date(Math.min(Date.now()+30*86400000,Date.parse(template.reviewed_until))).toISOString()});
   const raw=await (await request('submissions',{template_id:Number(numericId(template.provider_template_id)),order:'preserved',send_email:true,send_sms:false,submitters:recipients.map((r,n)=>({name:r.name,email:r.email,role:r.placeholder_name,order:n,external_id:`${envelope.id}:${r.id}`,metadata:{terms_hash:envelope.terms_hash},require_email_2fa:true,fields:n===0?Object.entries(values).map(([k,v])=>({name:template.field_map[k],default_value:v,readonly:true})):[]}))},testMode)).json();
   if(!Array.isArray(raw)||raw.length!==recipients.length||raw.some(r=>r.submission_id!==raw[0].submission_id))throw new Error('Signature response needs review.');
   const providerId=numericId(raw[0].submission_id);
   await db(`icash_signing_envelopes?id=eq.${envelope.id}&state=eq.creating`,'PATCH',{provider_id:providerId,state:'awaiting_counterparty',provider_status:'Created'});
  };
  if(testMode)await send();else await dispatchReservedOperation({accountId:i.accountId,operationKey:`signing:${envelope.id}`,rateId:template.rate_id!,permissionUntil:template.reviewed_until},send);
  return {id:envelope.id,testMode,message:testMode?'Test signing request sent. It cannot put the property under contract.':'Signature request sent. The other party signs first; your signing email follows.'};
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
  const signature=await db<string|null>('rpc/icash_claim_auto_signature','POST',{p_account:accountId,p_envelope:e.id,p_hash:e.terms_hash});
  if(signature){
   const [template]=await db<Template[]>(`icash_signing_templates?id=eq.${e.template_id}&select=*`);
   const customer=raw.submitters.find(s=>s.external_id===`${e.id}:${e.recipients.at(-1)!.id}`)!;
   // One claim, one write. Unknown completion is resolved with GET on later polls, never re-signed blindly.
   await request(`submitters/${numericId(customer.id)}`,{completed:true,fields:[{name:template.customer_signature_field,default_value:signature,readonly:true},{name:template.customer_consent_field,default_value:true,readonly:true}]},e.test_mode,'PUT');
   raw=await (await request(`submissions/${numericId(e.provider_id)}`,undefined,e.test_mode)).json();d=normalize(raw,e);
   state=verifiedSigningStatus(d,{providerId:e.provider_id,id:e.id,termsHash:e.terms_hash,testMode:e.test_mode,recipients:e.recipients});
  }
 }
 // Do not retain provider signing URLs, passcodes or edit capabilities in customer-visible evidence.
 const evidence={id:d.id,status:d.status,test_mode:d.test_mode,metadata:d.metadata,apply_signing_order:d.apply_signing_order,recipients:d.recipients.map(r=>({id:r.id,email:r.email,status:r.status,signing_order:r.signing_order}))};
 await db('rpc/icash_save_signing_status','POST',{p_id:e.id,p_state:state,p_evidence:evidence});
 return {status:state};
}
export async function completedSigningPdf(accountId:string,id:string,audit=false){
 const [e]=await db<Envelope[]>(`icash_signing_envelopes?id=eq.${id}&account_id=eq.${accountId}&select=*`);
 if(!e?.provider_id||!['completed','test_completed'].includes(e.state))throw new Error('Completed signatures required.');
 const raw=await (await request(`submissions/${numericId(e.provider_id)}`,undefined,e.test_mode)).json() as Submission;
 const d=normalize(raw,e);const state=verifiedSigningStatus(d,{providerId:e.provider_id,id:e.id,termsHash:e.terms_hash,testMode:e.test_mode,recipients:e.recipients});
 if(!['completed','test_completed'].includes(state))throw new Error('Completed signatures required.');
 const docs=audit?null:await (await request(`submissions/${numericId(e.provider_id)}/documents?merge=true`,undefined,e.test_mode)).json() as {url:string}[];
 const url=new URL(audit?(raw.audit_log_url??''):(docs?.[0]?.url??''));if(url.protocol!=='https:'||url.hostname!=='docuseal.com'||!url.pathname.startsWith('/blobs/'))throw new Error('Combined PDF not ready.');
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
 const last=e.recipients.at(-1)!;const r=raw.submitters.find(x=>x.external_id===`${e.id}:${last.id}`);
 if(!r||r.email.toLowerCase()!==email.toLowerCase()||!/^[a-zA-Z0-9_-]+$/.test(r.slug))throw new Error('Use the signing email sent to your verified address.');
 return {url:`https://docuseal.com/s/${r.slug}`};
}
