import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {recoverAutomaticOwnerExportCapacity} from '../lib/automatic-export-capacity.ts';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=new PGlite(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const rpc=(name,...args)=>v('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+')',args);
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const batch=id(1),account=id(2),release='a'.repeat(40),heldOwner='held-owner';
const message='No records matched this export. Filters and scrub settings (like "Active phone numbers only") may have excluded every record — adjust them and try again.';
const failureRaw={error:{code:'invalid_request',message,request_id:'req_fixture'}};
const failure={httpStatus:400,raw:failureRaw,rawText:JSON.stringify(failureRaw)};
const isolated=async fn=>{await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}};
const snapshot=async()=>({
 export:await v('select to_jsonb(e) from icash_research_private.owner_exports e where id=$1',[batch]),
 batch:await v('select to_jsonb(b) from icash_research_private.owner_batches b where id=$1',[batch]),
 request:await v('select to_jsonb(r) from icash_research_private.requests r where id=$1',[batch]),
 money:await v("select to_jsonb(o) from public.icash_operation_spend o where operation_key='original'"),
});
function receipt(probe){
 // No history entry is created by a rejected empty export. An old terminal
 // inventory plus three fresh provider responses must still recover capacity.
 const raw={data:probe==='inventory'?[{export_id:'original-unrelated-history',status:'completed',created_at:'2020-01-01T00:00:00Z'}]:[],pagination:{limit:100,offset:0,total:probe==='inventory'?1:0,has_more:false}};
 return {httpStatus:200,raw,rawText:JSON.stringify(raw),headers:{minuteRemaining:49,dayRemaining:300,serverDate:new Date().toUTCString(),age:'0'}};
}
async function probes(claim,mutate=()=>{}){
 for(const probe of ['inventory','pending','processing']){
  if(probe!=='inventory')assert(await rpc('icash_claim_export_capacity_probe',claim.reviewId,probe));
  const saved=receipt(probe);mutate(saved,probe);saved.rawText=JSON.stringify(saved.raw);
  assert.equal(await rpc('icash_record_export_capacity_probe',claim.reviewId,probe,saved),true);
 }
}
try{
 for(const file of ['tests/fixtures/automatic-export-foundation.sql','config/owner-export-capacity-recovery.sql','supabase/migrations/20261030012215_owner_export_capacity_precision.sql','config/automatic-export-capacity.sql','config/gateway-export-capacity.sql','config/empty-export-capacity.sql'])await pg.exec(read(file));
 await q("insert into icash_research_private.owner_batches(id,account_id,created_at,paid_receipt) values($1,$2,now()-interval '8 minutes',$3)",[batch,account,failureRaw]);
 await q('insert into icash_research_private.owner_exports(id,request,receipt) values($1,$2,$3)',[batch,{people_ids:[heldOwner]},failure]);
 await q("insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at,finished_at,result) values($1,'owner_lookup',$2,$3,true,now()-interval '8 minutes',now()-interval '6 minutes',$4)",[batch,account,'owner-batch:'+batch,{outcome:'http_error',httpStatus:400}]);
 await pg.exec("insert into public.icash_operation_spend values('original','dispatched',100);update icash_research_private.export_capacity_automation set enabled=true,gateway_enabled=true");
 assert.equal(await rpc('icash_owner_active_export_capacity'),'export_busy');
 assert.equal(await rpc('icash_claim_automatic_export_capacity',release),null,'Exact saved HTTP 400 remains held before the staged policy is enabled');
 const original=await snapshot();
 await isolated(async()=>{
  await pg.exec('update icash_research_private.export_capacity_automation set empty_enabled=true');
  const c=await rpc('icash_claim_automatic_export_capacity',release);
  await probes(c,r=>{delete r.headers.serverDate;delete r.headers.age;});
  assert.equal(await rpc('icash_finish_automatic_export_capacity',c.reviewId),'capacity_verified','Reproduce predecessor accepting old inventory without provider freshness evidence');
 });
 const functions=['icash_research_private.guard_capacity_precision_followup()','public.icash_claim_export_capacity_probe(uuid,text)','public.icash_finish_automatic_export_capacity(uuid)'];
 const before=await Promise.all(functions.map(sig=>v('select pg_get_functiondef($1::regprocedure)',[sig])));
 const claimBefore=await v("select pg_get_functiondef('public.icash_claim_automatic_export_capacity(text)'::regprocedure)");
 const migration=read('config/empty-export-capacity-freshness.sql');
 const file=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(name=>name.endsWith('_empty_export_capacity_freshness.sql'));
 assert(file);assert.equal(read('supabase/migrations/'+file),migration);
 await pg.exec(migration);
 assert.equal(await v('select empty_enabled from icash_research_private.export_capacity_automation'),false);
 assert.equal(await rpc('icash_claim_automatic_export_capacity',release),null,'Freshness hardening preserves the disabled policy');
 assert.equal(await v("select pg_get_functiondef('public.icash_claim_automatic_export_capacity(text)'::regprocedure)"),claimBefore,'Atomic claims and quota admission remain exact');
 for(let i=0;i<functions.length;i++){
  let actual=await v('select pg_get_functiondef($1::regprocedure)',[functions[i]]);
  if(i===2)actual=actual.replace(/\n   -- Only the exact empty policy[\s\S]+?\n   end if;\n/,'');
  assert.equal(actual,before[i],'Existing policy proof, deadlines and backoff stay exact outside the new family');
 }
 await pg.exec('update icash_research_private.export_capacity_automation set empty_enabled=true');
 assert.equal(await v('select icash_research_private.capacity_source_policy(id,md5(receipt::text)) from icash_research_private.owner_exports'),'empty-idle-v1');
 assert.equal(await v("select icash_research_private.capacity_source_policy(id,repeat('0',32)) from icash_research_private.owner_exports"),null,'Original receipt hash is required');
 for(const mutate of [
  'update icash_research_private.export_capacity_automation set empty_enabled=false',
  'update icash_research_private.export_capacity_automation set enabled=false',
  'update fixture_settings set quota=false',
  'update fixture_settings set enabled=false',
  "update icash_research_private.owner_batches set state='complete'",
  'update icash_research_private.owner_batches set paid_receipt=null',
  "update icash_research_private.owner_batches set paid_receipt='{}'",
  'update icash_research_private.owner_exports set receipt=null',
  "update icash_research_private.owner_exports set receipt=jsonb_set(receipt,'{httpStatus}','422')",
  "update icash_research_private.owner_exports set receipt=jsonb_set(receipt,'{rawText}','\"invalid-json\"')",
  "update icash_research_private.owner_exports set receipt=jsonb_set(receipt,'{rawText}','\"{}\"')",
  "update icash_research_private.owner_exports set recovery='{}'",
  "update icash_research_private.owner_exports set csv='saved artifact'",
  "update icash_research_private.owner_exports set lease_until=now()+interval '1 minute'",
  'update icash_research_private.owner_exports set terminal_at=now()',
  'update icash_research_private.owner_exports set completed_at=now()',
  'update icash_research_private.requests set finished_at=null',
  'update icash_research_private.requests set finished_at=now()',
  "update icash_research_private.requests set finished_at=created_at-interval '1 second'",
  "update icash_research_private.requests set kind='owner_preview'",
  "update icash_research_private.requests set operation_key='other'",
  'update icash_research_private.requests set account_id=null',
  'update icash_research_private.requests set admitted=false',
  "update icash_research_private.requests set result='{\"outcome\":\"unknown\",\"httpStatus\":400}'",
  "update icash_research_private.requests set result='{\"outcome\":\"http_error\",\"httpStatus\":500}'",
 ])await isolated(async()=>{await pg.exec(mutate);assert.equal(await rpc('icash_claim_automatic_export_capacity',release),null,mutate);});
 for(const mutate of [
  raw=>{raw.error.code='other_error';},raw=>{raw.error.message='No records';},
  raw=>{delete raw.error.request_id;},raw=>{raw.error.request_id='unverified';},
  raw=>{raw.error.extra=true;},raw=>{raw.export_id='known-export';},
  raw=>{raw.credits={used:0};},raw=>{raw.error.code=null;},
 ])await isolated(async()=>{
  const raw=structuredClone(failureRaw);mutate(raw);
  await q('update icash_research_private.owner_exports set receipt=$1',[{httpStatus:400,raw,rawText:JSON.stringify(raw)}]);
  await q('update icash_research_private.owner_batches set paid_receipt=$1',[raw]);
  assert.equal(await rpc('icash_claim_automatic_export_capacity',release),null,'Other or contradictory error shapes never qualify');
 });
 for(const mutate of [
  (r,p)=>{if(p==='pending')r.raw.pagination.total=1;},
  (r,p)=>{if(p==='processing')r.raw.data=[{export_id:'active',status:'processing'}];},
  (r,p)=>{if(p==='inventory')r.headers.serverDate='Wed, 01 Jan 2020 00:00:00 GMT';},
  (r,p)=>{if(p==='pending')r.headers.serverDate=null;},
  (r,p)=>{if(p==='processing')delete r.headers.serverDate;},
  (r,p)=>{if(p==='pending')r.headers.serverDate='invalid';},
  (r,p)=>{if(p==='processing')r.headers.serverDate=new Date(Date.now()+60000).toUTCString();},
  (r,p)=>{if(p==='inventory')r.headers.age='1';},
  (r,p)=>{if(p==='pending')r.headers.age='invalid';},
  (r,p)=>{if(p==='processing')r.headers.age=0;},
  (r,p)=>{if(p==='inventory')r.raw.data=[];},
  (r,p)=>{if(p==='processing')r.headers.dayRemaining=0;},
  (r,p)=>{if(p==='processing')r.httpStatus=500;},
 ])await isolated(async()=>{
  const c=await rpc('icash_claim_automatic_export_capacity',release);assert(c?.requestId);await probes(c,mutate);
  assert.equal(await rpc('icash_finish_automatic_export_capacity',c.reviewId),'capacity_review_held');
  assert.deepEqual(await snapshot(),original);assert.equal(await rpc('icash_claim_automatic_export_capacity',release),null,'Failed evidence retains backoff');
 });
 for(const mutate of [
  'update icash_research_private.export_capacity_automation set empty_enabled=false',
  "update icash_research_private.owner_batches set paid_receipt='{}'",
  "update icash_research_private.requests set operation_key='other' where kind='owner_lookup'",
  "update icash_research_private.owner_exports set recovery='{}'",
 ])await isolated(async()=>{
  const c=await rpc('icash_claim_automatic_export_capacity',release);await probes(c);await pg.exec(mutate);
  assert.equal(await rpc('icash_finish_automatic_export_capacity',c.reviewId),'capacity_review_held');
  assert.equal(await v('select capacity_review_id from icash_research_private.owner_exports'),null);
 });
 await isolated(async()=>{
  await q('insert into icash_research_private.owner_export_capacity_reviews(export_id,receipt_hash,reviewed_release) values($1,md5($2::jsonb::text),$3)',[batch,failure,release]);
  assert.equal(await rpc('icash_claim_automatic_export_capacity',release),null,'Existing manual review remains manual');
 });
 await isolated(async()=>{
  const c=await rpc('icash_claim_automatic_export_capacity',release);
  await pg.exec("alter table icash_research_private.owner_export_capacity_reviews disable trigger owner_export_capacity_review_immutable;update icash_research_private.owner_export_capacity_reviews set created_at=now()-interval '3 minutes',started_at=now()-interval '3 minutes';alter table icash_research_private.owner_export_capacity_reviews enable trigger owner_export_capacity_review_immutable");
  const before=await v('select to_jsonb(r) from icash_research_private.owner_export_capacity_reviews r where id=$1',[c.reviewId]);
  const next=await rpc('icash_claim_automatic_export_capacity',release);assert(next);assert.notEqual(next.reviewId,c.reviewId);assert.notEqual(next.requestId,c.requestId);
  assert.equal(await v('select auto_policy from icash_research_private.owner_export_capacity_reviews where id=$1',[next.reviewId]),'empty-idle-v1');
  assert.deepEqual(await v('select to_jsonb(r) from icash_research_private.owner_export_capacity_reviews r where id=$1',[c.reviewId]),before);
 });
 // Exercise the real maintenance transport against SQL admission/finalization.
 // The fake provider only accepts the three GETs, never export/download/send.
 const calls=[];
 const db=async(path,method,body)=>{
  assert.equal(method,'POST');
  if(path==='rpc/icash_finish_dealmachine_request')return true;
  const entries=Object.entries(body);
  return v('select public.'+path.replace('rpc/','')+'('+entries.map(([key],i)=>key+'=>'+ '$'+(i+1)).join(',')+')',entries.map(([,value])=>value));
 };
 const transport=async(url,options)=>{
  const u=new URL(url),probe=u.searchParams.get('status')??'inventory';calls.push(probe);
  assert.equal(u.origin,'https://api.v2.dealmachine.com');assert.equal(u.pathname,'/v1/exports');assert.equal(options.method,'GET');
  assert.equal(u.searchParams.get('limit'),'100');assert.equal(u.searchParams.get('offset'),'0');
  assert.equal(options.headers['Cache-Control'],'no-cache');assert.equal(options.headers.Pragma,'no-cache');
  return Response.json(receipt(probe).raw,{headers:{'X-RateLimit-Remaining':'49','X-RateLimit-Day-Remaining':'300',Date:new Date().toUTCString(),Age:'0'}});
 };
 const env={VERCEL_ENV:'production',DEALMACHINE_API_KEY:'dm_sk_live_fixture',VERCEL_GIT_COMMIT_SHA:release};
 assert.deepEqual(await recoverAutomaticOwnerExportCapacity(db,transport,env),{status:'capacity_verified'});
 assert.deepEqual(calls,['inventory','pending','processing']);
 assert.equal(await recoverAutomaticOwnerExportCapacity(db,transport,env),null);assert.equal(calls.length,3);
 assert.equal(await rpc('icash_owner_active_export_capacity'),'ready');
 assert.equal(await rpc('icash_owner_export_people_available',[heldOwner]),false);
 assert.equal(await rpc('icash_owner_export_people_available',['independent-owner']),true);
 const after=await snapshot();assert(after.export.capacity_review_id);after.export.capacity_review_id=null;assert.deepEqual(after,original);
 assert.equal(await v('select count(*)::integer from icash_research_private.export_capacity_probes'),3);
 for(const role of ['anon','authenticated','service_role'])for(const sig of ['capacity_source_policy(uuid,text)','capacity_source_before_empty(uuid,text)'])assert.equal(await v('select has_function_privilege($1,$2,\'execute\')',[role,'icash_research_private.'+sig]),false);
 assert.equal(await v("select has_table_privilege('service_role','icash_research_private.export_capacity_automation','update')"),false);
 console.log('PASS exact empty-filter export recovery: original global blockage reproduced; staged policy and three free maintenance GETs restore independent capacity, preserving all original receipts, owners, money, source guards and backoff.');
}finally{await pg.close();}
