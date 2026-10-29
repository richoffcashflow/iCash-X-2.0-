import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {inspectSavedActiveExport} from './dealmachine-export-artifact.mjs';

export const activePhoneExportV3='dealmachine_active_phone_export_verification_20261028_v3';
const branch='codex/dealmachine-active-phone-contract-20261027';
const fields=Object.freeze(['person_full_name','has_active_phone_number']);
const priorProviders=['dealmachine_active_phone_export_verification_20261027_v1','dealmachine_active_phone_export_verification_20261027_v2'];
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
export function activePhoneExportV3Request(personId){
 if(typeof personId!=='string'||!/^per_[1-9][0-9]{0,30}$/.test(personId))throw Error('EXPORT_OWNER_INVALID');
 return {people_ids:[personId],fields:[...fields],property_match:'owner',anchor:'person',limit:1,require_phone:true,scrub_dnc:true,active_phones_only:true};
}
export const activePhoneExportV3Hash=body=>createHash('sha256').update(JSON.stringify(body)).digest('hex');
const headersOf=response=>Object.fromEntries(['X-RateLimit-Limit','X-RateLimit-Remaining','X-RateLimit-Reset','X-RateLimit-Day-Limit','X-RateLimit-Day-Remaining','Retry-After'].map(key=>{
 const value=response.headers.get(key);return [key,key==='Retry-After'?value:value!==null&&/^\d{1,10}$/.test(value)?Number(value):null];
}));
const creditSummary=raw=>Object.fromEntries(['used','people','properties','deduplicated','licensed'].filter(k=>integer(raw?.credits?.[k])).map(k=>[k,raw.credits[k]]));
function quotaAllows(h){
 return integer(h?.['X-RateLimit-Limit'])&&h['X-RateLimit-Limit']>0&&integer(h['X-RateLimit-Day-Limit'])&&h['X-RateLimit-Day-Limit']>0
  &&integer(h['X-RateLimit-Remaining'])&&h['X-RateLimit-Remaining']>0&&h['X-RateLimit-Remaining']<=h['X-RateLimit-Limit']
  &&integer(h['X-RateLimit-Day-Remaining'])&&h['X-RateLimit-Day-Remaining']>0&&h['X-RateLimit-Day-Remaining']<=h['X-RateLimit-Day-Limit']&&h['Retry-After']===null;
}
async function boundedBody(response){
 if(!response.body)throw Error('EXPORT_RESPONSE_UNAVAILABLE');
 const reader=response.body.getReader(),parts=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>524288)throw Error('EXPORT_RESPONSE_TOO_LARGE');parts.push(Buffer.from(value));}}
 finally{await reader.cancel().catch(()=>null);}
 const rawText=Buffer.concat(parts).toString('utf8');let raw=null;try{raw=JSON.parse(rawText);}catch{}
 return {raw,rawText};
}

/** One new allowance after "keep testing": one saved owner, one export POST,
 * one people credit maximum by exact ID/people-only output. The fixed private
 * key is consumed before any request; all previous outcomes remain untouched.
 * This is a preview diagnostic, not production acquisition or settlement.
 */
export async function checkApprovedActivePhoneExportV3({env=process.env,db,loadDb=async()=> (await import('../lib/stripe-test.ts')).db,transport=fetch,clock=Date.now}={}){
 const idle=status=>({status,providerRequests:0,paidRequests:0});
 if(env.GITHUB_ACTIONS==='true'||env.VERCEL_ENV!=='preview'||env.VERCEL_GIT_COMMIT_REF!==branch)return idle('not_requested');
 if(env.VERCEL_GIT_REPO_OWNER!=='richoffcashflow'||env.VERCEL_GIT_REPO_SLUG!=='iCash-X-2.0-'
  ||env.SUPABASE_URL?.replace(/\/$/,'')!=='https://ofjbbpwugyjfxbhqfguh.supabase.co'||!env.SUPABASE_SECRET_KEY
  ||!/^dm_sk_live_[A-Za-z0-9_-]+$/.test(env.DEALMACHINE_API_KEY??'')||!/^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA??''))return idle('configuration_unavailable');
 db??=await loadDb();
 const path='icash_integration_checks?provider=eq.'+activePhoneExportV3;
 const rows=await db(path+'&select=result');
 if(rows?.length!==1||!object(rows[0].result))return idle('not_approved');
 const approval=rows[0].result,now=clock();
 if(approval.status!=='approved')return idle('already_consumed');
 const body=activePhoneExportV3Request(approval.personId);
 if(approval.version!==3||approval.explicitOwnerApproval!==true||approval.maxCredits!==1||approval.maxPaidRequests!==1||approval.maxProviderRequests!==4
  ||approval.customerWalletCharge!==false||approval.callsOrTexts!==false||approval.automaticRetry!==false||approval.allowAboveAppQuota!==false
  ||!uuid(approval.approvalId)||!uuid(approval.accountId)||!uuid(approval.screeningId)||!/^prop_[1-9][0-9]{0,19}$/.test(approval.propertyId??'')
  ||approval.reviewedCommit!==env.VERCEL_GIT_COMMIT_SHA||approval.requestHash!==activePhoneExportV3Hash(body)||!isDeepStrictEqual(approval.request,body)
  ||!Number.isFinite(Date.parse(approval.approvedAt))||!Number.isFinite(Date.parse(approval.expiresAt))||Date.parse(approval.approvedAt)>now||Date.parse(approval.expiresAt)<=now
  ||Date.parse(approval.expiresAt)-Date.parse(approval.approvedAt)>3600000)throw Error('EXPORT_APPROVAL_INVALID');
 // Bind the new allowance to both consumed attempts; never reopen them.
 for(const provider of priorProviders){
  const prior=await db('icash_integration_checks?provider=eq.'+provider+'&select=result');
  if(prior?.length!==1||prior[0]?.result?.status!=='response_saved'||prior[0].result.httpStatus!==500
   ||!uuid(approval.previousRuns?.[provider])||prior[0].result.runId!==approval.previousRuns[provider])throw Error('EXPORT_PRIOR_BINDING_INVALID');
 }
 const sources=await db(`icash_owner_contacts?account_id=eq.${approval.accountId}&screening_id=eq.${approval.screeningId}&select=result,created_at,operation_key`);
 const source=sources?.[0],owner=source?.result?.contacts?.filter(p=>p.personId===approval.personId);
 if(sources?.length!==1||source.result?.propertyId!==approval.propertyId||source.operation_key!==approval.sourceOperation
  ||Date.parse(source.created_at)!==Date.parse(approval.sourceCreatedAt)||!source.result.requestedPersonIds?.includes(approval.personId)
  ||owner?.length!==1||owner[0].likelyOwner!==true||owner[0].matchFlags?.is_likely_renter===true||!['owner',null].includes(owner[0].propertyContactType)
  ||!Array.isArray(owner[0].phones)||!owner[0].phones.some(p=>typeof p.number==='string'&&p.doNotCall===false)
  ||!Number.isFinite(Date.parse(source.created_at))||Date.parse(source.created_at)>now||now-Date.parse(source.created_at)>86400000)throw Error('EXPORT_SOURCE_INVALID');
 const started=await db('rpc/icash_dealmachine_owner_source_started_at','POST',{p_account:approval.accountId,p_screening:approval.screeningId});
 if(typeof started!=='string'||!Number.isFinite(Date.parse(started))||Date.parse(started)>Date.parse(source.created_at))throw Error('EXPORT_SOURCE_INVALID');
 if(await db('rpc/icash_dealmachine_capacity_available','POST',{p_requests:4})!==true)return idle('quota_wait');
 if(clock()>=Date.parse(approval.expiresAt))return idle('approval_expired');
 const runId=randomUUID();let state={...approval,status:'started',runId,startedAt:new Date(clock()).toISOString(),requests:[],outreach:false};
 const claim=await db(path+'&result->>status=eq.approved&result=eq.'+encodeURIComponent(JSON.stringify(approval)),'PATCH',{checked_at:state.startedAt,result:state});
 if(claim?.length!==1||claim[0]?.result?.runId!==runId)return idle('claim_not_confirmed');
 const receiptPath=path+'&result->>runId=eq.'+runId;
 const save=async next=>{const saved=await db(receiptPath,'PATCH',{checked_at:new Date(clock()).toISOString(),result:next});if(saved?.length!==1||saved[0]?.result?.runId!==runId)throw Error('EXPORT_SAVE_UNCONFIRMED');state=next;};
 const finish=async(status,details={})=>{
  const sent=state.requests.filter(r=>r.notDispatched!==true),summary={status,providerRequests:sent.length,paidRequests:sent.filter(r=>r.method==='POST').length,productionEnabled:false,...details};
  await save({...state,status,summary});return summary;
 };
 const request=async(method,endpoint,requestBody,quotaReceivedAt)=>{
  if(state.requests.length>=4||method==='POST'&&(endpoint!=='/people/export'||state.requests.some(r=>r.method==='POST')||!isDeepStrictEqual(requestBody,body)))throw Error('EXPORT_REQUEST_LIMIT');
  const id=randomUUID(),entry={id,method,path:endpoint,startedAt:new Date(clock()).toISOString(),httpStatus:null,raw:null};
  await save({...state,requests:[...state.requests,entry]});
  if(clock()>=Date.parse(approval.expiresAt)||method==='POST'&&clock()-quotaReceivedAt>10000){
   await save({...state,requests:[...state.requests.slice(0,-1),{...entry,notDispatched:true}]});return {localBlocked:true};
  }
  const admitted=await db('rpc/icash_take_dealmachine_request','POST',{p_kind:'owner_lookup',p_account:approval.accountId,p_operation:activePhoneExportV3,p_request:id});
  if(admitted!==true){await save({...state,requests:[...state.requests.slice(0,-1),{...entry,notDispatched:true}]});return {localBlocked:true};}
  if(clock()>=Date.parse(approval.expiresAt)||method==='POST'&&clock()-quotaReceivedAt>10000){
   await save({...state,requests:[...state.requests.slice(0,-1),{...entry,notDispatched:true}]});
   await db('rpc/icash_finish_dealmachine_request','POST',{p_request:id,p_result:{outcome:'not_dispatched'}});return {localBlocked:true};
  }
  let observed;
  try{
   const response=await transport('https://api.v2.dealmachine.com/v1'+endpoint,{method,headers:{Authorization:'Bearer '+env.DEALMACHINE_API_KEY,...(requestBody?{'Content-Type':'application/json'}:{})},
    ...(requestBody?{body:JSON.stringify(requestBody)}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(method==='POST'?120000:15000)});
   const payload=await boundedBody(response),headers=headersOf(response),receivedAt=clock();
   observed={...state,requests:[...state.requests.slice(0,-1),{...entry,httpStatus:response.status,headers,...payload}]};
   if(method==='POST')observed={...observed,httpStatus:response.status,receipt:payload.raw};
   await save(observed);
   await db('rpc/icash_finish_dealmachine_request','POST',{p_request:id,p_result:{outcome:response.ok?'response':'http_error',httpStatus:response.status,creditsUsed:integer(payload.raw?.credits?.used)?payload.raw.credits.used:null,
    minuteRemaining:headers['X-RateLimit-Remaining'],dayRemaining:headers['X-RateLimit-Day-Remaining'],minuteLimit:headers['X-RateLimit-Limit'],minuteReset:headers['X-RateLimit-Reset'],dayLimit:headers['X-RateLimit-Day-Limit'],
    retryAfter:typeof headers['Retry-After']==='string'&&/^\d{1,10}$/.test(headers['Retry-After'])?Number(headers['Retry-After']):null}}).catch(()=>null);
   return {ok:response.ok,httpStatus:response.status,...payload,headers,receivedAt};
  }catch{
   await save({...(observed??state),status:'unknown',reason:observed?'receipt_save_unconfirmed':'original_response_unavailable'}).catch(()=>null);
   await db('rpc/icash_finish_dealmachine_request','POST',{p_request:id,p_result:{outcome:'unknown'}}).catch(()=>null);
   throw Error('EXPORT_UNKNOWN_NO_RETRY');
  }
 };
 const catalog=await request('GET','/fields?source_type=people&per_page=250&page=1');
 if(catalog.localBlocked)return finish('dispatch_held');
 if(!catalog.ok)return finish('catalog_http_error',{httpStatus:catalog.httpStatus});
 const catalogFields=catalog.raw?.data;
 if(!Array.isArray(catalogFields)||catalogFields.length>250||catalog.raw.pagination?.has_next_page!==false||fields.some((id,i)=>{
  const matched=catalogFields.filter(f=>f?.field_id===id),f=matched[0];
  return matched.length!==1||f.source_type!=='people'||f.type!==(i===0?'STRING':'BOOLEAN')||f.is_premium_filter!==false
   ||f.group_id!==(i===0?'demographics':'contactability')||f.billing_category!==undefined&&f.billing_category!=='people';
 }))return finish('export_fields_unverified');
 // Preserve missing billing_category. Only these two documented non-premium
 // people fields are allowed; no property field or guessed output selector.
 if(!quotaAllows(catalog.headers))return finish('provider_quota_unavailable');
 const history=await request('GET','/exports?limit=5');
 if(history.localBlocked)return finish('dispatch_held');
 if(!history.ok)return finish('history_http_error',{httpStatus:history.httpStatus});
 const exports=history.raw?.data;
 if(!Array.isArray(exports)||exports.length>5||history.raw.pagination?.has_more!==false||history.raw.pagination.total!==exports.length
  ||exports.some(e=>!['failed','completed'].includes(e.status)))return finish('export_history_held');
 if(!quotaAllows(history.headers)||clock()-history.receivedAt>10000)return finish('provider_quota_unavailable');
 const response=await request('POST','/people/export',body,history.receivedAt);
 if(response.localBlocked)return finish('dispatch_held');
 const reportedCredits=creditSummary(response.raw);
 if(!response.ok)return finish('response_saved',{httpStatus:response.httpStatus,reportedCredits,exportSucceeded:false});
 const receipt=response.raw;
 if(!object(receipt)||typeof receipt.export_id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(receipt.export_id)||receipt.record_count!==1
  ||!Array.isArray(receipt.download_urls)||receipt.download_urls.length!==1)return finish('response_saved',{httpStatus:response.httpStatus,reportedCredits,exportSucceeded:false,reason:'export_scope_unverified'});
 // One free read recovers only the exact export ID from this original receipt.
 const recovery=await request('GET','/exports/'+receipt.export_id);
 const recovered=recovery.raw?.data,originalRecoveryVerified=recovery.ok===true&&recovered?.export_id===receipt.export_id&&recovered.status==='completed'&&recovered.record_count===1;
 const summary=await finish('response_saved',{httpStatus:response.httpStatus,reportedCredits,exportSucceeded:true,originalRecoveryVerified,
  creditReceiptWithinCap:integer(reportedCredits.used)&&reportedCredits.used<=1&&integer(reportedCredits.people)&&reportedCredits.people<=1
   &&(!Object.hasOwn(reportedCredits,'properties')||reportedCredits.properties===0)&&(!Object.hasOwn(reportedCredits,'licensed')||reportedCredits.licensed===0)});
 // The original signed download only; the artifact reader never creates work.
 try{return {...summary,artifact:await inspectSavedActiveExport({db,transport,provider:activePhoneExportV3})};}
 catch{return {...summary,artifact:{status:'unverified'}};}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 try{console.log('Approved DealMachine active export v3: '+JSON.stringify(await checkApprovedActivePhoneExportV3()));}
 catch{console.log('Approved DealMachine active export v3: held; no automatic retry.');}
}
