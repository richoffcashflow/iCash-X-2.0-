import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const freePhonePreviewProvider='dealmachine_active_phone_free_preview_20261028_v2';
const previousPreviewProvider='dealmachine_active_phone_free_preview_20261028_v1';
const originalProvider='dealmachine_active_phone_export_verification_20261027_v1';
const branch='codex/dealmachine-active-phone-contract-20261027';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
export function freePhonePreviewRequest(personId){
 if(typeof personId!=='string'||!/^per_[1-9][0-9]{0,30}$/.test(personId))throw Error('PREVIEW_OWNER_INVALID');
 return {ids:[personId],enrich:false,include_properties:false};
}
export const freePhonePreviewHash=body=>createHash('sha256').update(JSON.stringify(body)).digest('hex');
const rateHeaders=response=>Object.fromEntries(['X-RateLimit-Limit','X-RateLimit-Remaining','X-RateLimit-Day-Limit','X-RateLimit-Day-Remaining','Retry-After'].map(key=>{
 const value=response.headers.get(key);return [key,value!==null&&/^\d{1,10}$/.test(value)?Number(value):null];
}));
async function boundedBody(response){
 if(!response.body)throw Error('PREVIEW_RESPONSE_UNAVAILABLE');
 const reader=response.body.getReader(),chunks=[];let length=0;
 for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>524288){await reader.cancel();throw Error('PREVIEW_RESPONSE_TOO_LARGE');}chunks.push(value);}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 const rawText=new TextDecoder().decode(bytes);let raw=null;try{raw=JSON.parse(rawText);}catch{}
 return {raw,rawText};
}

/** One separately authorized FREE check above the app's exhausted quota.
 * Two requests maximum: a catalog GET, then one exact-owner enrich:false POST.
 * No quota counters, old approvals, outreach or financial rows are modified.
 */
export async function checkApprovedActivePhonePreview({env=process.env,db,loadDb=async()=> (await import('../lib/stripe-test.ts')).db,transport=fetch,clock=Date.now}={}){
 const idle=status=>({status,paidRequests:0,providerRequests:0});
 if(env.VERCEL_ENV!=='preview'||env.VERCEL_GIT_COMMIT_REF!==branch)return idle('not_requested');
 if(env.VERCEL_GIT_REPO_OWNER!=='richoffcashflow'||env.VERCEL_GIT_REPO_SLUG!=='iCash-X-2.0-'
  ||env.SUPABASE_URL?.replace(/\/$/,'')!=='https://ofjbbpwugyjfxbhqfguh.supabase.co'||!env.SUPABASE_SECRET_KEY
  ||!/^dm_sk_live_[A-Za-z0-9_-]+$/.test(env.DEALMACHINE_API_KEY??'')||! /^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA??''))return idle('configuration_unavailable');
 db??=await loadDb();
 const path='icash_integration_checks?provider=eq.'+freePhonePreviewProvider;
 const rows=await db(path+'&select=result');
 if(!Array.isArray(rows)||rows.length!==1||!object(rows[0].result))return idle('not_approved');
 const approval=rows[0].result,now=clock();
 if(approval.status!=='approved')return idle('already_consumed');
 const body=freePhonePreviewRequest(approval.personId);
 if(approval.version!==1||approval.explicitOwnerApproval!==true||approval.allowAboveAppQuota!==true
  ||approval.maxProviderRequests!==2||approval.maxCredits!==0||!uuid(approval.approvalId)||!uuid(approval.accountId)||!uuid(approval.screeningId)
  ||!/^prop_[1-9][0-9]{0,19}$/.test(approval.propertyId??'')||approval.reviewedCommit!==env.VERCEL_GIT_COMMIT_SHA
  ||approval.sourceProvider!==originalProvider||approval.requestHash!==freePhonePreviewHash(body)
  ||!Number.isFinite(Date.parse(approval.approvedAt))||!Number.isFinite(Date.parse(approval.expiresAt))
  ||Date.parse(approval.approvedAt)>now||Date.parse(approval.expiresAt)<=now
  ||Date.parse(approval.expiresAt)-Date.parse(approval.approvedAt)>7200000)throw Error('PREVIEW_APPROVAL_INVALID');
 // The saved live v1 rejected field selection in preview mode. Inspect only
 // the default free response in a distinct, one-use operation; never reset v1.
 const previousRows=await db('icash_integration_checks?provider=eq.'+previousPreviewProvider+'&select=result');
 const previous=previousRows?.[0]?.result;
 if(previousRows?.length!==1||previous?.status!=='preview_http_error'||previous?.summary?.httpStatus!==400
  ||previous?.requests?.length!==2||previous.requests[1]?.httpStatus!==400
  ||previous.requests[1]?.raw?.error?.code!=='invalid_request'||previous.requests[1]?.raw?.error?.message!=='fields requires enrich=true'
  ||previous.request?.enrich!==false||previous.request?.include_properties!==false||previous.request?.ids?.length!==1
  ||previous.request.ids[0]!==approval.personId||JSON.stringify(previous.request.fields)!==JSON.stringify(['has_active_phone_number'])
  ||['accountId','screeningId','propertyId','personId'].some(k=>previous[k]!==approval[k]))throw Error('PREVIEW_PREVIOUS_BINDING_INVALID');
 const originals=await db('icash_integration_checks?provider=eq.'+originalProvider+'&select=result');
 const original=originals?.[0]?.result;
 if(originals?.length!==1||original?.status!=='response_saved'||['accountId','screeningId','propertyId','personId'].some(k=>original[k]!==approval[k]))throw Error('PREVIEW_SOURCE_INVALID');
 const sources=await db(`icash_owner_contacts?account_id=eq.${approval.accountId}&screening_id=eq.${approval.screeningId}&select=result,created_at`);
 const source=sources?.[0],result=source?.result,owners=result?.contacts?.filter(p=>p.personId===approval.personId);
 // This is a historical identity binding for a free schema check. It never
 // refreshes source age, permission or outreach eligibility.
 if(sources?.length!==1||result?.propertyId!==approval.propertyId||!result.requestedPersonIds?.includes(approval.personId)
  ||owners?.length!==1||owners[0].likelyOwner!==true||owners[0].matchFlags?.is_likely_renter===true
  ||!['owner',null].includes(owners[0].propertyContactType)||!Number.isFinite(Date.parse(source.created_at))||Date.parse(source.created_at)>now)throw Error('PREVIEW_SOURCE_INVALID');
 if(clock()>=Date.parse(approval.expiresAt))return idle('approval_expired');
 const runId=randomUUID();let state={...approval,status:'started',runId,startedAt:new Date(clock()).toISOString(),request:body,requests:[],outreach:false};
 const claim=await db(path+'&result->>status=eq.approved&result->>approvalId=eq.'+approval.approvalId+'&result->>requestHash=eq.'+approval.requestHash+'&result->>reviewedCommit=eq.'+approval.reviewedCommit,'PATCH',{checked_at:state.startedAt,result:state});
 if(!Array.isArray(claim)||claim.length!==1||claim[0]?.result?.runId!==runId)return idle('claim_not_confirmed');
 const receiptPath=path+'&result->>runId=eq.'+runId;
 const save=async(next)=>{const saved=await db(receiptPath,'PATCH',{checked_at:new Date(clock()).toISOString(),result:next});if(saved?.length!==1||saved[0]?.result?.runId!==runId)throw Error('PREVIEW_SAVE_UNCONFIRMED');state=next;};
 const finish=async(status,details={})=>{
  const summary={status,providerRequests:state.requests.length,paidRequests:0,...details};
  await save({...state,status,summary});return summary;
 };
 const request=async(method,endpoint,requestBody)=>{
  if(state.requests.length>=2)throw Error('PREVIEW_REQUEST_LIMIT');
  const entry={method,path:endpoint,...(requestBody?{body:requestBody}:{}),startedAt:new Date(clock()).toISOString(),httpStatus:null,raw:null};
  await save({...state,requests:[...state.requests,entry]});
  let response;
  try{
   response=await transport('https://api.v2.dealmachine.com/v1'+endpoint,{method,headers:{Authorization:'Bearer '+env.DEALMACHINE_API_KEY,...(requestBody?{'Content-Type':'application/json'}:{})},
    ...(requestBody?{body:JSON.stringify(requestBody)}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
   const payload=await boundedBody(response);
   await save({...state,requests:[...state.requests.slice(0,-1),{...entry,httpStatus:response.status,headers:rateHeaders(response),...payload}]});
   return {ok:response.ok,status:response.status,raw:payload.raw,headers:rateHeaders(response),receivedAt:clock()};
  }catch{
   await save({...state,status:'unknown',reason:'original_response_unavailable'}).catch(()=>null);throw Error('PREVIEW_UNKNOWN_NO_RETRY');
  }
 };
 const catalog=await request('GET','/fields?source_type=people&per_page=250&page=1');
 if(!catalog.ok)return finish(catalog.status===429?'provider_rate_limited':'catalog_http_error',{httpStatus:catalog.status});
 const fields=catalog.raw?.data,matched=Array.isArray(fields)?fields.filter(f=>f?.field_id==='has_active_phone_number'):[];
 if(!Array.isArray(fields)||fields.length>250||catalog.raw?.pagination?.has_next_page!==false||matched.length!==1||matched[0].type!=='BOOLEAN')return finish('field_unverified');
 const h=catalog.headers;
 if(!integer(h['X-RateLimit-Limit'])||h['X-RateLimit-Limit']<1||!integer(h['X-RateLimit-Day-Limit'])||h['X-RateLimit-Day-Limit']<1
  ||!integer(h['X-RateLimit-Remaining'])||h['X-RateLimit-Remaining']<1||h['X-RateLimit-Remaining']>h['X-RateLimit-Limit']
  ||!integer(h['X-RateLimit-Day-Remaining'])||h['X-RateLimit-Day-Remaining']<1||h['X-RateLimit-Day-Remaining']>h['X-RateLimit-Day-Limit']
  ||h['Retry-After']!==null||clock()-catalog.receivedAt>10000)return finish('provider_quota_unavailable');
 if(clock()>=Date.parse(approval.expiresAt))return finish('approval_expired');
 const response=await request('POST','/people/ids',body),raw=response.raw;
 const creditsUsed=integer(raw?.credits?.used)?raw.credits.used:null;
 if(!response.ok)return finish(response.status===429?'provider_rate_limited':'preview_http_error',{httpStatus:response.status,creditsUsed});
 if(!object(raw?.credits)||['used','people','properties','deduplicated'].some(k=>raw.credits[k]!==0))return finish('preview_credit_receipt_unverified',{creditsUsed});
 if(!Array.isArray(raw.data)||raw.data.length!==1||raw.data[0]?.dm_person_id!==approval.personId
  ||typeof raw.data[0]?.found!=='boolean'||raw.data[0]?.error!==undefined||raw.totals?.submitted!==1
  ||raw.totals.found!==(raw.data[0].found?1:0)||raw.totals.not_found!==(raw.data[0].found?0:1))return finish('preview_identity_unverified',{creditsUsed});
 const person=raw.data[0];
 if(['phones','emails'].some(k=>person[k]!==undefined&&(!Array.isArray(person[k])||person[k].length>0)))return finish('unexpected_enriched_data',{creditsUsed});
 if(!person.found)return finish('owner_not_found',{creditsUsed});
 const value=person.has_active_phone_number;
 return finish(typeof value==='boolean'?'person_activity_available':'person_activity_not_returned',{creditsUsed,activityFieldReturned:typeof value==='boolean',hasActivePhone:typeof value==='boolean'?value:null});
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 try{console.log('Free DealMachine phone preview: '+JSON.stringify(await checkApprovedActivePhonePreview()));}
 catch{console.log('Free DealMachine phone preview: held; no automatic retry.');}
}
