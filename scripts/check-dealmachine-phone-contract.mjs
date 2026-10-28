import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const branch='codex/dealmachine-active-phone-contract-20261027';
const safeKey=v=>typeof v==='string'&&/^[a-zA-Z_][a-zA-Z0-9_]{0,99}$/.test(v)?v:null;
const fieldMetadataKeys=['description','field_id','group_id','is_filterable','is_premium_filter','is_sortable','name','source_type','type','billing_category'];
const exportStates=new Set(['pending','processing','completed','failed']);
const exportId=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(v);
// Preserve the exact historical request. An output alias is not automatically
// a selectable field, and changing it cannot reuse an old request-hash approval.
export const exportVerificationFields=Object.freeze(['dm_person_id','full_name','phones']);
export function exportMetadataAdmission(summary){
 if(summary?.status!=='checked')return 'field_catalog_incomplete';
 if(!Array.isArray(summary.requestedFields)||summary.requestedFields.length!==exportVerificationFields.length
  ||summary.requestedFields.some((f,i)=>f.fieldId!==exportVerificationFields[i]||f.catalogStatus!=='listed'
   ||!['people','address_context'].includes(f.billingCategory)))return 'export_fields_unverified';
 if(summary.existingExports?.complete!==true)return 'export_history_incomplete';
 if(summary.existingExports.stateCounts.pending||summary.existingExports.stateCounts.processing)return 'export_in_progress';
 return 'ready';
}
// Free catalog/history metadata only, scoped to the exact preview branch.
// Never create an export, retrieve contacts or download a history URL.
export async function inspectPhoneContract(env=process.env,transport=fetch,{saveReceipt=async()=>{}}={}){
 if(env.VERCEL_ENV!=='preview'||env.VERCEL_GIT_COMMIT_REF!==branch)return {status:'not_requested',paidRequests:0};
 if(!env.DEALMACHINE_API_KEY)return {status:'unconfigured',paidRequests:0};
 const get=async path=>{
  let r;
  try{r=await transport('https://api.v2.dealmachine.com/v1'+path,{method:'GET',headers:{Authorization:'Bearer '+env.DEALMACHINE_API_KEY},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});}
  catch{await saveReceipt({path,httpStatus:null,raw:null});throw Error('METADATA_UNAVAILABLE');}
  const raw=await r.json().catch(()=>null);
  await saveReceipt({path,httpStatus:r.status,raw});
  if(!r.ok||raw===null)throw Error('METADATA_UNAVAILABLE');return raw;
 };
 const fields=[],catalog=[];let complete=false;
 for(let page=1;page<=4;page++){
  const raw=await get('/fields?source_type=people&per_page=250&page='+page);
  if(!Array.isArray(raw?.data)||raw.data.length>250||typeof raw?.pagination?.has_next_page!=='boolean')throw Error('METADATA_UNAVAILABLE');
  for(const row of raw.data){
   const id=safeKey(row?.field_id);
   if(!id)throw Error('METADATA_CATALOG_INVALID');
   catalog.push(row);
   if(!/(?:phone|activ|(?:^|_)id(?:_|$)|identifier|full_name)/i.test(id))continue;
   fields.push({fieldId:id,type:safeKey(row.type),billingCategory:safeKey(row.billing_category),filterable:row.is_filterable===true,
    metadataKeys:fieldMetadataKeys.filter(k=>Object.hasOwn(row,k)).sort()});
  }
  if(!raw.pagination.has_next_page){complete=true;break;}
 }
 const requestedFields=exportVerificationFields.map(fieldId=>{
  const matches=catalog.filter(f=>f.field_id===fieldId);
  return {fieldId,catalogStatus:!complete?'unknown':matches.length===0?'not_listed':matches.length===1?'listed':'ambiguous',
   billingCategory:matches.length===1?safeKey(matches[0].billing_category):null};
 });
 // A timestamp match never binds history to an original owner/request.
 const exports=await get('/exports?limit=5');
 if(!Array.isArray(exports?.data)||exports.data.length>5)throw Error('METADATA_UNAVAILABLE');
 const stateCounts={pending:0,processing:0,completed:0,failed:0,unknown:0},samples=[];
 for(const row of exports.data){
  let status=exportStates.has(row?.status)?row.status:'unknown',observed=row;
  let detailChecked=false;
  if(['pending','processing','failed'].includes(status)){
   if(!exportId(row.export_id))throw Error('METADATA_EXPORT_ID_INVALID');
   const detail=await get('/exports/'+row.export_id);
   if(detail?.data?.export_id!==row.export_id)throw Error('METADATA_EXPORT_BINDING_INVALID');
   detailChecked=true;observed=detail.data;
   status=exportStates.has(observed.status)?observed.status:'unknown';
  }
  stateCounts[status]++;
  const progress=typeof observed?.progress_stage==='string'?observed.progress_stage:'';
  samples.push({status,detailChecked,
    failureReason:status==='failed'?( /\bno records\b/i.test(progress)?'provider_reported_no_records':'provider_failure'):null,
    activityFilterMentioned:/\bactive[ _-]+phone(?:s|[ _-]+numbers)?(?:[ _-]+only)?\b/i.test(progress),
    // Never echo free-form names, progress messages, URLs or unknown keys.
    creditsKeys:['used','people','properties','deduplicated','licensed'].filter(k=>Object.hasOwn(row.credits??{},k)),
    records:Number.isSafeInteger(row.record_count)?row.record_count:null,
    files:Array.isArray(row.download_urls)?row.download_urls.slice(0,5).map(f=>({size:Number.isSafeInteger(f.size)?f.size:null,
     people:typeof f.filename==='string'&&/^people_export_/.test(f.filename),gzip:typeof f.filename==='string'&&f.filename.endsWith('.csv.gz')})):[]});
 }
 const total=Number.isSafeInteger(exports.pagination?.total)&&exports.pagination.total>=0?exports.pagination.total:null;
 const summary={status:complete?'checked':'catalog_incomplete',paidRequests:0,fields,requestedFields,
  existingExports:{allStatuses:true,total,hasMore:exports.pagination?.has_more??null,
   complete:exports.pagination?.has_more===false&&total===exports.data.length&&stateCounts.unknown===0,stateCounts,samples}};
 return {...summary,admission:exportMetadataAdmission(summary)};
}

/** Separate, insert-only private snapshot. Never updates a paid approval. */
export async function inspectSavedPhoneContract(env=process.env,loadDb=async()=> (await import('../lib/stripe-test.ts')).db,transport=fetch){
 if(env.VERCEL_ENV!=='preview'||env.VERCEL_GIT_COMMIT_REF!==branch)return {status:'not_requested',paidRequests:0};
 if(env.VERCEL_GIT_REPO_OWNER!=='richoffcashflow'||env.VERCEL_GIT_REPO_SLUG!=='iCash-X-2.0-'
  ||env.SUPABASE_URL?.replace(/\/$/,'')!=='https://ofjbbpwugyjfxbhqfguh.supabase.co'||!env.SUPABASE_SECRET_KEY
  ||!env.DEALMACHINE_API_KEY||! /^[0-9a-f]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA??''))return {status:'configuration_unavailable',paidRequests:0};
 const db=await loadDb(),provider='dealmachine_phone_contract_metadata_v2_'+env.VERCEL_GIT_COMMIT_SHA;
 const path='icash_integration_checks?provider=eq.'+provider+'&select=result';
 const prior=await db(path);
 if(!Array.isArray(prior)||prior.length>1)throw Error('METADATA_SNAPSHOT_INVALID');
 if(prior.length===1)return {...prior[0].result.summary,snapshot:'already_saved'};
 const receipts=[];let summary;
 try{summary=await inspectPhoneContract(env,transport,{saveReceipt:async receipt=>{receipts.push(receipt);}});}
 catch(error){summary={status:'metadata_unavailable',paidRequests:0,reason:/^METADATA_[A-Z_]+$/.test(error?.message??'')?error.message:'METADATA_UNAVAILABLE'};}
 const result={version:2,reviewedCommit:env.VERCEL_GIT_COMMIT_SHA,observedAt:new Date().toISOString(),summary,receipts};
 try{
  const saved=await db('icash_integration_checks','POST',{provider,checked_at:result.observedAt,result});
  if(!Array.isArray(saved)||saved.length!==1)throw Error('METADATA_SAVE_UNCONFIRMED');
 }catch{
  // A concurrent free read can win the unique insert. Reuse its original
  // snapshot; a missing save never authorizes an export or approval reset.
  const saved=await db(path).catch(()=>null);
  if(saved?.length!==1)return {status:'metadata_save_unconfirmed',paidRequests:0};
  return {...saved[0].result.summary,snapshot:'already_saved'};
 }
 return {...summary,snapshot:'saved'};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 try{console.log('DealMachine phone contract: '+JSON.stringify(await inspectSavedPhoneContract()));}
 catch{console.log('DealMachine phone contract: unavailable; paid requests: 0.');}
}
