import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {dealMachineRequest} from '../lib/dealmachine-request.ts';

export const preflightProvider='dealmachine_owner_count_review_20261102_v1';
export const preflightBranch='codex/dealmachine-empty-export-20261102';
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const requiredFilters=['has_active_phone_number','has_non_dnc_phone'];
const identifier=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v)||Number.isSafeInteger(v)&&v>0;
const internalId=id=>{const n=Number(id?.slice(4));if(!/^per_[1-9][0-9]{0,30}$/.test(id??'')||!Number.isSafeInteger(n)||String(n)!==id.slice(4))throw Error('PREFLIGHT_ID_UNSUPPORTED');return n;};
async function body(response){
 if(!response.body)throw Error('PREFLIGHT_BODY_MISSING');
 const reader=response.body.getReader(),parts=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1048576)throw Error('PREFLIGHT_BODY_LIMIT');parts.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>null);}
 const rawText=Buffer.concat(parts).toString('utf8');let raw=null;try{raw=JSON.parse(rawText);}catch{}
 return {rawText,raw};
}
function count(raw,max){
 if(!integer(raw?.total_people)||raw.total_people>max||raw.total_results!==raw.total_people||!integer(raw.total_properties)
  ||raw.data!==undefined||raw.credits!==undefined&&(!raw.credits||Object.values(raw.credits).some(v=>v!==0)))throw Error('PREFLIGHT_COUNT_INVALID');
 return raw.total_people;
}

/** Five FREE requests at most. A private exact-commit plan is consumed before
 * any provider access. No export, enrichment, contact download or money write.
 * Counts can disprove availability; positive person flags do not prove that
 * the same phone is both active and non-DNC. Original purchases remain held.
 */
export async function checkOwnerExportPreflight({env=process.env,db,loadDb=async()=> (await import('../lib/stripe-test.ts')).db,transport=fetch,clock=Date.now}={}){
 const idle=status=>({status,paidRequests:0,providerRequests:0});
 if(env.VERCEL_ENV!=='preview'||env.VERCEL_GIT_COMMIT_REF!==preflightBranch)return idle('not_requested');
 if(env.VERCEL_GIT_REPO_OWNER!=='richoffcashflow'||env.VERCEL_GIT_REPO_SLUG!=='iCash-X-2.0-'
  ||env.SUPABASE_URL?.replace(/\/$/,'')!=='https://ofjbbpwugyjfxbhqfguh.supabase.co'||!env.SUPABASE_SECRET_KEY
  ||!/^dm_sk_live_[A-Za-z0-9_-]+$/.test(env.DEALMACHINE_API_KEY??'')||!/^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA??''))return idle('unconfigured');
 db??=await loadDb();
 const path='icash_integration_checks?provider=eq.'+preflightProvider;
 const rows=await db(path+'&select=result');
 if(rows?.length!==1||rows[0]?.result?.status!=='planned')return idle('not_planned');
 const plan=rows[0].result;
 if(plan.reviewedCommit!==env.VERCEL_GIT_COMMIT_SHA||plan.maxRequests!==5||plan.maxCredits!==0
  ||plan.sourceBatch!=='6a1d8667-7079-467a-98c0-56af6ad6dbee'||plan.sourceReceiptHash!=='22be42e2d819a07868216bddcbed8608'
  ||!Array.isArray(plan.peopleIds)||plan.peopleIds.length!==5||new Set(plan.peopleIds).size!==5
  ||!/^[a-f0-9-]{36}$/.test(plan.reviewId??'')||Date.parse(plan.expiresAt)<=clock()
  ||!Number.isFinite(Date.parse(plan.expiresAt))||Date.parse(plan.expiresAt)>clock()+3600000)return idle('plan_invalid');
 const ids=plan.peopleIds.map(internalId),runId=randomUUID();
 let state={...plan,status:'started',runId,startedAt:new Date(clock()).toISOString(),requests:[]};
 const claimed=await db(path+'&result->>status=eq.planned&result->>reviewId=eq.'+plan.reviewId+'&result->>reviewedCommit=eq.'+plan.reviewedCommit,'PATCH',{checked_at:state.startedAt,result:state});
 if(claimed?.length!==1||claimed[0]?.result?.runId!==runId)return idle('claim_unconfirmed');
 const save=async next=>{const saved=await db(path+'&result->>runId=eq.'+runId,'PATCH',{checked_at:new Date(clock()).toISOString(),result:next});if(saved?.length!==1||saved[0]?.result?.runId!==runId)throw Error('PREFLIGHT_SAVE_UNCONFIRMED');state=next;};
 let listId=null,cleanup='not_created',matched=null,baseline=null,reason=null;
 const request=async(method,endpoint,requestBody)=>{
  if(state.requests.length>=5||clock()>=Date.parse(plan.expiresAt))throw Error('PREFLIGHT_REQUEST_LIMIT');
  const entry={method,path:endpoint,body:requestBody??null,startedAt:new Date(clock()).toISOString(),httpStatus:null};
  await save({...state,requests:[...state.requests,entry]});
  let headers;
  const response=await dealMachineRequest(db,'owner_preview',async()=>{
   const r=await transport('https://api.v2.dealmachine.com/v1'+endpoint,{method,headers:{Authorization:'Bearer '+env.DEALMACHINE_API_KEY,'Content-Type':'application/json'},...(requestBody?{body:JSON.stringify(requestBody)}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
   const payload=await body(r);headers=Object.fromEntries(['X-RateLimit-Remaining','X-RateLimit-Day-Remaining'].map(k=>{const v=r.headers.get(k);return [k,v!==null&&/^\d{1,10}$/.test(v)?Number(v):null];}));
   await save({...state,requests:[...state.requests.slice(0,-1),{...entry,httpStatus:r.status,...payload,headers}]});
   return new Response(payload.rawText,{status:r.status,headers:r.headers});
  },{operationKey:'owner-count-review:'+plan.reviewId});
  if(!response.ok)throw Error('PREFLIGHT_HTTP_'+response.status);
  return {...response,quota:headers&&Object.values(headers).every(v=>integer(v)&&v>0)};
 };
 try{
  const catalog=await request('GET','/filters?source_type=people&per_page=250&page=1');
  if(!catalog.quota)throw Error('PREFLIGHT_QUOTA_UNAVAILABLE');
  if(!Array.isArray(catalog.raw?.data)||catalog.raw.data.length>250||catalog.raw.pagination?.has_next_page!==false
   ||requiredFilters.some(id=>{const f=catalog.raw.data.filter(f=>f.filter_id===id);return f.length!==1||f[0].type!=='BOOLEAN'||f[0].is_premium_filter!==false||!f[0].allowed_operators?.includes('is_boolean');}))throw Error('PREFLIGHT_FILTERS_UNVERIFIED');
  const name='icash-owner-count-review-'+plan.reviewId;
  const created=await request('POST','/lists',{name,source_type:'people',record_ids:ids,add_as_prospects:false});
  const data=created.raw?.data;
  if(!identifier(data?.list_id)||data.name!==name||data.source_type!=='people')throw Error('PREFLIGHT_LIST_IDENTITY');
  listId=data.list_id;cleanup='pending';
  if(data.status!=='completed'||data.total_count!==ids.length)throw Error('PREFLIGHT_LIST_INCOMPLETE');
  if(!created.quota)throw Error('PREFLIGHT_QUOTA_UNAVAILABLE');
  const scope={include_lists:{people_list_ids:[listId]}};
  const original=await request('POST','/people/search/count',scope);
  baseline=count(original.raw,ids.length);
  if(baseline!==ids.length)throw Error('PREFLIGHT_SCOPE_UNVERIFIED');
  if(!original.quota)throw Error('PREFLIGHT_QUOTA_UNAVAILABLE');
  const eligible=await request('POST','/people/search/count',{...scope,filters:requiredFilters.map(filter_id=>({filter_id,value:true}))});
  matched=count(eligible.raw,ids.length);
 }catch(error){reason=/^(?:PREFLIGHT_[A-Z_0-9]+|DEALMACHINE_QUOTA_WAIT)$/.test(error?.message??'')?error.message:'PREFLIGHT_UNAVAILABLE';}
 if(listId!==null){
  try{const deleted=await request('DELETE','/lists/'+listId);cleanup=deleted.raw?.data?.deleted===true?'deleted':'pending';}catch{cleanup='pending';}
 }
 const summary={status:reason?'held':matched===0?'no_qualifying_owners':'candidate_owners_present',providerRequests:state.requests.length,paidRequests:0,baseline,matched,cleanup,...(reason?{reason}:{})};
 await save({...state,status:'finished',summary});return summary;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log('Owner export free preflight: '+JSON.stringify(await checkOwnerExportPreflight()));}
 catch{console.log('Owner export free preflight: held; no replay.');}
}
