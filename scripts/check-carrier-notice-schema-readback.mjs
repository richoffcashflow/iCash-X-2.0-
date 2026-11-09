// Schema-cache proof only. No customer rows, RPCs, writes, provider requests,
// credential discovery or new access. Use only existing deployment credentials.
import {workspaceAttentionQuery,workspaceAttentionSource,sellerAttentionFilters,sellerReminderDeliveryEmbed} from '../lib/workspace-attention-query.ts';

const absent='00000000-0000-4000-8000-000000000000';
const maxRequests=16,maxResponseBytes=1024,maxTotalBytes=maxRequests*maxResponseBytes;
const tables=new Set(['icash_response_text_messages','icash_response_text_attention','icash_response_sms_call_requests','icash_response_seller_gaps','icash_response_handoffs','icash_response_sms_route_reviews','icash_screening_jobs','icash_seller_gaps']);
class CarrierSchemaReadbackError extends Error{}
const fail=code=>{throw new CarrierSchemaReadbackError('Carrier schema verification failed: '+code+'.');};
const path=(table,params)=>table+'?'+new URLSearchParams(params);

// Full selected columns matter: an empty embed alone cannot prove the actual
// caller works. The offline suite executes each caller and compares its URLs.
export function carrierSchemaReadbackQueries(now=new Date().toISOString()){
 const queries=[];
 const add=(name,query,key='id')=>{
  const [table,search]=query.split('?'),params=new URLSearchParams(search);
  params.set('limit','0');
  // Keep existing property-ID/account/state/party/receipt predicates intact.
  // Contradictory IDs are a second no-row fence if a server ignores limit=0.
  params.append(key,'eq.'+absent);params.append(key,'neq.'+absent);
  queries.push({name,query:table+'?'+params});
 };
 for(const party of ['seller','buyer'])add('messages_'+party,path('icash_response_text_messages',{
  account_id:'eq.'+absent,'thread.account_id':'eq.'+absent,'thread.deal_id':'eq.'+absent,'thread.retired_at':'is.null','thread.party':'eq.'+party,
  select:'id,body,attachments,direction,state,customer_author_id,created_at,thread:icash_text_threads!inner(id,party,paused)',order:'created_at.desc,id.desc'
 }));
 const attention=[
  ['icash_text_attention','id,message_id,screening_id,deal_id,kind,party,quote,timezone,progress_reason,next_step','created_at,id','eq.open'],
  ['icash_sms_call_requests','id,screening_id,requested_at,state','requested_at,id','eq.needs_review'],
  ['icash_handoffs','id,screening_id,party,reason,summary,next_action,state,assigned_to,due_at,resolution','created_at,id','neq.resolved'],
  ['icash_seller_gaps','id,screening_id,deal_id,reason,quote,review_reason,updated_at','updated_at,id','eq.needs_review']
 ];
 for(const [table,select,order,state] of attention){
  for(const [caller,options] of [['activity',{select,order,offset:0}],['assistant',{}]]){
   const query=workspaceAttentionQuery(table,absent,{...options,limit:0}),params=new URLSearchParams(query.split('?')[1]);
   if(table==='icash_seller_gaps')for(const [key,value] of sellerAttentionFilters(absent,'',now))params.set(key,value);
   add(caller+'_'+table,workspaceAttentionSource(table)+'?'+params);
  }
  const params=new URLSearchParams({account_id:'eq.'+absent,id:'in.('+absent+')',select:`id,${table}:${workspaceAttentionSource(table)}!inner(${table==='icash_seller_gaps'?sellerReminderDeliveryEmbed:''})`,[table+'.account_id']:'eq.'+absent,[table+'.state']:state});
  if(table==='icash_seller_gaps')for(const [key,value] of sellerAttentionFilters(absent,table,now))params.set(key,value);
  add('badge_'+table,'icash_screening_jobs?'+params);
 }
 add('assistant_route_reviews',path('icash_response_sms_route_reviews',{account_id:'eq.'+absent,resolved_at:'is.null',select:'message_id'}),'message_id');
 const recovery=new URLSearchParams({account_id:'eq.'+absent,state:'in.(open,queued,waiting,needs_review)',select:`id,deal_id,reason,stage,channel,quote,state,due_at,updated_at,${sellerReminderDeliveryEmbed}`});
 for(const [key,value] of sellerAttentionFilters(absent,'',now))recovery.set(key,value);
 recovery.set('order','updated_at.desc,id');
 add('seller_recovery','icash_seller_gaps?'+recovery);
 return queries;
}

export async function checkCarrierNoticeSchemaReadback({env=process.env,fetcher=fetch,now=new Date().toISOString()}={}){
 if(!['production','preview'].includes(env.VERCEL_ENV))return {status:'not_requested'};
 if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY){
  if(env.VERCEL_ENV==='production')fail('configuration_required');
  return {status:'not_configured'};
 }
 try{
  const base=new URL(env.SUPABASE_URL);
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||!['','/'].includes(base.pathname)||typeof now!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(now)||!Number.isFinite(Date.parse(now)))fail('invalid_configuration');
  const queries=carrierSchemaReadbackQueries(now),budget=AbortSignal.timeout(45000);
  if(queries.length!==maxRequests)fail('read_bound');
  let requests=0,totalBytes=0;
  for(const {query} of queries){
   const [table,search]=query.split('?'),params=new URLSearchParams(search),key=table==='icash_response_sms_route_reviews'?'message_id':'id';
   if(!tables.has(table)||params.getAll('account_id').length!==1||params.get('account_id')!=='eq.'+absent||params.getAll('limit').length!==1||params.get('limit')!=='0'||!params.getAll(key).includes('eq.'+absent)||!params.getAll(key).includes('neq.'+absent)||++requests>maxRequests)fail('read_bound');
   const signal=AbortSignal.any([budget,AbortSignal.timeout(10000)]);
   signal.throwIfAborted();
   const response=await fetcher(base.origin+'/rest/v1/'+query,{method:'GET',headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY,Accept:'application/json'},redirect:'error',cache:'no-store',signal});
   // A redirect is never an alternative endpoint. Do not log error bodies,
   // response URLs or thrown network/JSON diagnostics (they can carry secrets).
   if(response.status!==200||response.redirected){void response.body?.cancel().catch(()=>{});fail('http_response');}
   if(!response.body)fail('missing_response');
   if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')){void response.body.cancel().catch(()=>{});fail('invalid_response');}
   const reader=response.body.getReader(),chunks=[];let bytes=0;
   try{
    for(;;){
     signal.throwIfAborted();
     const {done,value}=await reader.read();
     signal.throwIfAborted();
     if(done)break;
     bytes+=value.byteLength;totalBytes+=value.byteLength;
     if(bytes>maxResponseBytes||totalBytes>maxTotalBytes)fail('response_bound');
     chunks.push(value);
    }
   }finally{void reader.cancel().catch(()=>{});}
   const rows=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!Array.isArray(rows)||rows.length!==0)fail('invalid_response');
  }
  return {status:'passed',shapes:queries.length,requests};
 }catch(error){
  if(error instanceof CarrierSchemaReadbackError)throw error;
  fail('request_failed');
 }
}
