import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const q=(s,a=[])=>db.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const rpc=(name,...args)=>v('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+')',args);
const batch='00000000-0000-4000-8000-000000000001',account='00000000-0000-4000-8000-000000000002',release='a'.repeat(40);
const raw={error:{code:'invalid_request',message:'No records matched this export. Filters and scrub settings (like "Active phone numbers only") may have excluded every record — adjust them and try again.',request_id:'req_fixture'}};
const failure={httpStatus:400,raw,rawText:JSON.stringify(raw)};
const snapshot=()=>v("select jsonb_build_object('export',(select to_jsonb(e) from icash_research_private.owner_exports e),'batch',(select to_jsonb(b) from icash_research_private.owner_batches b),'request',(select to_jsonb(q) from icash_research_private.requests q where kind='owner_lookup'),'spend',(select to_jsonb(s) from public.icash_operation_spend s))");
async function probes(c,mutate=()=>{}){
 for(const probe of ['inventory','pending','processing']){
  if(probe!=='inventory')assert(await rpc('icash_claim_export_capacity_probe',c.reviewId,probe));
  // A no-records rejection creates no export. Its latest history predates the
  // rejected request, while each status query is newly admitted and received.
  const data=probe==='inventory'?[{export_id:'prior-export',status:'completed',created_at:'2026-01-01T00:00:00Z'}]:[];
  const raw={data,pagination:{limit:100,offset:0,total:data.length,has_more:false}};
  const receipt={httpStatus:200,raw,rawText:JSON.stringify(raw),headers:{minuteRemaining:49,dayRemaining:300}};
  mutate(receipt,probe);receipt.rawText=JSON.stringify(receipt.raw);
  assert.equal(await rpc('icash_record_export_capacity_probe',c.reviewId,probe,receipt),true);
 }
}
try{
 for(const file of ['tests/fixtures/automatic-export-foundation.sql','config/owner-export-capacity-recovery.sql','supabase/migrations/20261030012215_owner_export_capacity_precision.sql','config/automatic-export-capacity.sql','config/gateway-export-capacity.sql','config/empty-export-capacity.sql'])await db.exec(read(file));
 await q("insert into icash_research_private.owner_batches(id,account_id,created_at,paid_receipt) values($1,$2,now()-interval '8 minutes',$3)",[batch,account,raw]);
 await q('insert into icash_research_private.owner_exports(id,request,receipt) values($1,$2,$3)',[batch,{people_ids:['held-owner']},failure]);
 await q("insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at,finished_at,result) values($1,'owner_lookup',$2,$3,true,now()-interval '8 minutes',now()-interval '6 minutes',$4)",[batch,account,'owner-batch:'+batch,{outcome:'http_error',httpStatus:400}]);
 await db.exec("insert into public.icash_operation_spend values('original','dispatched',100);update icash_research_private.export_capacity_automation set enabled=true,gateway_enabled=true");
 assert.equal(await rpc('icash_owner_active_export_capacity'),'export_busy','Reproduce platform-wide blockage');
 assert.equal(await rpc('icash_claim_automatic_export_capacity',release),null,'New policy installs disabled');
 await db.exec('update icash_research_private.export_capacity_automation set empty_enabled=true');
 const before=await snapshot();
 for(const mutate of [
  "update icash_research_private.requests set admitted=false",
  "update icash_research_private.requests set finished_at=null",
  "update icash_research_private.requests set finished_at=now()",
  "update icash_research_private.requests set finished_at=created_at-interval '1 second'",
  "update icash_research_private.requests set operation_key='wrong'",
  "update icash_research_private.requests set account_id=null",
  "update icash_research_private.requests set kind='owner_preview'",
  "update icash_research_private.requests set result='{}'",
  "update icash_research_private.owner_batches set state='complete'",
  "update icash_research_private.owner_batches set paid_receipt=null",
  "update icash_research_private.owner_exports set recovery='{}'",
  "update icash_research_private.owner_exports set csv='unexpected artifact'",
  "update icash_research_private.owner_exports set lease_until=now()+interval '1 minute'",
  "update icash_research_private.owner_exports set receipt=jsonb_set(receipt,'{httpStatus}','500')",
  "update icash_research_private.owner_exports set receipt=jsonb_set(receipt,'{raw,error,code}','\"internal_error\"')",
  "update icash_research_private.owner_exports set receipt=jsonb_set(receipt,'{raw,error,message}','\"Other invalid request\"')",
  "update icash_research_private.owner_exports set receipt=jsonb_set(receipt,'{raw,error,request_id}','\"unknown\"')",
  "update icash_research_private.owner_exports set receipt=jsonb_set(receipt,'{raw,export_id}','\"known\"')",
  "update icash_research_private.owner_exports set receipt=jsonb_set(receipt,'{rawText}','\"malformed\"')",
 ]){
  await db.exec('begin;'+mutate);assert.equal(await rpc('icash_claim_automatic_export_capacity',release),null,mutate);await db.exec('rollback;');
 }
 for(const mutate of [
  (r,p)=>{if(p==='pending')r.raw.pagination.total=1;},
  (r,p)=>{if(p==='processing')r.raw.pagination.total=1;},
  (r,p)=>{if(p==='inventory'){r.raw.data=[];r.raw.pagination.total=0;}},
  (r,p)=>{if(p==='inventory')r.raw.data[0].status='processing';},
  (r,p)=>{if(p==='inventory')r.raw.data[0].created_at='invalid';},
  (r,p)=>{if(p==='processing')r.headers.dayRemaining=0;},
 ]){
  await db.exec('begin;');const c=await rpc('icash_claim_automatic_export_capacity',release);assert(c?.requestId);await probes(c,mutate);
  assert.equal(await rpc('icash_finish_automatic_export_capacity',c.reviewId),'capacity_review_held');
  assert.deepEqual(await snapshot(),before);await db.exec('rollback;');
 }
 for(const mutate of [
  "update icash_research_private.export_capacity_automation set empty_enabled=false",
  "update icash_research_private.owner_exports set receipt=null",
  "update icash_research_private.owner_batches set paid_receipt=null",
  "update icash_research_private.requests set result='{}' where kind='owner_lookup'",
 ]){
  await db.exec('begin;');const c=await rpc('icash_claim_automatic_export_capacity',release);await probes(c);await db.exec(mutate);
  assert.equal(await rpc('icash_finish_automatic_export_capacity',c.reviewId),'capacity_review_held');
  assert.equal(await v('select capacity_review_id from icash_research_private.owner_exports'),null);await db.exec('rollback;');
 }
 // Prior source policies still require post-incident export inventory.
 for(const status of [500,504]){
  await db.exec('begin;');const r=status===500?{httpStatus:500,raw:{error:{code:'internal_error',request_id:'req_fixture'}},rawText:JSON.stringify({error:{code:'internal_error',request_id:'req_fixture'}})}:{httpStatus:504,raw:null,rawText:'dealmachine.com | 504: Gateway time-out api.v2.dealmachine.com'};
  await q('update icash_research_private.owner_exports set receipt=$1',[r]);await db.exec('update icash_research_private.owner_batches set paid_receipt=null');
  await q("update icash_research_private.requests set result=$1 where kind='owner_lookup'",[{outcome:'http_error',httpStatus:status}]);
  const c=await rpc('icash_claim_automatic_export_capacity',release);assert(c?.requestId);await probes(c);
  assert.equal(await rpc('icash_finish_automatic_export_capacity',c.reviewId),'capacity_review_held','Historical inventory exception belongs only to exact empty rejection');await db.exec('rollback;');
 }
 const c=await rpc('icash_claim_automatic_export_capacity',release);assert(c?.requestId);await probes(c);
 assert.equal(await rpc('icash_finish_automatic_export_capacity',c.reviewId),'capacity_verified');
 assert.equal(await rpc('icash_finish_automatic_export_capacity',c.reviewId),'capacity_verified');
 assert.equal(await rpc('icash_owner_active_export_capacity'),'ready');
 assert.equal(await rpc('icash_owner_export_people_available',['held-owner']),false);
 const after=await snapshot();assert.deepEqual({...after,export:{...after.export,capacity_review_id:null}},before,'Only capacity binding changes; receipts, money and original owners remain held');
 assert.equal(await v('select auto_policy from icash_research_private.owner_export_capacity_reviews'),'empty-idle-v1');
 assert.equal(await v('select count(*)::integer from icash_research_private.export_capacity_probes'),3);
 for(const role of ['anon','authenticated','service_role'])for(const name of ['capacity_source_policy','capacity_source_before_empty'])assert.equal(await v('select has_function_privilege($1,$2,\'execute\')',[role,'icash_research_private.'+name+'(uuid,text)']),false);
 console.log('PASS exact empty-export capacity recovery: staged400 policy, rejected unknown sources, three fresh idle probes, no post-incident export requirement only for400, original money/owner fences and ACLs preserved.');
}finally{await db.close();}
