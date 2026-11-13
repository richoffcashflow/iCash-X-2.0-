import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {testEndedExportStatusRecovery} from './helpers/ended-export-status-recovery.mjs';
const db=new PGlite(),read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const q=(s,a=[])=>db.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const rpc=(name,...args)=>v('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+')',args);
const batch='00000000-0000-4000-8000-000000000001',account='00000000-0000-4000-8000-000000000002',screening='00000000-0000-4000-8000-000000000003',ticket='00000000-0000-4000-8000-000000000004',release='a'.repeat(40);
const snapshot=()=>v("select jsonb_build_object('export',(select to_jsonb(e) from icash_research_private.owner_exports e),'batch',(select to_jsonb(b) from icash_research_private.owner_batches b),'request',(select to_jsonb(q) from icash_research_private.requests q where kind='owner_lookup'),'handler',(select to_jsonb(t) from public.icash_automation_tickets t),'spend',(select to_jsonb(s) from public.icash_operation_spend s))");
async function probes(c,mutate=()=>{}){
 for(const probe of ['inventory','pending','processing']){
  if(probe!=='inventory')assert(await rpc('icash_claim_export_capacity_probe',c.reviewId,probe));
  const data=probe==='inventory'?[{export_id:'prior-export',status:'completed',created_at:'2026-01-01T00:00:00Z'}]:[];
  const raw={data,pagination:{limit:100,offset:0,total:data.length,has_more:false}};
  const stamp=await v('select clock_timestamp()');
  const receipt={httpStatus:200,raw,rawText:JSON.stringify(raw),headers:{minuteRemaining:49,dayRemaining:300,date:new Date(stamp).toUTCString(),age:null}};
  mutate(receipt,probe);receipt.rawText=JSON.stringify(receipt.raw);
  assert.equal(await rpc('icash_record_export_capacity_probe',c.reviewId,probe,receipt),true);
 }
}
try{
 for(const file of ['tests/fixtures/automatic-export-foundation.sql','config/owner-export-capacity-recovery.sql','supabase/migrations/20261030012215_owner_export_capacity_precision.sql','config/automatic-export-capacity.sql','config/gateway-export-capacity.sql','config/empty-export-capacity.sql','config/empty-export-immediate-capacity.sql','tests/fixtures/unknown-export-foundation.sql','tests/fixtures/unknown-export-late-foundation.sql','tests/fixtures/unknown-export-late-live-functions.sql','tests/fixtures/unknown-export-late-batch-function.sql'])await db.exec(read(file));
 const source=read('config/unknown-export-capacity.sql'),late=read('config/unknown-export-late-evidence.sql');
 const migration=read('supabase/migrations/20261105024908_unknown_export_capacity.sql');
 assert.equal(migration,source.slice(0,source.lastIndexOf('\ncommit;'))+'\n'+late.replace('\nbegin;',''));
 await db.exec(migration);
 assert.equal(read('config/ended-export-status-recovery.sql'),read('supabase/migrations/20261113050524_ended_export_status_recovery.sql'));
 await db.exec(read('config/ended-export-status-recovery.sql'));
 await q("insert into icash_research_private.owner_batches(id,account_id,created_at,primary_screening) values($1,$2,now()-interval '10 minutes',$3)",[batch,account,screening]);
 await q('insert into icash_research_private.owner_exports(id,request) values($1,$2)',[batch,{people_ids:['held-owner']}]);
 await q("insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at,finished_at,result) values($1,'owner_lookup',$2,$3,true,now()-interval '10 minutes',now()-interval '8 minutes',$4)",[batch,account,'owner-batch:'+batch,{outcome:'unknown'}]);
 await q("insert into public.icash_automation_tickets values($1,$2,$3,'contacts','held',now()-interval '11 minutes',now()-interval '9 minutes',now()-interval '8 minutes','held_for_reconciliation',1)",[ticket,account,screening]);
 await db.exec("insert into public.icash_operation_spend values('original','dispatched',105);update icash_research_private.export_capacity_automation set enabled=true,gateway_enabled=true,empty_enabled=true");
 assert.equal(await rpc('icash_owner_active_export_capacity'),'export_busy');
 assert.equal(await rpc('icash_claim_automatic_export_capacity',release),null,'Unknown-response family installs disabled');
 await db.exec('update icash_research_private.export_capacity_automation set unknown_enabled=true');
 await db.exec('begin');
 await assert.rejects(q("insert into icash_research_private.owner_export_capacity_reviews(export_id,receipt_hash,reviewed_release,source_snapshot) values($1,md5('{}'::jsonb::text),$2,'{}'::jsonb)",[batch,release]),e=>e.code==='23514'&&e.constraint==='unknown_capacity_source_required');
 await db.exec('rollback;begin');
 await q("insert into icash_research_private.owner_export_capacity_reviews(export_id,receipt_hash,reviewed_release) values($1,md5('{}'::jsonb::text),$2)",[batch,release]);
 await db.exec('rollback');
 const before=await snapshot();
 await testEndedExportStatusRecovery({db,q,v,rpc,probes,snapshot,release});
 for(const mutate of [
  "update icash_research_private.requests set admitted=false",
  "update icash_research_private.requests set admitted=null",
  "update icash_research_private.requests set finished_at=null",
  "update icash_research_private.requests set finished_at=now()-interval '1 minute'",
  "update icash_research_private.requests set finished_at=created_at-interval '1 second'",
  "update icash_research_private.requests set operation_key='wrong'",
  "update icash_research_private.requests set account_id=null",
  "update icash_research_private.requests set kind='owner_preview'",
  "update icash_research_private.requests set result='{}'",
  "update icash_research_private.requests set result='{"+'"outcome":"unknown","httpStatus":200'+"}'",
  "update icash_research_private.owner_batches set state='complete'",
  "update icash_research_private.owner_batches set state=null",
  "update icash_research_private.owner_batches set paid_receipt='{}'",
  "update icash_research_private.owner_batches set results='{}'",
  "update icash_research_private.owner_batches set primary_screening=null",
  "update icash_research_private.owner_exports set recovery='{}'",
  "update icash_research_private.owner_exports set csv='unexpected artifact'",
  "update icash_research_private.owner_exports set lease_until=now()+interval '1 minute'",
  "update icash_research_private.owner_exports set receipt='{}'",
  "update icash_research_private.owner_exports set request='{}'",
  "update icash_research_private.owner_exports set request='{"+'"people_ids":[]'+"}'",
  "update icash_research_private.owner_exports set request='{"+'"people_ids":[null]'+"}'",
  "update public.icash_automation_tickets set state='consumed'",
  "update public.icash_automation_tickets set outcome=null",
  "update public.icash_automation_tickets set issue_attempts=2",
  "update public.icash_automation_tickets set completed_at=null",
  "update public.icash_automation_tickets set completed_at=now()-interval '1 minute'",
  "update public.icash_automation_tickets set expires_at=now()+interval '1 minute'",
  "update public.icash_automation_tickets set completed_at=created_at",
  "update public.icash_automation_tickets set kind='discovery'",
  "insert into public.icash_automation_tickets select gen_random_uuid(),account_id,screening_id,kind,state,created_at,expires_at,completed_at,outcome,issue_attempts from public.icash_automation_tickets",
 ]){
  await db.exec('begin;'+mutate);assert.equal(await rpc('icash_claim_automatic_export_capacity',release),null,mutate);await db.exec('rollback;');
 }
 for(const mutate of [
  (r,p)=>{if(p==='inventory')r.headers.date=null;},
  (r,p)=>{if(p==='inventory')r.headers.date=123;},
  (r,p)=>{if(p==='inventory')r.headers.date='x'.repeat(129);},
  (r,p)=>{if(p==='pending')r.headers.date='invalid';},
  (r,p)=>{if(p==='processing')r.headers.date='Wed, 04 Nov 2020 00:00:00 GMT';},
  (r,p)=>{if(p==='inventory')r.headers.date='Wed, 04 Nov 2037 00:00:00 GMT';},
  (r,p)=>{if(p==='pending')r.headers.age='1';},
  (r,p)=>{if(p==='pending')r.headers.age=0;},
  (r,p)=>{if(p==='pending')delete r.headers.age;},
  (r,p)=>{if(p==='pending')r.raw.pagination.total=1;},
  (r,p)=>{if(p==='processing')r.raw.pagination.total=1;},
  (r,p)=>{if(p==='inventory'){r.raw.data=[];r.raw.pagination.total=0;}},
  (r,p)=>{if(p==='inventory')r.raw.data[0].status='processing';},
 ]){
  await db.exec('begin;');const c=await rpc('icash_claim_automatic_export_capacity',release);assert(c?.requestId);await probes(c,mutate);
  assert.equal(await rpc('icash_finish_automatic_export_capacity',c.reviewId),'capacity_review_held');
  assert.deepEqual(await snapshot(),before);assert.equal(await rpc('icash_claim_automatic_export_capacity',release),null,'Held attempts retain bounded backoff');await db.exec('rollback;');
 }
 for(const mutate of [
  "update icash_research_private.export_capacity_automation set unknown_enabled=false",
  "update icash_research_private.owner_exports set receipt='{}'",
  "update icash_research_private.owner_batches set paid_receipt='{}'",
  "update icash_research_private.requests set result='{}' where kind='owner_lookup'",
  "update public.icash_automation_tickets set outcome='changed'",
 ]){
  await db.exec('begin;');const c=await rpc('icash_claim_automatic_export_capacity',release);await probes(c);await db.exec(mutate);
  assert.equal(await rpc('icash_finish_automatic_export_capacity',c.reviewId),'capacity_review_held');
  assert.equal(await v('select capacity_review_id from icash_research_private.owner_exports'),null);await db.exec('rollback;');
 }
 const c=await rpc('icash_claim_automatic_export_capacity',release);assert(c?.requestId);await probes(c);
 assert.equal(await v('select auto_policy from icash_research_private.owner_export_capacity_reviews'),'unknown-idle-v1');
 assert.equal(await v("select receipt_hash=md5(source_snapshot::text) and source_snapshot#>'{export,receipt}'='null'::jsonb from icash_research_private.owner_export_capacity_reviews"),true);
 await assert.rejects(q("update icash_research_private.owner_export_capacity_reviews set source_snapshot='{}'"));
 assert.equal(await rpc('icash_finish_automatic_export_capacity',c.reviewId),'capacity_verified');
 assert.equal(await rpc('icash_finish_automatic_export_capacity',c.reviewId),'capacity_verified');
 assert.equal(await rpc('icash_owner_active_export_capacity'),'ready');
 assert.equal(await rpc('icash_owner_export_people_available',['held-owner']),false);
 const after=await snapshot();assert.deepEqual({...after,export:{...after.export,capacity_review_id:null}},before,'Only capacity binding changes; original unknown receipt, request, handler, owners and money remain held');
 for(const role of ['anon','authenticated','service_role'])for(const fn of ['unknown_capacity_source_snapshot(uuid)','capacity_source_fingerprint(uuid)','capacity_source_before_unknown(uuid,text)','capacity_probe_response_fresh(jsonb,timestamptz,timestamptz)'])assert.equal(await v("select has_function_privilege($1,$2,'execute')",[role,'icash_research_private.'+fn]),false);
 console.log('PASS unknown source admission/freshness: disabled policy, malformed/ambiguous/live source refusal, changed evidence, original records, immutable source snapshot, bounded backoff and private ACLs.');
}finally{await db.close();}
