// Authenticated, metadata-only deployment proof. No RPCs, provider calls, writes,
// credential discovery, or customer identifiers in diagnostics/results.
import {workspaceAttentionQuery,sellerAttentionFilters,sellerReminderDeliveryEmbed} from '../lib/workspace-attention-query.ts';

const discoveryLimit=12,accountLimit=3,sampleLimit=24,retainedLimit=12,pageSize=7,badgeSize=6;
const gapFields='id,account_id,screening_id,state,reason,stage,review_reason,expires_at,outgoing_id,updated_at';
const receiptFields='id,account_id,direction,state,customer_author_id';
const propertyFields='id,account_id,state';
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
class AttentionReadbackError extends Error{}
const fail=code=>{throw new AttentionReadbackError('Attention API verification failed: '+code+'.');};
const path=(table,params)=>table+'?'+new URLSearchParams(params);
const inIds=ids=>'in.('+ids.join(',')+')';
const unique=values=>[...new Set(values)];
const fields=(row,names)=>record(row)&&Object.keys(row).length===names.split(',').length&&names.split(',').every(key=>Object.hasOwn(row,key));
const nullableText=value=>value===null||typeof value==='string';
const nullableId=value=>value===null||uuid(value);
// PostgREST preserves PostgreSQL microseconds. Date.parse alone rounds them
// down to milliseconds and can misclassify expiry or cross-page ordering.
const microseconds=value=>{
 const match=typeof value==='string'&&value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/);
 if(!match||!Number.isFinite(Date.parse(value)))return null;
 return BigInt(Date.parse(value))*1000n+BigInt((match[1]??'').padEnd(6,'0').slice(3));
};
const time=value=>microseconds(value)!==null;
const compareTime=(a,b)=>{const delta=microseconds(a)-microseconds(b);return delta<0n?-1:delta>0n?1:0;};
const snapshot=rows=>JSON.stringify([...rows].sort((a,b)=>a.id.localeCompare(b.id)).map(row=>Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b)))));

// Keep this identical to workspaceActivity's seller-gap existence query, using
// the shared receipt embed and predicate. The offline test executes that caller
// and compares both URLs, so its real nested shape cannot silently drift.
export function attentionBadgeReadbackQuery(accountId,propertyIds,now){
 const params=new URLSearchParams({account_id:'eq.'+accountId,id:inIds(propertyIds),select:`id,icash_seller_gaps!inner(${sellerReminderDeliveryEmbed})`,'icash_seller_gaps.account_id':'eq.'+accountId,'icash_seller_gaps.state':'eq.needs_review'});
 for(const [key,value] of sellerAttentionFilters(accountId,'icash_seller_gaps',now))params.set(key,value);
 params.set('limit',String(badgeSize));
 return 'icash_screening_jobs?'+params;
}

// Independent source/receipt oracle, not a reimplementation of URL parsing.
export function expectedAttentionRows(gaps,properties,receipts,accountId,now){
 const active=new Set(properties.filter(p=>p.account_id===accountId&&p.state==='complete').map(p=>p.id));
 const delivered=new Set(receipts.filter(m=>m.account_id===accountId&&m.direction==='outgoing'&&m.state==='delivered'&&m.customer_author_id===null).map(m=>m.id));
 const relevant=gaps.filter(g=>g.account_id===accountId&&g.state==='needs_review'&&active.has(g.screening_id));
 const completed=g=>g.review_reason===null&&g.reason==='no_response'&&g.stage==='draft'&&time(g.expires_at)&&compareTime(g.expires_at,now)<=0&&delivered.has(g.outgoing_id);
 return {hidden:relevant.filter(completed),visible:relevant.filter(g=>g.review_reason!=='contact_checks_expired'&&!completed(g))};
}

function checkRows(rows,select,accountId,ids){
 const seen=new Set();
 for(const row of rows){
  if(!fields(row,select)||!uuid(row.id)||!uuid(row.account_id)||row.account_id!==accountId||seen.has(row.id)||(ids&&!ids.includes(row.id)))fail('invalid_scoped_metadata');
  seen.add(row.id);
  if(select===gapFields&&(!uuid(row.screening_id)||!nullableId(row.outgoing_id)||!nullableText(row.reason)||!nullableText(row.stage)||!nullableText(row.review_reason)||(row.expires_at!==null&&!time(row.expires_at))||!time(row.updated_at)))fail('invalid_gap_metadata');
  if(select===receiptFields&&(!nullableText(row.direction)||!nullableId(row.customer_author_id)))fail('invalid_receipt_metadata');
  if(!nullableText(row.state))fail('invalid_state_metadata');
 }
 return rows;
}
function checkIds(actual,expected,kind){
 // Empty embeds may be absent or represented as empty objects/arrays by the
 // installed PostgREST version. No body or other message field is selected.
 const emptyEmbed=value=>value===null||(Array.isArray(value)?value.every(emptyEmbed):record(value)&&Object.entries(value).every(([key,nested])=>['active_property','completed_reminder','icash_seller_gaps'].includes(key)&&emptyEmbed(nested)));
 if(actual.some(row=>!record(row)||!uuid(row.id)||Object.entries(row).some(([key,value])=>key!=='id'&&(!['active_property','completed_reminder','icash_seller_gaps'].includes(key)||!emptyEmbed(value)))))fail('invalid_projection');
 const ids=actual.map(row=>row.id);
 if(new Set(ids).size!==ids.length||JSON.stringify([...ids].sort())!==JSON.stringify([...expected].sort()))fail(kind+'_mismatch');
}

export async function checkWorkspaceAttentionReadback({env=process.env,fetcher=fetch,now=new Date().toISOString()}={}){
 if(!['production','preview'].includes(env.VERCEL_ENV))return {status:'not_requested'};
 if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY){
  if(env.VERCEL_ENV==='production')fail('configuration_required');
  return {status:'not_configured'};
 }
 try{
  const base=new URL(env.SUPABASE_URL);
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||!['','/'].includes(base.pathname)||!time(now))fail('invalid_configuration');
  const budget=AbortSignal.timeout(45000);
  let requests=0;
  async function read(query){
   const [table,search]=query.split('?'),params=new URLSearchParams(search),limit=Number(params.get('limit'));
   if(!['icash_seller_gaps','icash_screening_jobs','icash_text_messages'].includes(table)||!Number.isInteger(limit)||limit<1||limit>sampleLimit+discoveryLimit+retainedLimit||++requests>90)fail('read_bound');
   const response=await fetcher(base.origin+'/rest/v1/'+query,{method:'GET',headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY,Accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.any([budget,AbortSignal.timeout(10000)])});
   if(!response.ok){
    await response.body?.cancel().catch(()=>{});
    fail('http_'+response.status);
   }
   if(!response.body)fail('missing_response');
   const reader=response.body.getReader(),chunks=[];let bytes=0;
   try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>131072)fail('response_bound');chunks.push(value);}}
   finally{await reader.cancel().catch(()=>{});}
   const rows=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!Array.isArray(rows)||rows.length>limit)fail('invalid_response');
   return rows;
  }
  async function emptyShapeProof(){
   // No tenant is discovered when the history cohort is legitimately empty.
   // Use contradictory ID predicates, not a made-up tenant as data evidence.
   // These still execute/validate both installed PostgREST relationship shapes.
   const absent='00000000-0000-0000-0000-000000000000';
   const queries=[workspaceAttentionQuery('icash_seller_gaps',absent,{select:'id',order:'updated_at,id',limit:1,offset:0}),attentionBadgeReadbackQuery(absent,[absent],now)];
   for(const query of queries){
    const [table,search]=query.split('?'),params=new URLSearchParams(search);
    params.set('id','eq.'+absent);params.append('id','neq.'+absent);
    checkIds(await read(table+'?'+params),[],'empty_shape');
   }
  }
  // One bounded cross-account discovery, identifiers only. Every subsequent
  // source, property, receipt and projection read is explicitly account scoped.
  const discovered=await read(path('icash_seller_gaps',{state:'eq.needs_review',reason:'eq.no_response',stage:'eq.draft',review_reason:'is.null',expires_at:'lte.'+now,outgoing_id:'not.is.null',select:'id,account_id',order:'updated_at.desc,id',limit:String(discoveryLimit)}));
  if(discovered.some(row=>!fields(row,'id,account_id')||!uuid(row.id)||!uuid(row.account_id))||unique(discovered.map(row=>row.id)).length!==discovered.length)fail('invalid_cohort');
  if(!discovered.length){
   await emptyShapeProof();
   return {status:'not_observed',reason:'no_completed_reminder_cohort',accounts:0,completedRemindersChecked:0,retainedRequestsChecked:0,requests};
  }
  let hidden=0,visible=0,accounts=0;
  for(const accountId of unique(discovered.map(row=>row.account_id)).slice(0,accountLimit)){
   const seeds=discovered.filter(row=>row.account_id===accountId).map(row=>row.id);
   const scoped=(table,select,ids)=>path(table,{account_id:'eq.'+accountId,id:inIds(ids),select,limit:String(ids.length)});
   const seedRows=checkRows(await read(scoped('icash_seller_gaps',gapFields,seeds)),gapFields,accountId,seeds);
   if(seedRows.length!==seeds.length)fail('cohort_changed');
   const sample=checkRows(await read(path('icash_seller_gaps',{account_id:'eq.'+accountId,state:'eq.needs_review',select:gapFields,order:'updated_at.desc,id',limit:String(sampleLimit)})),gapFields,accountId);
   // Improve positive coverage without requiring genuine requests to exist.
   // This independent source sample does not use the new receipt predicate.
   const retained=checkRows(await read(path('icash_seller_gaps',{account_id:'eq.'+accountId,state:'eq.needs_review',reason:'neq.no_response',or:'(review_reason.is.null,review_reason.neq.contact_checks_expired)',select:gapFields,order:'updated_at.desc,id',limit:String(retainedLimit)})),gapFields,accountId);
   const byId=new Map(seedRows.map(row=>[row.id,row]));
   for(const row of [...sample,...retained]){if(byId.has(row.id)&&snapshot([byId.get(row.id)])!==snapshot([row]))fail('cohort_changed');byId.set(row.id,row);}
   const gaps=[...byId.values()],gapIds=gaps.map(row=>row.id),propertyIds=unique(gaps.map(row=>row.screening_id)),receiptIds=unique(gaps.map(row=>row.outgoing_id).filter(Boolean));
   const loadProperties=async()=>checkRows(await read(scoped('icash_screening_jobs',propertyFields,propertyIds)),propertyFields,accountId,propertyIds);
   const loadReceipts=async()=>receiptIds.length?checkRows(await read(scoped('icash_text_messages',receiptFields,receiptIds)),receiptFields,accountId,receiptIds):[];
   const properties=await loadProperties(),receipts=await loadReceipts();
   const expected=expectedAttentionRows(gaps,properties,receipts,accountId,now);
   const ordered=expected.visible.sort((a,b)=>compareTime(a.updated_at,b.updated_at)||a.id.localeCompare(b.id));
   // Exercise the actual shared direct query before LIMIT/OFFSET, including an
   // empty terminal page. Restrict only the validation cohort, never live rows.
   for(let offset=0;offset<ordered.length+pageSize;offset+=pageSize){
    const query=workspaceAttentionQuery('icash_seller_gaps',accountId,{select:'id',order:'updated_at,id',limit:pageSize,offset}),params=new URLSearchParams(query.split('?')[1]);
    // Freeze only the clock so every read checks the same expiry boundary.
    for(const [key,value] of sellerAttentionFilters(accountId,'',now))params.set(key,value);
    params.set('id',inIds(gapIds));
    checkIds(await read('icash_seller_gaps?'+params),ordered.slice(offset,offset+pageSize).map(row=>row.id),'direct');
   }
   const active=properties.filter(row=>row.state==='complete').map(row=>row.id);
   // The production caller already selects complete properties. Keep the same
   // outer and nested query shape, adding only the sampled gap-ID bound.
   for(let start=0;start<active.length;start+=badgeSize){
    const batch=active.slice(start,start+badgeSize),query=attentionBadgeReadbackQuery(accountId,batch,now),params=new URLSearchParams(query.split('?')[1]);
    params.set('icash_seller_gaps.id',inIds(gapIds));
    checkIds(await read('icash_screening_jobs?'+params),unique(ordered.filter(row=>batch.includes(row.screening_id)).map(row=>row.screening_id)),'nested');
   }
   // Concurrent changes are inconclusive, not a false success or a retry that
   // can silently replace the original source evidence.
   const finalGaps=checkRows(await read(scoped('icash_seller_gaps',gapFields,gapIds)),gapFields,accountId,gapIds);
   if(snapshot(gaps)!==snapshot(finalGaps)||snapshot(properties)!==snapshot(await loadProperties())||snapshot(receipts)!==snapshot(await loadReceipts()))fail('cohort_changed');
   hidden+=expected.hidden.length;visible+=ordered.length;accounts++;
  }
  // Clean history is legitimate on later deployments. Empty successful reads
  // never claim observed filtering proof. This change's release reviewer must
  // require passed + completedRemindersChecked > 0 from authenticated logs.
  // Existing retained requests must match exactly; their absence is legitimate.
  if(!hidden){
   await emptyShapeProof();
   return {status:'not_observed',reason:'no_confirmed_completed_reminders',accounts,completedRemindersChecked:0,retainedRequestsChecked:visible,requests};
  }
  return {status:'passed',accounts,completedRemindersChecked:hidden,retainedRequestsChecked:visible,requests};
 }catch(error){
  if(error instanceof AttentionReadbackError)throw error;
  // Network/JSON exceptions can contain URLs, row data or authorization values.
  fail('request_failed');
 }
}
