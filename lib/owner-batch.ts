import {randomUUID} from 'node:crypto';
import {dealMachineRequest,finishAdmittedDealMachineRequest,DealMachineQuotaError,type ResearchDb} from './dealmachine-request.ts';
import {previewAudience,contactsFromReceipt,creditObservation} from './owner-enrichment.ts';
import {runScreeningJob} from './screening-job.ts';
import {OwnerPreviewRateLimitError} from './owner-enrichment-deferral.ts';
type Candidate={screeningId:string;snapshot:unknown};
type Config={contact_rate_id:string;contact_credit_cap:number;property_credit_micros:number;data_rights_until:string};
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const zero={used:0,people:0,properties:0,deduplicated:0};
export function ownerBatchAudience(raw:unknown,candidates:Candidate[],cap:number){
 const response=object(raw),totals=object(response.totals),credits=creditObservation(raw);
 if(Object.keys(zero).some(k=>credits[k as keyof typeof zero]!==0)||!Array.isArray(response.data)||response.data.length!==candidates.length)throw Error('CONTACT_PREVIEW_INVALID');
 const byId=new Map<string,Record<string,unknown>>();let found=0;
 for(const v of response.data){const row=object(v),id=row.dm_property_id;
  if(typeof id!=='string'||byId.has(id)||typeof row.found!=='boolean'||row.error!==undefined)throw Error('CONTACT_PREVIEW_INVALID');
  byId.set(id,row);if(row.found)found++;
 }
 if(totals.submitted!==candidates.length||totals.found!==found||totals.not_found!==candidates.length-found)throw Error('CONTACT_PREVIEW_INVALID');
 return candidates.map(c=>{
  const propertyId=object(c.snapshot).propertyId;if(typeof propertyId!=='string')throw Error('CONTACT_PREVIEW_INVALID');
  const row=byId.get(propertyId);if(!row)throw Error('CONTACT_PREVIEW_INVALID');
  return {...c,propertyId,...previewAudience({data:row.found?row:{...row,contacts:[]},credits:zero},propertyId,cap)};
 });
}
/** The provider reports aggregate credits, not which individual was deduplicated.
 * Assign each unique person to the first property, then allocate reported used
 * credits in that fixed order. Preserve the original receipt separately; this
 * is explicitly an allocation, never a fabricated per-property provider invoice. */
export function allocateOwnerBatch(raw:unknown,audience:ReturnType<typeof ownerBatchAudience>,batchId:string,now=Date.now()){
 const ids=[...new Set(audience.flatMap(a=>[...a.ids]))];
 const owners=new Map(audience.flatMap(a=>[...a.owners]));
 const validated=contactsFromReceipt(raw,ids,owners),response=object(raw);
 const rows=response.data as Record<string,unknown>[];
 const byId=new Map(rows.map(r=>[String(r.dm_person_id),r]));
 const assigned=new Set<string>();let remaining=validated.credits.used;
 return audience.map(a=>{
  const data=a.ids.map(id=>byId.get(id)!);
  const found=data.filter(r=>r.found===true).length;
  const parsed=contactsFromReceipt({data,totals:{submitted:a.ids.length,found,not_found:a.ids.length-found},credits:{used:0,people:found,properties:0,deduplicated:found}},a.ids,a.owners);
  let uniqueFound=0;for(const id of a.ids)if(byId.get(id)?.found&&!assigned.has(id)){assigned.add(id);uniqueFound++;}
  const used=Math.min(remaining,uniqueFound);remaining-=used;
  const credits={used,people:uniqueFound,properties:0,deduplicated:uniqueFound-used};
  return {screeningId:a.screeningId,result:{propertyId:a.propertyId,creditsUsed:used,peopleCredits:uniqueFound,providerCredits:credits,
   requestedPersonIds:[...a.ids],contacts:parsed.contacts,outreachAuthorized:false,fetchedAt:new Date(now).toISOString(),
   allocation:{batchId,method:'unique-person-order-v1',sharedContacts:found-uniqueFound}}};
 });
}
export async function enrichOwnerBatch(db:ResearchDb,accountId:string,primary:string,c:Config,quotedDataCostMicros:number,transport:typeof fetch=fetch){
 let stage='candidates';
 try{
 if(![c.contact_credit_cap,c.property_credit_micros,quotedDataCostMicros].every(n=>Number.isSafeInteger(n)&&n>0)||c.contact_credit_cap>25||BigInt(c.contact_credit_cap)*BigInt(c.property_credit_micros)>BigInt(quotedDataCostMicros))throw Error('CONTACT_RATE_REQUIRED');
 const candidates=(await db<Candidate[]>('rpc/icash_owner_batch_candidates','POST',{p_account:accountId,p_screening:primary})).filter(x=>runScreeningJob(x.snapshot).financialCheck.status==='eligible');
 if(!candidates.length||candidates.length>5||!candidates.some(x=>x.screeningId===primary))return {status:'held'};
 const batchId=randomUUID(),key=process.env.DEALMACHINE_API_KEY;
 const request=async(path:string,body:object,paid:boolean)=>{
  try{
   const fetchOnce=()=>transport('https://api.v2.dealmachine.com/v1'+path,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
   // The paid request slot and all reservations commit in one SQL transaction.
   // No second limiter race can strand an admitted batch before its purchase.
   const r=paid?await finishAdmittedDealMachineRequest(db,batchId,fetchOnce):await dealMachineRequest(db,'owner_preview',fetchOnce,{accountId,operationKey:'owner-batch:'+batchId});
   if(!r.ok){
    if(paid&&r.raw!==null)await db('rpc/icash_record_owner_batch_receipt','POST',{p_account:accountId,p_batch:batchId,p_receipt:r.raw}).catch(()=>null);
    throw Error(paid?'OWNER_LOOKUP_FAILED_NO_RETRY':'OWNER_PREVIEW_FAILED_NO_RETRY');
   }return r.raw;
  }catch(error){if(!paid&&error instanceof DealMachineQuotaError)throw new OwnerPreviewRateLimitError(accountId,primary);throw error;}
 };
 stage='free_preview';const preview=await request('/properties/ids',{ids:candidates.map(x=>object(x.snapshot).propertyId),enrich:false,contact_audience:'owners'},false);
 stage='preview_validation';
 const audience=ownerBatchAudience(preview,candidates,c.contact_credit_cap).filter(a=>a.ids.length>0);
 if(!audience.some(a=>a.screeningId===primary))return {status:'empty',contacts:0};
 const items=audience.map(a=>({screeningId:a.screeningId,snapshot:a.snapshot,ids:[...a.ids]}));
 stage='admission';const admission=await db<string>('rpc/icash_admit_owner_batch','POST',{p_account:accountId,p_primary:primary,p_batch:batchId,p_items:items,p_preview:preview,
  p_config:{rateId:c.contact_rate_id,creditCap:c.contact_credit_cap,unitCostMicros:c.property_credit_micros,rightsUntil:c.data_rights_until}});
 // Only a committed, exact quota refusal with no paid claim can use the
 // existing bounded unstarted-work deferral. Other failures stay held.
 if(admission==='quota_wait')throw new OwnerPreviewRateLimitError(accountId,primary);
 if(admission!=='claimed'){console.warn('research_owner_batch_hold',{stage,reason:'admission_held'});return {status:'held'};}
 stage='paid_lookup';const raw=await request('/people/ids',{ids:[...new Set(audience.flatMap(a=>[...a.ids]))],enrich:true,include_properties:false},true);
 stage='original_receipt';
 if(!await db<boolean>('rpc/icash_record_owner_batch_receipt','POST',{p_account:accountId,p_batch:batchId,p_receipt:raw}))throw Error('CONTACT_RECEIPT_REQUIRES_RECONCILIATION');
 stage='allocation';const results=allocateOwnerBatch(raw,audience,batchId);
 stage='persist';
 if(!await db<boolean>('rpc/icash_save_owner_batch','POST',{p_account:accountId,p_batch:batchId,p_results:results}))throw Error('CONTACT_RECEIPT_REQUIRES_RECONCILIATION');
 return {status:'contacts_saved',contacts:results.find(r=>r.screeningId===primary)!.result.contacts.length,batchProperties:results.length};
 }catch(error){
  const reasons=['CONTACT_RATE_REQUIRED','CONTACT_PREVIEW_INVALID','CONTACT_RECEIPT_REQUIRES_RECONCILIATION','OWNER_LOOKUP_FAILED_NO_RETRY','OWNER_PREVIEW_FAILED_NO_RETRY'];
  const reason=error instanceof OwnerPreviewRateLimitError?'quota_wait':error instanceof Error&&reasons.includes(error.message)?error.message:'unavailable';
  console.warn('research_owner_batch_hold',{stage,reason});throw error;
 }
}
