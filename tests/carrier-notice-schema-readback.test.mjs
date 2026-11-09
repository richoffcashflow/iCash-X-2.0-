import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {checkCarrierNoticeSchemaReadback,carrierSchemaReadbackQueries} from '../scripts/check-carrier-notice-schema-readback.mjs';
import {workspaceAttentionQuery,workspaceAttentionSource,workspaceAttentionTables,sellerAttentionFilters,sellerReminderDeliveryEmbed} from '../lib/workspace-attention-query.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';

const absent='00000000-0000-4000-8000-000000000000',now='2026-11-09T00:00:00.000Z';
const env={VERCEL_ENV:'production',SUPABASE_URL:'https://database.example.test',SUPABASE_SECRET_KEY:'fixture-secret-never-log'};
const json=value=>Response.json(value);
const planned=carrierSchemaReadbackQueries(now);
assert.equal(planned.length,16);
assert.equal(new Set(planned.map(q=>q.name)).size,16);

function fixture(responder=()=>json([])){
 const calls=[];
 const fetcher=async(url,options)=>{
  const u=new URL(url),q=u.searchParams,table=u.pathname.slice('/rest/v1/'.length);
  calls.push({url,options,table,q});
  assert.equal(u.origin,env.SUPABASE_URL,'Only the configured PostgREST origin');
  assert.equal(options.method,'GET');assert.equal(options.body,undefined,'No RPCs or writes');
  assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
  assert.equal(options.headers.apikey,env.SUPABASE_SECRET_KEY);assert.equal(options.headers.Authorization,'Bearer '+env.SUPABASE_SECRET_KEY);
  assert.equal(options.headers.Accept,'application/json');assert(options.signal instanceof AbortSignal);
  assert.equal(q.get('account_id'),'eq.'+absent);assert.deepEqual(q.getAll('limit'),['0']);
  const key=table==='icash_response_sms_route_reviews'?'message_id':'id';
  assert(q.getAll(key).includes('eq.'+absent));assert(q.getAll(key).includes('neq.'+absent));
  assert.equal(u.pathname,'/rest/v1/'+planned[calls.length-1].query.split('?')[0]);
  assert.equal(u.search.slice(1),planned[calls.length-1].query.split('?')[1]);
  return responder(calls.at(-1),calls.length);
 };
 return {calls,fetcher};
}
for(const mode of ['production','preview']){
 const f=fixture();
 assert.deepEqual(await checkCarrierNoticeSchemaReadback({env:{...env,VERCEL_ENV:mode},fetcher:f.fetcher,now}),{status:'passed',shapes:16,requests:16});
 assert.equal(f.calls.length,16,'One bounded request per exact shape; no discovery or retry');
 for(const {table,q} of f.calls){
  if(table==='icash_response_text_messages'){
   assert.equal(q.get('thread.account_id'),'eq.'+absent);assert.equal(q.get('thread.deal_id'),'eq.'+absent);
   assert.equal(q.get('thread.retired_at'),'is.null');assert(['eq.seller','eq.buyer'].includes(q.get('thread.party')));
   assert.equal(q.get('select'),'id,body,attachments,direction,state,customer_author_id,created_at,thread:icash_text_threads!inner(id,party,paused)');
  }
  if(q.get('select').includes('active_property:')){
   assert.equal(q.get('active_property.account_id'),'eq.'+absent);assert.equal(q.get('active_property.state'),'eq.complete');
   assert.equal(q.get('state'),table==='icash_response_text_attention'?'eq.open':table==='icash_response_handoffs'?'neq.resolved':'eq.needs_review');
   if(table==='icash_response_handoffs')assert.equal(q.get('portal_journey_id'),'is.null');
  }
  if(table==='icash_screening_jobs'){
   const source=['icash_text_attention','icash_sms_call_requests','icash_seller_gaps','icash_handoffs'].find(source=>q.has(source+'.state'));
   assert(source);assert.equal(q.get(source+'.account_id'),'eq.'+absent);
   assert(q.get('select').includes(source+':'+workspaceAttentionSource(source)+'!inner('));
   assert(q.getAll('id').includes('in.('+absent+')'),'Preserve the original selected property bound');
  }
  if(q.get('select').includes(sellerReminderDeliveryEmbed)){
   const prefix=table==='icash_screening_jobs'?'icash_seller_gaps':'';
   for(const [key,value] of sellerAttentionFilters(absent,prefix,now))assert.equal(q.get(key),value);
  }
  if(table==='icash_response_sms_route_reviews'){assert.equal(q.get('resolved_at'),'is.null');assert.equal(q.get('select'),'message_id');}
 }
}

const noRequests=()=>{throw Error('Unexpected request outside configured deployment');};
for(const mode of [undefined,'development','test','Production'])assert.deepEqual(await checkCarrierNoticeSchemaReadback({env:{...env,VERCEL_ENV:mode},fetcher:noRequests}),{status:'not_requested'});
for(const missing of [{SUPABASE_URL:''},{SUPABASE_SECRET_KEY:''},{SUPABASE_URL:'',SUPABASE_SECRET_KEY:''}]){
 assert.deepEqual(await checkCarrierNoticeSchemaReadback({env:{...env,...missing,VERCEL_ENV:'preview'},fetcher:noRequests}),{status:'not_configured'});
 await assert.rejects(checkCarrierNoticeSchemaReadback({env:{...env,...missing},fetcher:noRequests}),/Carrier schema verification failed: configuration_required\./);
}
for(const url of ['http://database.example.test','https://user:secret@database.example.test','https://database.example.test/path','https://database.example.test?secret=1','https://database.example.test/#secret','not-a-url']){
 await assert.rejects(checkCarrierNoticeSchemaReadback({env:{...env,SUPABASE_URL:url},fetcher:noRequests}),/Carrier schema verification failed: (invalid_configuration|request_failed)\./);
}
await assert.rejects(checkCarrierNoticeSchemaReadback({env,fetcher:noRequests,now:'private,malformed'}),/invalid_configuration/);

async function denied(responder,code,at=1){
 const f=fixture((call,n)=>n===at?responder(call):json([]));
 await assert.rejects(checkCarrierNoticeSchemaReadback({env,fetcher:f.fetcher,now}),error=>{
  assert.equal(error.message,'Carrier schema verification failed: '+code+'.');
  assert(!error.stack.includes(env.SUPABASE_SECRET_KEY));assert(!error.message.includes(absent));
  return true;
 });
 assert.equal(f.calls.length,at,'Fail immediately without fallback or retry');
}
// Every relationship is independently required, including the last shape.
for(let at=1;at<=16;at++)await denied(()=>Response.json({code:'PGRST200',message:'relationship missing '+env.SUPABASE_SECRET_KEY},{status:400}),'http_response',at);
for(const status of [401,403,404,405,429,500,503,301,302,307,308,201,206])await denied(()=>new Response('private error body',{status}),'http_response');
await denied(()=>Response.json({code:'PGRST201',details:'ambiguous !outgoing_id '+env.SUPABASE_SECRET_KEY},{status:300}),'http_response');
await denied(()=>{const r=json([]);Object.defineProperty(r,'redirected',{value:true});return r;},'http_response');
await denied(()=>new Response(null,{headers:{'content-type':'application/json'}}),'missing_response');
await denied(()=>new Response('[]',{headers:{'content-type':'text/html'}}),'invalid_response');
for(const value of [{},null,'[]',true,[{body:'private customer row'}],[[]]])await denied(()=>json(value),'invalid_response');
await denied(()=>new Response('private malformed JSON '+env.SUPABASE_SECRET_KEY,{headers:{'content-type':'application/json'}}),'request_failed');
await denied(()=>{throw Error('https://private.invalid/'+env.SUPABASE_SECRET_KEY);},'request_failed');
let cancelled=0;
await denied(()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('private error body'));},cancel(){cancelled++;}}),{status:400}),'http_response');
assert.equal(cancelled,1,'Never consume unsuccessful response bodies');
await denied(()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(600));c.enqueue(new Uint8Array(600));},cancel(){cancelled++;}}),{headers:{'content-type':'application/json'}}),'response_bound');
assert.equal(cancelled,2,'Cancel oversized responses even without Content-Length');
await denied(()=>new Response(new ReadableStream({start(c){c.error(Error('private stream failure'));}}),{headers:{'content-type':'application/json'}}),'request_failed');
const boundary=fixture(()=>new Response(' '.repeat(1022)+'[]',{headers:{'content-type':'application/json; charset=utf-8'}}));
assert.equal((await checkCarrierNoticeSchemaReadback({env,fetcher:boundary.fetcher,now})).requests,16,'Total bytes bounded at 16 KiB');

// Use the real AbortSignals and abort-aware synthetic transport, speeding only
// their clocks. No live network is contacted, and timeout errors stay sanitized.
const timeout=AbortSignal.timeout;
try{
 const requested=[];
 AbortSignal.timeout=ms=>{requested.push(ms);return timeout(ms===45000?100:5);};
 const keepAlive=setTimeout(()=>{},200);
 try{
  await denied(({options})=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('private timeout '+env.SUPABASE_SECRET_KEY)),{once:true})),'request_failed');
  await denied(({options})=>new Response(new ReadableStream({start(c){options.signal.addEventListener('abort',()=>c.error(Error('private body timeout')),{once:true});}}),{headers:{'content-type':'application/json'}}),'request_failed');
 }finally{clearTimeout(keepAlive);}
 assert.deepEqual(requested,[45000,10000,45000,10000]);
 AbortSignal.timeout=ms=>timeout(ms===45000?5:100);
 const total=fixture(async()=>{await new Promise(resolve=>setTimeout(resolve,10));return json([]);});
 await assert.rejects(checkCarrierNoticeSchemaReadback({env,fetcher:total.fetcher,now}),/request_failed/);
 assert.equal(total.calls.length,1,'Shared deadline stops subsequent requests');
}finally{AbortSignal.timeout=timeout;}

// Execute actual app callers with injected database fixtures. Compare every
// changed REST query, not a source substring or a second copy of the builder.
const emitted=[];
const deps={workspaceAttentionQuery,workspaceAttentionSource,workspaceAttentionTables,sellerAttentionFilters:(id,prefix)=>sellerAttentionFilters(id,prefix,now),sellerReminderDeliveryEmbed};
const record=query=>{emitted.push(query);return [];};
const {workspaceActivity}=await loadService('lib/workspace-activity-read.ts',{
 ...deps,instantLeadsEnabled:()=>false,isConfirmedVoicemail:()=>false,attachTaskRecovery:async(_,rows)=>rows,
 NextResponse:{json:(body,options={})=>({body,status:options.status??200})},
 db:async query=>{record(query);return query==='rpc/icash_workspace_opportunities'?[{id:absent,state:'complete',result:{property:{propertyId:'prop_fixture',address:'Fictional'}}}]:[];}
});
assert.equal((await workspaceActivity(new Request('https://example.invalid/api/work/activity'),absent)).status,200);
const {workspaceAssistantContext}=await loadService('lib/workspace-assistant-context.ts',{
 ...deps,validActivityReport:()=>true,currentBotActivity:()=>({checkedAt:now,label:'Fixture',active:false}),
 db:async query=>{record(query);return query.startsWith('icash_accounts?')?[{bot_paused:true}]:query.startsWith('icash_wallets?')?[{balance_cents:0,reserved_cents:0}]:[];}
});
await workspaceAssistantContext(absent,'UTC','What needs my attention?');
const {assistantDealContext}=await loadService('lib/workspace-assistant-deal-context.ts',{db:async query=>record(query)});
await assistantDealContext(absent,absent,'prop_fixture',absent);
const {GET}=await loadService('app/api/work/seller-recovery/route.ts',{
 ...deps,workAccount:async()=>({accountId:absent}),NextResponse:{json:Response.json},db:async query=>record(query)
});
assert.equal((await GET()).status,200);
const changed=query=>query.startsWith('icash_response_')||query.includes(':icash_response_')||query.startsWith('icash_seller_gaps?');
const actual=emitted.filter(changed);
assert.equal(actual.length,16,'All current affected REST callers covered');
function canonical(query,proof=false){
 const [table,search]=query.split('?'),params=new URLSearchParams(search);
 params.delete('limit');
 if(proof){const key=table==='icash_response_sms_route_reviews'?'message_id':'id';params.delete(key,'eq.'+absent);params.delete(key,'neq.'+absent);}
 // Only the clock varies between real shared-builder calls. All receipt,
 // account, party, state, column, order and property predicates must match.
 return table+'?'+JSON.stringify([...params].map(([k,v])=>[k,v.replace(/expires_at\.gt\.[^,)]+/g,'expires_at.gt.'+now)]).sort(([a],[b])=>a.localeCompare(b)));
}
assert.deepEqual(planned.map(({query})=>canonical(query,true)).sort(),actual.map(query=>canonical(query)).sort());

const runner=readFileSync(new URL('../scripts/check-contact-rpcs.mjs',import.meta.url),'utf8');
assert(runner.includes('await checkCarrierNoticeSchemaReadback()'));assert(runner.includes('await checkWorkspaceAttentionReadback()'));
const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
assert(pkg.scripts.build.includes('scripts/check-contact-rpcs.mjs'));
assert(readFileSync(new URL('../scripts/verify-release-local.mjs',import.meta.url),'utf8').includes("'carrier-notice-schema-readback'"));
for(const mode of ['development','preview','production']){
 const child=spawnSync(process.execPath,['--experimental-strip-types','scripts/check-contact-rpcs.mjs'],{env:{...process.env,VERCEL_ENV:mode,SUPABASE_URL:'',SUPABASE_SECRET_KEY:''},encoding:'utf8',timeout:10000});
 assert.equal(child.error,undefined);
 if(mode==='production'){assert.notEqual(child.status,0);assert.match(child.stderr,/verification failed/);}
 else{assert.equal(child.status,0);assert.match(child.stdout,/Carrier schema verification:.*"status":"(?:not_requested|not_configured)"/);assert.match(child.stdout,/Attention API verification:/);}
}
// Run the actual configured CLI with a synthetic fetch installed before import.
// This proves the new release gate composes with (not replaces) both old checks.
for(const broken of [false,true]){
 const entry=new URL('../scripts/check-contact-rpcs.mjs',import.meta.url);
 const code=`
  import assert from 'node:assert/strict';
  const calls=[];
  globalThis.fetch=async (url,options)=>{
   const u=new URL(url);calls.push(u);
   assert.equal(u.origin,'https://database.example.test');assert.equal(options.method,'GET');
   if(${broken}&&u.searchParams.get('limit')==='0')return Response.json({code:'PGRST201',details:'fixture-secret-never-log'},{status:300});
   return Response.json([]);
  };
  process.argv[1]=${JSON.stringify(entry.pathname)};
  await import(${JSON.stringify(entry.href)});
  process.on('beforeExit',()=>{
   assert.equal(calls.filter(u=>u.searchParams.get('limit')==='0').length,${broken?1:16});
   assert.equal(calls.length,${broken?2:21});
  });
 `;
 const child=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],{env:{...process.env,...env},encoding:'utf8',timeout:10000});
 assert.equal(child.error,undefined);assert(!child.stderr.includes(env.SUPABASE_SECRET_KEY));
 if(broken){assert.equal(child.status,1);assert.match(child.stderr,/Carrier schema verification failed: http_response\./);assert(!child.stdout.includes('Carrier schema verification:'));}
 else{assert.equal(child.status,0,child.stderr);assert.match(child.stdout,/Contact API verification:/);assert.match(child.stdout,/Carrier schema verification:.*"status":"passed"/);assert.match(child.stdout,/Attention API verification:.*"status":"not_observed"/);}
}
console.log('PASS carrier schema readback: all 16 actual REST shapes, exact columns/guards, zero-row fences, preview/production gating, bounded GET/bytes/deadlines, fail-closed relationships/redirects/malformed replies and sanitized diagnostics; synthetic transport only.');
