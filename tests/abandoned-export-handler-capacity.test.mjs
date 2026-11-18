import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createRequire} from 'node:module';

const native=process.env.ICASH_ABANDONED_EXPORT_NATIVE_TEST==='1';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migrations=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(p=>p.endsWith('_abandoned_export_handler_capacity.sql'));
assert.equal(migrations.length,1);
assert.equal(read('supabase/migrations/'+migrations[0]),read('config/abandoned-export-handler-capacity.sql'));
let db;
if(native){
 const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE??'pg');
 const client=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',ssl:false,connectionTimeoutMillis:5000});
 await client.connect();
 assert.deepEqual({host:client.connection.stream.remoteAddress,port:client.connection.stream.remotePort},{host:'127.0.0.1',port:55443});
 const proof=(await client.query("select current_database() db,current_user username,current_setting('server_version_num')::integer version")).rows[0];
 assert.equal(proof.db,'icash_reliability');assert.equal(proof.username,'postgres');assert(proof.version>=170000&&proof.version<180000);
 db={query:(s,args=[])=>client.query(s,args.map(x=>Array.isArray(x)?JSON.stringify(x):x)),exec:s=>client.query(s),close:()=>client.end()};
}else db=new PGlite();
const q=(s,a=[])=>db.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const rpc=(name,...args)=>v('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+')',args);
const batch='00000000-0000-4000-8000-000000000001',account='00000000-0000-4000-8000-000000000002',screening='00000000-0000-4000-8000-000000000003',ticket='00000000-0000-4000-8000-000000000004',release='a'.repeat(40);
const signature='icash_research_private.capacity_source_before_credit(uuid,text)';
const original=()=>v("select jsonb_build_object('export',(select to_jsonb(e)-'capacity_review_id' from icash_research_private.owner_exports e),'batch',(select to_jsonb(b) from icash_research_private.owner_batches b),'request',(select to_jsonb(q) from icash_research_private.requests q where kind='owner_lookup'),'handler',(select to_jsonb(t) from public.icash_automation_tickets t),'spend',(select to_jsonb(s) from public.icash_operation_spend s))");
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
 for(const file of ['tests/fixtures/automatic-export-foundation.sql','config/owner-export-capacity-recovery.sql','supabase/migrations/20261030012215_owner_export_capacity_precision.sql','config/automatic-export-capacity.sql','config/gateway-export-capacity.sql','config/empty-export-capacity.sql','config/empty-export-immediate-capacity.sql','tests/fixtures/unknown-export-foundation.sql','tests/fixtures/unknown-export-late-foundation.sql','tests/fixtures/unknown-export-late-live-functions.sql','tests/fixtures/unknown-export-late-batch-function.sql','supabase/migrations/20261105024908_unknown_export_capacity.sql','config/ended-export-status-recovery.sql'])await db.exec(read(file));
 // Recreate the current helper name and policy-hash slot. The outer credit
 // branch is unrelated; this fixture delegates to the actual captured helper.
 await db.exec(`alter function icash_research_private.capacity_source_policy(uuid,text) rename to capacity_source_before_credit;
 create function icash_research_private.capacity_source_policy(uuid,text) returns text language sql stable set search_path='' as 'select icash_research_private.capacity_source_before_credit($1,$2)';
 create table icash_research_private.dealmachine_credit_state(id integer primary key,function_hashes jsonb,enabled boolean,available integer);
 insert into icash_research_private.dealmachine_credit_state values(1,jsonb_build_object('${signature}',md5(pg_get_functiondef('${signature}'::regprocedure)),'unrelated','unchanged'),true,90000);`);
 await q("insert into icash_research_private.owner_batches(id,account_id,created_at,primary_screening) values($1,$2,now()-interval '21 minutes',$3)",[batch,account,screening]);
 await q('insert into icash_research_private.owner_exports(id,request) values($1,$2)',[batch,{people_ids:['held-owner']}]);
 await q("insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at) values($1,'owner_lookup',$2,$3,true,now()-interval '21 minutes')",[batch,account,'owner-batch:'+batch]);
 await q("insert into public.icash_automation_tickets values($1,$2,$3,'contacts','consumed',now()-interval '22 minutes',now()-interval '20 minutes',null,null,1)",[ticket,account,screening]);
 await db.exec("insert into public.icash_operation_spend values('original','dispatched',105);update icash_research_private.export_capacity_automation set enabled=true,unknown_enabled=true,missing_finish_enabled=true");
 assert.equal(await rpc('icash_claim_automatic_export_capacity',release),null,'Reproduce: abandoned original blocks recovery forever');
 const migration=read('config/abandoned-export-handler-capacity.sql');
 // Guard failures must roll back the function and policy together.
 const beforeHash=await v('select md5(pg_get_functiondef($1::regprocedure))',[signature]);
 for(const drift of ["update icash_research_private.dealmachine_credit_state set function_hashes='{}'",`grant execute on function ${signature} to service_role`]){
  await db.exec('begin;'+drift);
  await assert.rejects(db.exec(migration),/predecessor changed/);await db.exec('rollback');
  assert.equal(await v('select md5(pg_get_functiondef($1::regprocedure))',[signature]),beforeHash);
 }
 const baseline=await original();
 await db.exec('begin;'+migration+'commit;');
 assert.deepEqual(await original(),baseline);
 assert.equal(await v("select function_hashes->>'unrelated' from icash_research_private.dealmachine_credit_state"),'unchanged');
 assert.equal(await v('select function_hashes->>$1=md5(pg_get_functiondef($1::regprocedure)) from icash_research_private.dealmachine_credit_state',[signature]),true);
 for(const change of [
  "update public.icash_automation_tickets set expires_at=now()-interval '14 minutes 59 seconds'",
  "update public.icash_automation_tickets set state='issued'",
  "update public.icash_automation_tickets set state='held'",
  "update public.icash_automation_tickets set outcome='manual_review'",
  "update public.icash_automation_tickets set completed_at=now()",
  'update public.icash_automation_tickets set issue_attempts=2',
  "update public.icash_automation_tickets set kind='discovery'",
  'update public.icash_automation_tickets set screening_id=null',
  'insert into public.icash_automation_tickets select gen_random_uuid(),account_id,screening_id,kind,state,created_at,expires_at,completed_at,outcome,issue_attempts from public.icash_automation_tickets',
  "update icash_research_private.requests set result='{}'",
  "update icash_research_private.requests set finished_at=now()",
  'update icash_research_private.requests set admitted=false',
  'update icash_research_private.requests set account_id=null',
  "update icash_research_private.requests set operation_key='wrong'",
  "update icash_research_private.requests set created_at=now()",
  "update icash_research_private.requests set created_at=created_at-interval '1 second'",
  'update icash_research_private.export_capacity_automation set missing_finish_enabled=false',
  'update icash_research_private.export_capacity_automation set unknown_enabled=false',
  'update icash_research_private.export_capacity_automation set enabled=false',
  "update icash_research_private.owner_batches set paid_receipt='{}'",
  "update icash_research_private.owner_exports set receipt='{}'",
  "update icash_research_private.owner_exports set recovery='{}'",
  "update icash_research_private.owner_exports set csv='late artifact'",
  "update icash_research_private.owner_exports set lease_until=now()+interval '1 minute'",
 ]){
  await db.exec('begin;'+change);assert.equal(await rpc('icash_claim_automatic_export_capacity',release),null,change);await db.exec('rollback');
 }
 for(const change of [
  "update public.icash_automation_tickets set state='held',outcome='held_for_reconciliation',completed_at=now()",
  "update icash_research_private.requests set result='{}' where kind='owner_lookup'",
  "update icash_research_private.owner_exports set receipt='{}'",
 ]){
  await db.exec('begin');const c=await rpc('icash_claim_automatic_export_capacity',release);assert(c);await probes(c);await db.exec(change);
  assert.equal(await rpc('icash_finish_automatic_export_capacity',c.reviewId),'capacity_review_held');
  assert.equal(await v('select capacity_review_id from icash_research_private.owner_exports'),null);await db.exec('rollback');
 }
 for(const mutate of [
  (r,p)=>{if(p==='pending')r.raw.pagination.total=1;},
  (r,p)=>{if(p==='processing')r.headers.date='Wed, 04 Nov 2020 00:00:00 GMT';},
  (r,p)=>{if(p==='inventory')r.raw.data[0].status='processing';},
 ]){
  await db.exec('begin');const c=await rpc('icash_claim_automatic_export_capacity',release);await probes(c,mutate);
  assert.equal(await rpc('icash_finish_automatic_export_capacity',c.reviewId),'capacity_review_held');assert.deepEqual(await original(),baseline);await db.exec('rollback');
 }
 // Old, explicitly held originals keep their existing five-minute path.
 await db.exec("begin;update public.icash_automation_tickets set state='held',outcome='held_for_reconciliation',completed_at=now()-interval '6 minutes'");
 assert(await rpc('icash_claim_automatic_export_capacity',release));await db.exec('rollback');
 const c=await rpc('icash_claim_automatic_export_capacity',release);assert(c);await probes(c);
 assert.equal(await v("select source_snapshot#>>'{handler,state}' from icash_research_private.owner_export_capacity_reviews"),'consumed');
 assert.equal(await rpc('icash_finish_automatic_export_capacity',c.reviewId),'capacity_verified');
 assert.equal(await rpc('icash_finish_automatic_export_capacity',c.reviewId),'capacity_verified');
 assert.equal(await rpc('icash_owner_active_export_capacity'),'ready');
 assert.equal(await rpc('icash_owner_export_people_available',['held-owner']),false);
 assert.deepEqual(await original(),baseline,'No original handler, provider evidence, owner fence or money is rewritten');
 for(const role of ['anon','authenticated','service_role'])assert.equal(await v('select has_function_privilege($1,$2,\'execute\')',[role,signature]),false);
 console.log('PASS abandoned owner export: reproduced stall; exact expired source, existing flags, three fresh probes, late evidence rejection, source and money preservation, migration guards, idempotency and private ACLs.');
}finally{await db.close();}
