import {createHash,randomUUID} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import {dealMachineRequest,finishAdmittedDealMachineRequest,DealMachineQuotaError,type ResearchDb} from './dealmachine-request.ts';
import {ownerBatchAudience} from './owner-batch.ts';
import {previewAudience} from './owner-enrichment.ts';
import {runScreeningJob} from './screening-job.ts';
import {OwnerPreviewRateLimitError} from './owner-enrichment-deferral.ts';

type Candidate={screeningId:string;snapshot:unknown};
type Config={contact_rate_id:string;contact_credit_cap:number;property_credit_micros:number;data_rights_until:string;research_version?:number};
type Audience=ReturnType<typeof ownerBatchAudience>;
type Receipt={httpStatus:number;raw:unknown;rawText:string};
type SavedExport={id:string;accountId:string;createdAt:string;items:Candidate[];preview:unknown;request:ReturnType<typeof activeOwnerExportRequest>;receipt:Receipt;recovery:unknown;csv:string|null;lease:string};
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const invalid=()=>{throw Error('OWNER_EXPORT_RECONCILIATION_REQUIRED');};
export const activeOwnerColumns=['internal_person_id','person_full_name','person_address_full','phone_1','is_phone_1_dnc','people_phone_1_type_id','phone_2','is_phone_2_dnc','people_phone_2_type_id','phone_3','is_phone_3_dnc','people_phone_3_type_id','email_address_1','email_address_2','email_address_3','has_active_phone_number'];

export function activeOwnerExportRequest(ids:string[]){
 if(!ids.length||ids.length>125||new Set(ids).size!==ids.length||ids.some(id=>!/^per_[0-9]{1,100}$/.test(id)))return invalid();
 return {people_ids:ids,fields:['person_full_name','has_active_phone_number'],property_match:'owner',anchor:'person',limit:ids.length,require_phone:true,scrub_dnc:true,active_phones_only:true};
}
/** Bounded RFC4180 reader. IDs stay text, including values above MAX_SAFE_INTEGER. */
export function parseOwnerExportCsv(text:string){
 if(typeof text!=='string'||Buffer.byteLength(text)>1048576)return invalid();
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
  if(c==='"'){if(cell||closed)return invalid();quoted=true;continue;}
  if(c===','||c==='\n'||c==='\r'){
   row.push(cell);cell='';closed=false;
   if(row.length>activeOwnerColumns.length)return invalid();
   if(c!==','){rows.push(row);row=[];if(c==='\r'&&text[i+1]==='\n')i++;if(rows.length>126)return invalid();}
  }else{if(closed)return invalid();cell+=c;}
 }
 if(quoted)return invalid();if(cell||row.length||closed){row.push(cell);rows.push(row);}
 if(rows[0]?.[0])rows[0][0]=rows[0][0].replace(/^\uFEFF/,'');
 const header=rows.shift();
 if(!header||header.length!==activeOwnerColumns.length||new Set(header).size!==header.length||header.some(h=>!activeOwnerColumns.includes(h))||rows.some(r=>r.length!==header.length)||rows.length>125)return invalid();
 return rows.map(r=>Object.fromEntries(header.map((h,i)=>[h,r[i]])));
}
export function validateOwnerExportReceipt(receipt:Receipt,request:ReturnType<typeof activeOwnerExportRequest>){
 const r=object(receipt.raw),c=object(r.credits);
 if(receipt.httpStatus!==200||typeof r.export_id!=='string'||!/^[-a-zA-Z0-9_]{1,128}$/.test(r.export_id)
  ||!integer(r.record_count)||r.record_count>request.people_ids.length||r.file_count!==1
  ||!integer(c.used)||!integer(c.people)||c.people!==r.record_count||c.used>c.people
  ||Object.keys(c).some(k=>!['used','people','properties','deduplicated','licensed'].includes(k)||!integer(c[k]))
  ||(Object.hasOwn(c,'properties')&&c.properties!==0)
  ||(Object.hasOwn(c,'deduplicated')&&(c.deduplicated as number)>c.people)
  ||(Object.hasOwn(c,'licensed')&&(c.licensed as number)>c.people))return invalid();
 return {raw:r,credits:c as Record<string,number>,exportId:r.export_id,rows:r.record_count};
}
/** Raw provider totals are preserved. Allocation fields are explicitly ours;
 * missing deduplication/licensing fields are never synthesized. */
export function allocateActiveOwnerExport(saved:Pick<SavedExport,'id'|'createdAt'|'request'|'receipt'>,csv:string,audience:Audience){
 const receipt=validateOwnerExportReceipt(saved.receipt,saved.request),rows=parseOwnerExportCsv(csv);
 const ids=[...new Set(audience.flatMap(a=>[...a.ids]))];
 if(!isDeepStrictEqual(saved.request,activeOwnerExportRequest(ids))||rows.length!==receipt.rows)return invalid();
 const byId=new Map<string,typeof rows[number]>();
 for(const row of rows){const id='per_'+row.internal_person_id;
  if(!ids.includes(id)||byId.has(id)||!['Yes','true'].includes(row.has_active_phone_number)||!row.person_full_name||row.person_full_name.length>200)return invalid();
  byId.set(id,row);
 }
 const assigned=new Set<string>();let remaining=receipt.credits.used;
 const sha256=createHash('sha256').update(csv).digest('hex');
 const results=audience.map(a=>{
  let unique=0;
  const contacts=a.ids.flatMap(id=>{
   const row=byId.get(id);if(!row)return [];
   const match=a.owners.get(id);if(!match?.likelyOwner||match.availablePhones===0)return invalid();
   if(!assigned.has(id)){assigned.add(id);unique++;}
   const phones=[];const seen=new Set<string>();
   for(let i=1;i<=3;i++){
    const number=row['phone_'+i],dnc=row['is_phone_'+i+'_dnc'],type=row['people_phone_'+i+'_type_id'];
    if(!number){if(dnc||type)return invalid();continue;}
    if(!/^\d{10}$/.test(number)||!['No','false'].includes(dnc)||!type||type.length>30||seen.has(number))return invalid();
    seen.add(number);phones.push({number,doNotCall:false,type,permission:'unverified',activity:'active',activityBasis:'provider_export_filter'});
   }
   if(!phones.length)return invalid();
   return [{personId:id,name:row.person_full_name,likelyOwner:true,propertyContactType:match.propertyContactType,matchFlags:match.matchFlags,
    ownershipVerified:false,outreachAuthorized:false,phones,emails:[]}];
  });
  const used=Math.min(remaining,unique);remaining-=used;
  return {screeningId:a.screeningId,result:{propertyId:a.propertyId,creditsUsed:used,peopleCredits:unique,providerCredits:receipt.credits,
   requestedPersonIds:[...a.ids],contacts,outreachAuthorized:false,fetchedAt:saved.createdAt,
   allocation:{batchId:saved.id,method:'active-export-used-order-v1',sharedContacts:contacts.length-unique},
   activityEvidence:{contract:'owner-active-export-v1',exportId:receipt.exportId,artifactSha256:sha256}}};
 });
 if(remaining!==0)return invalid();return results;
}
async function boundedBody(response:Response,maximum:number){
 if(!response.body)throw Error('OWNER_EXPORT_RESPONSE_UNAVAILABLE');
 const reader=response.body.getReader(),parts:Buffer[]=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maximum)throw Error('OWNER_EXPORT_RESPONSE_TOO_LARGE');parts.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>null);}
 return Buffer.concat(parts);
}
async function downloadOriginal(url:unknown,transport:typeof fetch){
 if(typeof url!=='string')return invalid();const u=new URL(url);
 if(u.protocol!=='https:'||u.hostname!=='storage.googleapis.com'||u.username||u.password||u.hash||(u.port&&u.port!=='443'))return invalid();
 const response=await transport(u,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('OWNER_EXPORT_DOWNLOAD_UNAVAILABLE');
 const bytes=await boundedBody(response,1048576),plain=bytes[0]===0x1f&&bytes[1]===0x8b?gunzipSync(bytes,{maxOutputLength:1048576}):bytes;
 return new TextDecoder('utf-8',{fatal:true}).decode(plain);
}
async function recoverClaimedExport(db:ResearchDb,saved:SavedExport,transport:typeof fetch){
 const original=object(saved.receipt.raw),exportId=original.export_id;
 if(typeof exportId!=='string'||!/^[-a-zA-Z0-9_]{1,128}$/.test(exportId))return invalid();
 let recovery=object(saved.recovery),csv=saved.csv;
 if(!csv){
  // This is always the original ID, never a search/history match or new export.
  let rawText='';
  const r=await dealMachineRequest(db,'owner_preview',async()=>{
   const response=await transport('https://api.v2.dealmachine.com/v1/exports/'+exportId,{method:'GET',headers:{Authorization:`Bearer ${process.env.DEALMACHINE_API_KEY}`},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
   rawText=(await boundedBody(response,131072)).toString('utf8');
   return new Response(rawText,{status:response.status,headers:response.headers});
  },{accountId:saved.accountId,operationKey:'owner-export-recovery:'+saved.id});
  if(await db<boolean>('rpc/icash_record_owner_export_recovery','POST',{p_batch:saved.id,p_lease:saved.lease,p_receipt:{httpStatus:r.status,raw:r.raw,rawText}})!==true)return invalid();
  recovery=object(r.raw);
  const data=object(recovery.data);
  if(!r.ok||data.export_id!==exportId||data.status!=='completed'||data.record_count!==original.record_count)return {status:'export_receipt_held'};
  const files=data.download_urls;if(!Array.isArray(files)||files.length!==1)return invalid();
  csv=await downloadOriginal(object(files[0]).url,transport);
  // Save even a malformed CSV privately before interpreting or settling it.
  if(await db<boolean>('rpc/icash_record_owner_export_artifact','POST',{p_batch:saved.id,p_lease:saved.lease,p_csv:csv})!==true)return invalid();
 }
 const preview=object(saved.preview);
 if(!Array.isArray(preview.data))return invalid();
 const audience=saved.items.map(item=>{
  const propertyId=object(item.snapshot).propertyId;if(typeof propertyId!=='string')return invalid();
  const matches=(preview.data as unknown[]).filter(row=>object(row).dm_property_id===propertyId);
  if(matches.length!==1)return invalid();
  const parsed=previewAudience({data:matches[0],credits:preview.credits},propertyId,25);
  const bound=(item as Candidate&{ids:string[]}).ids;
  if(!Array.isArray(bound)||bound.some(id=>!parsed.ids.includes(id)))return invalid();
  return {...item,propertyId,...parsed,ids:bound};
 });
 const results=allocateActiveOwnerExport(saved,csv,audience);
 if(await db<boolean>('rpc/icash_save_owner_active_export','POST',{p_batch:saved.id,p_lease:saved.lease,p_results:results,p_rows:parseOwnerExportCsv(csv)})!==true)return invalid();
 return {status:'contacts_saved',batchProperties:results.length};
}
/** Maintenance only resumes original GET/download/persistence. Never a POST. */
export async function recoverOwnerActiveExports(db:ResearchDb,transport:typeof fetch=fetch,batchId:string|null=null){
 if(!/^dm_sk_live_[A-Za-z0-9_-]+$/.test(process.env.DEALMACHINE_API_KEY??''))return {status:'provider_not_configured'};
 const saved=await db<SavedExport|null>('rpc/icash_claim_owner_export_recovery','POST',{p_batch:batchId});
 if(!saved)return {status:'export_recovery_idle'};
 try{return await recoverClaimedExport(db,saved,transport);}catch{
  console.warn('owner_active_export_held',{stage:'original_recovery'});return {status:'export_receipt_held'};
 }
}
export async function enrichActiveOwners(db:ResearchDb,accountId:string,primary:Candidate,c:Config,quotedDataCostMicros:number,transport:typeof fetch=fetch){
 if(![c.contact_credit_cap,c.property_credit_micros,quotedDataCostMicros].every(n=>Number.isSafeInteger(n)&&n>0)||c.contact_credit_cap>25||BigInt(c.contact_credit_cap)*BigInt(c.property_credit_micros)>BigInt(quotedDataCostMicros))throw Error('CONTACT_RATE_REQUIRED');
 const capacity=await db<string>('rpc/icash_owner_active_export_capacity','POST',{});
 if(capacity==='export_busy'||capacity==='quota_wait')throw new OwnerPreviewRateLimitError(accountId,primary.screeningId);
 if(capacity!=='ready')return {status:'held'};
 const candidates=c.research_version===1||c.research_version===2?await db<Candidate[]>('rpc/icash_owner_batch_candidates','POST',{p_account:accountId,p_screening:primary.screeningId}):[primary];
 if(!candidates.length||candidates.length>5||!candidates.some(x=>x.screeningId===primary.screeningId)||candidates.some(x=>runScreeningJob(x.snapshot).financialCheck.status!=='eligible'))return {status:'held'};
 const batchId=randomUUID(),key=process.env.DEALMACHINE_API_KEY;
 let preview:unknown;
 try{
  const r=await dealMachineRequest(db,'owner_preview',()=>transport('https://api.v2.dealmachine.com/v1/properties/ids',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({ids:candidates.map(x=>object(x.snapshot).propertyId),enrich:false,contact_audience:'owners'}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)}),{accountId,operationKey:'owner-batch:'+batchId});
  if(!r.ok)throw Error('OWNER_PREVIEW_FAILED_NO_RETRY');preview=r.raw;
 }catch(error){if(error instanceof DealMachineQuotaError)throw new OwnerPreviewRateLimitError(accountId,primary.screeningId);throw error;}
 const audience=ownerBatchAudience(preview,candidates,c.contact_credit_cap).filter(a=>a.ids.length);
 if(!audience.length)return {status:'empty',contacts:0};
 const request=activeOwnerExportRequest([...new Set(audience.flatMap(a=>[...a.ids]))]);
 const admission=await db<string>('rpc/icash_admit_owner_active_export','POST',{p_account:accountId,p_primary:audience.find(a=>a.screeningId===primary.screeningId)?.screeningId??audience[0].screeningId,p_batch:batchId,
  p_items:audience.map(a=>({screeningId:a.screeningId,snapshot:a.snapshot,ids:[...a.ids]})),p_preview:preview,p_request:request,
  p_config:{rateId:c.contact_rate_id,creditCap:c.contact_credit_cap,unitCostMicros:c.property_credit_micros,rightsUntil:c.data_rights_until}});
 if(['quota_wait','export_busy'].includes(admission))throw new OwnerPreviewRateLimitError(accountId,primary.screeningId);
 if(admission!=='claimed')return {status:'held'};
 // Durable SQL admission owns this one attempt forever, even after disconnect.
 // Save the exact response before parsing, metrics, download or settlement.
 await finishAdmittedDealMachineRequest(db,batchId,async()=>{
  const r=await transport('https://api.v2.dealmachine.com/v1/people/export',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(request),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(120000)});
  const rawText=(await boundedBody(r,524288)).toString('utf8');let raw:unknown=null;try{raw=JSON.parse(rawText);}catch{}
  if(await db<boolean>('rpc/icash_record_owner_export_receipt','POST',{p_account:accountId,p_batch:batchId,p_receipt:{httpStatus:r.status,rawText,raw}})!==true)throw Error('OWNER_EXPORT_RECEIPT_SAVE_UNCONFIRMED');
  return new Response(rawText,{status:r.status,headers:r.headers});
 });
 const recovered=await recoverOwnerActiveExports(db,transport,batchId);
 // A saved error without an export ID cannot enter original-ID recovery. It
 // remains an unresolved purchase, never ordinary idle work or a retry signal.
 const result=recovered.status==='export_recovery_idle'?{status:'export_receipt_held'}:recovered;
 if(result.status==='contacts_saved'&&!audience.some(a=>a.screeningId===primary.screeningId))return {...result,status:'empty',contacts:0};
 return result;
}
