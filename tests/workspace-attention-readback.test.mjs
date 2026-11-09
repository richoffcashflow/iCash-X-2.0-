import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {checkWorkspaceAttentionReadback,attentionBadgeReadbackQuery,expectedAttentionRows} from '../scripts/check-workspace-attention-readback.mjs';
import {workspaceAttentionQuery,workspaceAttentionSource,sellerAttentionFilters,sellerReminderDeliveryEmbed} from '../lib/workspace-attention-query.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';

const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=uuid(1),other=uuid(2),now='2026-11-07T20:00:00.000Z';
const env={VERCEL_ENV:'production',SUPABASE_URL:'https://database.example.test',SUPABASE_SECRET_KEY:'fixture-secret-never-log'};
const gapFields='id,account_id,screening_id,state,reason,stage,review_reason,expires_at,outgoing_id,updated_at';
const receiptFields='id,account_id,direction,state,customer_author_id';
const gaps=[],properties=[],receipts=[],visibleIds=[];
function add(n,changes={},receiptChanges={},shown=true){
 const gap={id:uuid(100+n),account_id:account,screening_id:uuid(200+n),state:'needs_review',reason:'no_response',stage:'draft',review_reason:null,expires_at:'2020-01-01T00:00:00Z',outgoing_id:uuid(300+n),updated_at:`2026-10-${String(n+1).padStart(2,'0')}T00:00:00.000Z`,...changes};
 gaps.push(gap);properties.push({id:gap.screening_id,account_id:account,state:'complete'});
 if(receiptChanges!==null)receipts.push({id:gap.outgoing_id,account_id:account,direction:'outgoing',state:'delivered',customer_author_id:null,...receiptChanges});
 if(shown)visibleIds.push(gap.id);
}
add(0,{}, {},false); // Confirmed expired automatic reminder must disappear.
add(1,{reason:'human'});
add(2,{}, {state:'accepted'});
add(3,{}, {state:'failed'});
add(4,{}, {customer_author_id:uuid(999)});
add(5,{}, {account_id:other}); // Account-scoped receipt read returns no foreign row.
add(6,{}, {direction:'incoming'});
add(7,{}, null); // Missing receipt.
add(8,{expires_at:'2999-01-01T00:00:00Z'});
add(9,{expires_at:null});
add(10,{stage:null});
add(11,{reason:null});
add(12,{review_reason:'unknown_review'});
add(13,{review_reason:'contact_checks_expired'}, {},false);
add(14,{expires_at:now}, {},false); // Equality is expired, not future.
add(15,{}, {state:null});
add(16,{}, {},false);properties.at(-1).state='archived';
add(17,{reason:'human'}, {},false);properties.at(-1).account_id=other;

const json=value=>new Response(JSON.stringify(value));
const inFilter=value=>value?.slice(4,-1).split(',');
function fixture(options={}){
 const calls=[],cancelled=[];let metadataReads=0;
 const failedResponse=status=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('private failed response'));},cancel(){cancelled.push(status);}}),{status});
 const fetcher=async(url,request)=>{
  const u=new URL(url),table=u.pathname.split('/rest/v1/')[1].replace('icash_response_','icash_'),q=u.searchParams;
  calls.push({table,q});
  assert.equal(u.origin,'https://database.example.test','No provider requests');
  assert.equal(request.method,'GET');assert.equal(request.body,undefined,'No RPCs or writes');
  assert.equal(request.redirect,'error');assert.equal(request.cache,'no-store');
  assert(request.signal instanceof AbortSignal);assert(!request.signal.aborted);
  assert.equal(request.headers.apikey,env.SUPABASE_SECRET_KEY);
  assert.equal(request.headers.Authorization,'Bearer '+env.SUPABASE_SECRET_KEY);
  assert(!q.get('select').match(/body|quote|result|phone|email|resolution|\*/));
  assert(Number(q.get('limit'))<=51&&Number(q.get('limit'))>0);
  if(calls.length===1){
   assert.equal(table,'icash_seller_gaps');assert.equal(q.get('select'),'id,account_id');
   assert.equal(q.get('limit'),'12');assert.equal(q.get('review_reason'),'is.null');
   assert.equal(q.get('state'),'eq.needs_review');assert.equal(q.get('reason'),'eq.no_response');
   assert.equal(q.get('stage'),'eq.draft');assert.equal(q.get('expires_at'),'lte.'+now);
   assert.equal(q.get('outgoing_id'),'not.is.null');
   if(options.discovery!==undefined)return json(options.discovery);
   return json([{id:gaps[0].id,account_id:account}]);
  }
  if(calls.length===2){
   assert.equal(table,'icash_seller_gaps');assert.equal(q.get('select'),'id,account_id,active_property:icash_screening_jobs!inner()');
   assert.equal(q.get('limit'),'3');assert.equal(q.get('state'),'eq.needs_review');assert.equal(q.get('active_property.state'),'eq.complete');
   assert.equal(q.get('reason'),'in.(callback,human,delivery_unknown,declined,repeated_question)');
   assert.equal(q.get('or'),'(review_reason.is.null,review_reason.neq.contact_checks_expired)');
   return json(options.retainedDiscovery??(options.discovery?.length===0?[]:[{id:gaps[1].id,account_id:account}]));
  }
  if(q.getAll('id').length===2){
   assert.deepEqual(q.getAll('id'),['eq.00000000-0000-0000-0000-000000000000','neq.00000000-0000-0000-0000-000000000000']);
   assert.equal(q.get('account_id'),'eq.00000000-0000-0000-0000-000000000000');
   assert(q.get('select').includes(sellerReminderDeliveryEmbed));
   assert(['icash_seller_gaps','icash_screening_jobs'].includes(table));
   if(options.emptyShapeFailure)return failedResponse(400);
   if(options.emptyShapeMismatch)return json([{id:uuid(888)}]);
   return json([]);
  }
  assert.equal(q.get('account_id'),'eq.'+account,'Every read after discovery is account scoped');
  if(options.httpFailure)return failedResponse(403);
  if(options.networkFailure)throw Error('https://secret.invalid/'+env.SUPABASE_SECRET_KEY+'/'+account);
  if(options.largeResponse)return new Response('x'.repeat(131073));
  if(options.invalidJson)return new Response('private invalid JSON '+env.SUPABASE_SECRET_KEY);
  if(options.noBody)return new Response(null,{status:204});
  if(options.invalidResponse)return json({private:'not a list'});
  if(table==='icash_seller_gaps'&&q.get('select')===gapFields){
   metadataReads++;
   let rows=gaps.filter(row=>!q.has('id')||inFilter(q.get('id')).includes(row.id));
   if(q.get('reason')==='neq.no_response'){
    assert.equal(q.get('limit'),'12');assert.equal(q.get('or'),'(review_reason.is.null,review_reason.neq.contact_checks_expired)');
    rows=rows.filter(row=>row.reason!==null&&row.reason!=='no_response'&&row.review_reason!=='contact_checks_expired');
   }
   if(options.noHidden)rows=rows.map(row=>({...row,reason:'human'}));
   if(options.nullReceipts)rows=rows.map(row=>({...row,outgoing_id:null}));
   if(options.microsecondOrder)rows=rows.map(row=>row.id===gaps[7].id?{...row,updated_at:'2026-10-08T00:00:00.000002+00:00'}:row.id===gaps[8].id?{...row,updated_at:'2026-10-08T00:00:00.000001+00:00'}:row);
   if(options.noVisible)rows=rows.map(row=>({...row,review_reason:null,reason:'no_response',stage:'draft',expires_at:'2020-01-01T00:00:00Z',outgoing_id:gaps[0].outgoing_id}));
   if(options.changed&&metadataReads===4)rows=rows.map(row=>({...row,state:'resolved'}));
   if(options.malformed)rows=rows.map(({expires_at,...rest})=>rest);
   if(options.foreignMetadata)rows=rows.map(row=>({...row,account_id:other}));
   if(options.missingSeed&&metadataReads===1)rows=[];
   if(options.duplicate&&metadataReads===2)rows.push(rows[0]);
   return json(rows.slice(0,Number(q.get('limit'))));
  }
  if(table==='icash_text_messages'){
   assert.equal(q.get('select'),receiptFields);
   const rows=receipts.filter(row=>inFilter(q.get('id')).includes(row.id)&&row.account_id===account);
   if(options.foreignReceipt)rows.push(receipts.find(row=>row.account_id===other));
   if(options.receiptChanged&&metadataReads===4)rows[0]={...rows[0],state:'accepted'};
   return json(rows);
  }
  if(table==='icash_screening_jobs'&&q.get('select')==='id,account_id,state'){
   const rows=properties.filter(row=>row.account_id===account&&inFilter(q.get('id')).includes(row.id));
   if(options.propertyChanged&&metadataReads===4)rows[0]={...rows[0],state:'archived'};
   return json(rows);
  }
  const nested=table==='icash_screening_jobs',prefix=nested?'icash_seller_gaps.':'';
  assert.equal(q.get(prefix+'completed_reminder.account_id'),'eq.'+account);
  assert.equal(q.get(prefix+'completed_reminder.direction'),'eq.outgoing');
  assert.equal(q.get(prefix+'completed_reminder.state'),'eq.delivered');
  assert.equal(q.get(prefix+'completed_reminder.customer_author_id'),'is.null');
  assert.equal(q.get(prefix+'and'),sellerAttentionFilters(account,nested?'icash_seller_gaps':'',now).get(prefix+'and'));
  assert(q.get('select').includes(sellerReminderDeliveryEmbed));
  let shown=gaps.filter(row=>visibleIds.includes(row.id));
  if(options.noHidden||options.nullReceipts)shown=gaps.filter(row=>row.review_reason!=='contact_checks_expired'&&row!==gaps[16]&&row!==gaps[17]);
  if(options.noVisible)shown=[];
  // PostgreSQL places the later UUID first because its time is one microsecond
  // earlier. These two retained rows straddle the seven-row page boundary.
  if(options.microsecondOrder)[shown[6],shown[7]]=[shown[7],shown[6]];
  if(!nested){
   assert.equal(table,'icash_seller_gaps');assert.equal(q.get('state'),'eq.needs_review');
   assert.equal(q.get('active_property.account_id'),'eq.'+account);assert.equal(q.get('active_property.state'),'eq.complete');
   assert(q.get('select').includes('active_property:icash_screening_jobs!inner()'));assert.equal(q.get('order'),'updated_at,id');
   const offset=Number(q.get('offset')),limit=Number(q.get('limit'));
   if(options.directMismatch)shown.unshift(gaps[0]);
   if(options.dropRetained)shown=[];
   const rows=shown.slice(offset,offset+limit).map(row=>({id:row.id}));
   if(options.leakedProjection&&rows.length)rows[0].completed_reminder={body:'Never log this'};
   return json(rows);
  }
  assert.equal(q.get('icash_seller_gaps.state'),'eq.needs_review');assert.equal(q.get('limit'),'6');
  assert.equal(q.get('select'),`id,icash_seller_gaps:icash_response_seller_gaps!inner(${sellerReminderDeliveryEmbed})`);
  assert(inFilter(q.get('icash_seller_gaps.id')).includes(gaps[0].id));
  const rows=properties.filter(p=>inFilter(q.get('id')).includes(p.id)&&(shown.some(g=>g.screening_id===p.id)||options.nestedMismatch)).map(p=>({id:p.id,icash_seller_gaps:[{}]}));
  return json(rows);
 };
 return {fetcher,calls,cancelled};
}

const base=fixture(),original=JSON.stringify({gaps,properties,receipts});
const result=await checkWorkspaceAttentionReadback({env,now,fetcher:base.fetcher});
assert.equal(result.status,'passed');assert.equal(result.completedRemindersChecked,2);assert.equal(result.retainedRequestsChecked,visibleIds.length);
assert(result.requests<=90);assert(!JSON.stringify(result).includes(account));assert(!JSON.stringify(result).includes(env.SUPABASE_SECRET_KEY));
assert.deepEqual(base.calls.filter(c=>c.table==='icash_seller_gaps'&&c.q.has('offset')).map(c=>c.q.get('offset')),['0','7','14'],'Pagination includes an empty terminal page');
assert.equal(JSON.stringify({gaps,properties,receipts}),original,'Readback leaves all history unchanged');
assert.deepEqual(expectedAttentionRows(gaps,properties,receipts,account,now).visible.map(g=>g.id),visibleIds,'Unknown, manual, foreign and missing receipts cannot hide requests');
assert.equal((await checkWorkspaceAttentionReadback({env,now,fetcher:fixture({microsecondOrder:true}).fetcher})).status,'passed','Microsecond ordering cannot cause a false cross-page mismatch');
for(const expires_at of ['2026-11-07T20:00:00.000001Z','2026-11-07T15:00:00.000001-05:00']){
 const precise=expectedAttentionRows([{...gaps[0],expires_at}],properties,receipts,account,now);
 assert.equal(precise.hidden.length,0);assert.equal(precise.visible.length,1,'An expiry one microsecond after the frozen clock remains visible');
}
assert.equal(expectedAttentionRows([{...gaps[0],expires_at:'2026-11-07T19:59:59.999999Z'}],properties,receipts,account,now).hidden.length,1);
for(const [option,code] of [
 ['directMismatch','direct_mismatch'],['dropRetained','direct_mismatch'],['nestedMismatch','nested_mismatch'],
 ['changed','cohort_changed'],['receiptChanged','cohort_changed'],['propertyChanged','cohort_changed'],
 ['malformed','invalid_scoped_metadata'],['foreignMetadata','invalid_scoped_metadata'],['foreignReceipt','invalid_scoped_metadata'],['duplicate','invalid_scoped_metadata'],
 ['missingSeed','cohort_changed'],['httpFailure','http_403'],['networkFailure','request_failed'],
 ['largeResponse','response_bound'],['invalidJson','request_failed'],['noBody','missing_response'],['invalidResponse','invalid_response'],['leakedProjection','invalid_projection']
]){
 await assert.rejects(checkWorkspaceAttentionReadback({env,now,fetcher:fixture({[option]:true}).fetcher}),error=>{
  assert.equal(error.message,`Attention API verification failed: ${code}.`,option);
  assert(!error.message.includes(account)&&!error.message.includes(env.SUPABASE_SECRET_KEY));return true;
 });
}
for(const discovery of [[{id:'invalid private ID',account_id:account}],Array.from({length:13},()=>({id:gaps[0].id,account_id:account}))])await assert.rejects(checkWorkspaceAttentionReadback({env,now,fetcher:fixture({discovery}).fetcher}),/Attention API verification failed:/);
const absent=fixture({discovery:[]});
assert.equal((await checkWorkspaceAttentionReadback({env,now,fetcher:absent.fetcher})).status,'not_observed');
assert.equal(absent.calls.length,4,'Empty cohorts still exercise both direct and nested shapes after both bounded discoveries');
assert.equal((await checkWorkspaceAttentionReadback({env,now,fetcher:fixture({noHidden:true}).fetcher})).status,'not_observed','Unconfirmed completed history cannot be labeled passed');
const nullReceipts=fixture({nullReceipts:true});
assert.equal((await checkWorkspaceAttentionReadback({env,now,fetcher:nullReceipts.fetcher})).status,'not_observed');
assert(!nullReceipts.calls.some(call=>call.table==='icash_text_messages'),'An all-null receipt cohort never sends an empty ID query or hides its requests');
const noVisible=await checkWorkspaceAttentionReadback({env,now,fetcher:fixture({noVisible:true}).fetcher});
assert.equal(noVisible.status,'passed');assert(noVisible.completedRemindersChecked>0);assert.equal(noVisible.retainedRequestsChecked,0,'A clean retained queue is legitimate when observed completed history is verified');
for(const option of ['emptyShapeFailure','emptyShapeMismatch'])await assert.rejects(checkWorkspaceAttentionReadback({env,now,fetcher:fixture({discovery:[],[option]:true}).fetcher}),/Attention API verification failed:/);
const httpFailure=fixture({httpFailure:true});
await assert.rejects(checkWorkspaceAttentionReadback({env,now,fetcher:httpFailure.fetcher}),/http_403/);
assert.deepEqual(httpFailure.cancelled,[403],'Failed response bodies are cancelled, never read or logged');
assert.equal(httpFailure.calls.length,3,'A failed read is never retried');
const noRequests=()=>{throw Error('This environment must not query anything');};
assert.equal((await checkWorkspaceAttentionReadback({env:{},fetcher:noRequests})).status,'not_requested');
assert.equal((await checkWorkspaceAttentionReadback({env:{VERCEL_ENV:'preview'},fetcher:noRequests})).status,'not_configured');
for(const config of [{VERCEL_ENV:'production'},{...env,SUPABASE_URL:'http://database.example.test'},{...env,SUPABASE_URL:'https://private:secret@database.example.test'}])await assert.rejects(checkWorkspaceAttentionReadback({env:config,fetcher:noRequests}),/Attention API verification failed:/);
assert.equal((await checkWorkspaceAttentionReadback({env:{...env,VERCEL_ENV:'preview'},now,fetcher:fixture().fetcher})).status,'passed','Configured preview runs the same authenticated check');

// Discovery coverage uses distinct accounts and keeps seed reads independent
// from the newest bounded samples. A genuine request must be checked even when
// it is outside those samples and its account has no old completed reminders.
const cohortGap=(n,owner,retained=false)=>({...gaps[0],id:uuid(1000+n),account_id:owner,screening_id:uuid(2000+n),outgoing_id:retained?null:uuid(3000+n),reason:retained?'human':'no_response'});
function cohortFixture({hidden=[],retained=[],generalSample=[],retainedSample=[]}={}){
 const calls=[],source=[...hidden,...retained,...generalSample,...retainedSample];
 const fetcher=async(url,request)=>{
  const u=new URL(url),q=u.searchParams,table=u.pathname.split('/rest/v1/')[1].replace('icash_response_','icash_');calls.push({table,q});
  assert.equal(u.origin,'https://database.example.test');assert.equal(request.method,'GET');assert.equal(request.body,undefined);
  assert.equal(request.redirect,'error');assert.equal(request.cache,'no-store');assert(request.signal instanceof AbortSignal);
  assert(Number(q.get('limit'))>0&&Number(q.get('limit'))<=51);
  assert(!q.get('select').match(/body|quote|result|phone|email|resolution|\*/));
  if(calls.length<=2){
   assert.equal(table,'icash_seller_gaps');assert.equal(q.get('account_id'),null);
   const positive=calls.length===2;
   assert.equal(q.get('limit'),positive?'3':'12');
   assert.equal(q.get('select'),positive?'id,account_id,active_property:icash_screening_jobs!inner()':'id,account_id');
   if(positive){assert.equal(q.get('active_property.state'),'eq.complete');assert.equal(q.get('reason'),'in.(callback,human,delivery_unknown,declined,repeated_question)');}
   return json((positive?retained:hidden).map(({id,account_id})=>({id,account_id,...(positive?{active_property:{}}:{})})));
  }
  if(q.getAll('id').length===2)return json([]);
  const owner=q.get('account_id')?.slice(3);assert.match(q.get('account_id')??'',/^eq\.[0-9a-f-]{36}$/,'Every source/projection read is account scoped');
  assert(source.some(row=>row.account_id===owner),'Only discovered accounts are inspected');
  const rows=source.filter(row=>row.account_id===owner),ids=inFilter(q.get('id'));
  if(table==='icash_seller_gaps'&&q.get('select')===gapFields){
   const selected=ids?rows.filter(row=>ids.includes(row.id)):(q.has('reason')?retainedSample:generalSample).filter(row=>row.account_id===owner);
   return json(selected.slice(0,Number(q.get('limit'))));
  }
  if(table==='icash_screening_jobs'&&q.get('select')==='id,account_id,state')return json(rows.filter(row=>ids.includes(row.screening_id)).map(row=>({id:row.screening_id,account_id:owner,state:'complete'})));
  if(table==='icash_text_messages'){
   assert.equal(q.get('select'),receiptFields);
   return json(rows.filter(row=>row.outgoing_id&&ids.includes(row.outgoing_id)).map(row=>({id:row.outgoing_id,account_id:owner,direction:'outgoing',state:'delivered',customer_author_id:null})));
  }
  const visible=rows.filter(row=>row.reason==='human');
  if(table==='icash_seller_gaps'){
   assert.equal(q.get('active_property.account_id'),'eq.'+owner);assert.equal(q.get('completed_reminder.account_id'),'eq.'+owner);
   const offset=Number(q.get('offset')),limit=Number(q.get('limit'));
   return json(visible.filter(row=>ids.includes(row.id)).sort((a,b)=>a.id.localeCompare(b.id)).slice(offset,offset+limit).map(({id})=>({id})));
  }
  assert.equal(table,'icash_screening_jobs');assert.equal(q.get('icash_seller_gaps.account_id'),'eq.'+owner);
  assert.equal(q.get('icash_seller_gaps.completed_reminder.account_id'),'eq.'+owner);
  const sampledGaps=inFilter(q.get('icash_seller_gaps.id'));
  return json(visible.filter(row=>ids.includes(row.screening_id)&&sampledGaps.includes(row.id)).map(row=>({id:row.screening_id})));
 };
 return {fetcher,calls};
}
const positiveCohort=cohortFixture({hidden:[cohortGap(1,account),cohortGap(2,uuid(3)),cohortGap(3,uuid(4))],retained:[cohortGap(4,other,true),cohortGap(5,uuid(5),true),cohortGap(6,uuid(6),true)]});
const positiveResult=await checkWorkspaceAttentionReadback({env,now,fetcher:positiveCohort.fetcher});
assert.deepEqual({...positiveResult,requests:undefined},{status:'passed',accounts:3,completedRemindersChecked:2,retainedRequestsChecked:1,requests:undefined});
assert.deepEqual([...new Set(positiveCohort.calls.slice(2).map(call=>call.q.get('account_id')))],[account,other,uuid(3)].map(id=>'eq.'+id),'First hidden and first retained accounts take priority before filling the three-account cap');
assert(positiveCohort.calls.some(call=>call.q.get('account_id')==='eq.'+other&&call.q.get('select')===gapFields&&call.q.get('id')==='in.('+uuid(1004)+')'),'The positive discovery becomes an explicit source seed, outside bounded recent samples');
const overlap=cohortFixture({hidden:[cohortGap(1,account),cohortGap(2,other)],retained:[cohortGap(3,account,true)]});
const overlapResult=await checkWorkspaceAttentionReadback({env,now,fetcher:overlap.fetcher});
assert.equal(overlapResult.accounts,2);assert.equal(overlapResult.retainedRequestsChecked,1);
assert.equal(overlap.calls.filter(call=>call.q.get('select')===gapFields&&call.q.get('account_id')==='eq.'+account&&call.q.get('id')==='in.('+uuid(1001)+','+uuid(1003)+')').length,2,'Overlapping accounts are checked once, including their final source reread');
const emptyRetained=await checkWorkspaceAttentionReadback({env,now,fetcher:cohortFixture({hidden:[cohortGap(1,account)]}).fetcher});
assert.equal(emptyRetained.status,'passed');assert.equal(emptyRetained.retainedRequestsChecked,0,'No current retained request remains a legitimate result');
const retainedOnly=await checkWorkspaceAttentionReadback({env,now,fetcher:cohortFixture({retained:[cohortGap(1,account,true)]}).fetcher});
assert.equal(retainedOnly.status,'not_observed');assert.equal(retainedOnly.completedRemindersChecked,0);assert.equal(retainedOnly.retainedRequestsChecked,1,'Positive-only coverage never claims completed-reminder proof');
const boundCohort=cohortFixture({
 hidden:Array.from({length:12},(_,n)=>cohortGap(n,account)),retained:Array.from({length:3},(_,n)=>cohortGap(12+n,account,true)),
 generalSample:Array.from({length:24},(_,n)=>cohortGap(15+n,account,true)),retainedSample:Array.from({length:12},(_,n)=>cohortGap(39+n,account,true))
});
const boundResult=await checkWorkspaceAttentionReadback({env,now,fetcher:boundCohort.fetcher});
assert.equal(boundResult.completedRemindersChecked,12);assert.equal(boundResult.retainedRequestsChecked,39);assert(boundResult.requests<=90);
assert.equal(Math.max(...boundCohort.calls.map(call=>Number(call.q.get('limit')))),51,'Twelve hidden seeds, three retained seeds and the existing 24+12 samples are the precise maximum');
assert(boundCohort.calls.some(call=>call.q.get('select')===gapFields&&call.q.get('limit')==='15'),'The seed read is bounded by both discoveries combined');
for(const retainedDiscovery of [
 Array.from({length:4},(_,n)=>({id:uuid(500+n),account_id:account})),
 [{id:gaps[1].id,account_id:account},{id:gaps[1].id,account_id:account}],
 [{id:gaps[0].id,account_id:account}],
 [{id:gaps[1].id,account_id:account,active_property:{body:'private'}}],
 [{id:'private invalid ID',account_id:account}]
])await assert.rejects(checkWorkspaceAttentionReadback({env,now,fetcher:fixture({retainedDiscovery}).fetcher}),/Attention API verification failed:/,'Retained discovery stays bounded, identifier-only and duplicate-free');

// Execute the real activity caller, then compare its nested URL to the checker.
// This uses no network and no duplicated application query implementation.
const emitted=[];
const {workspaceActivity}=await loadService('lib/workspace-activity-read.ts',{
 workspaceAttentionQuery,workspaceAttentionSource,sellerAttentionFilters:(id,prefix)=>sellerAttentionFilters(id,prefix,now),sellerReminderDeliveryEmbed,
 instantLeadsEnabled:()=>false,isConfirmedVoicemail:()=>false,attachTaskRecovery:async(_,rows)=>rows,
 NextResponse:{json:(body,options={})=>({body,status:options.status??200})},
 db:async(query,method)=>{
  emitted.push(query);
  if(query==='rpc/icash_workspace_opportunities')return [{id:properties[0].id,state:'complete',result:{property:{propertyId:'prop_fixture',address:'Fixture'}}}];
  return [];
 }
});
assert.equal((await workspaceActivity(new Request('https://example.invalid/api/work/activity'),account)).status,200);
const actual=emitted.find(query=>query.includes('icash_seller_gaps:icash_response_seller_gaps!inner('));assert(actual);
const canonical=query=>[...new URLSearchParams(query.split('?')[1])].sort(([a],[b])=>a.localeCompare(b));
assert.deepEqual(canonical(attentionBadgeReadbackQuery(account,[properties[0].id],now)),canonical(actual));

// A production invocation cannot skip the guard even if local/CI runs skipped it.
const runner=readFileSync(new URL('../scripts/check-contact-rpcs.mjs',import.meta.url),'utf8');
assert(runner.includes('await checkWorkspaceAttentionReadback()'));
const productionMissing=spawnSync(process.execPath,['--experimental-strip-types','scripts/check-contact-rpcs.mjs'],{env:{...process.env,VERCEL_ENV:'production',SUPABASE_URL:'',SUPABASE_SECRET_KEY:''},encoding:'utf8',timeout:10000});
assert.notEqual(productionMissing.status,0);assert.match(productionMissing.stderr,/verification failed/);
console.log('PASS attention API readback: bounded account-scoped GETs, actual direct/nested shared shapes, independent receipt-backed result oracle, pagination, unknown/manual/foreign receipts, absent proof and failure gates; offline fixtures only.');
