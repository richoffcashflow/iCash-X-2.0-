// Fictional requests exercise the actual predecessor and correction. No provider calls.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {account,rate,release,read,baseSQL,poolSQL,selectedSQL,stageSQL,activateSQL,accountingSQL,json} from './helpers/reviewed-planning-relief-20261116-fixture.mjs';
const correction=read('config/reviewed-owner-preview-source-20261116.sql');
const migration=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(x=>x.endsWith('_reviewed_owner_preview_source_20261116.sql'));
assert.equal(migration.length,1);assert.equal(read('supabase/migrations/'+migration[0]),correction);
assert.equal(createHash('sha256').update(read('config/reviewed-planning-relief-20261116.sql')).digest('hex'),'3796f836f899bb71f8e9a09416a168b3e4fc3d477d3aa96c8ded539ae7694f93','original migration history stays unchanged');
const db=new PGlite();
const val=async sql=>Object.values((await db.query(sql)).rows[0]??{})[0];
const batch='20000000-0000-4000-8000-000000000001',preview='20000000-0000-4000-8000-000000000002',other='20000000-0000-4000-8000-000000000099';
const sourceSignature='icash_reliability_private.pending_work_relief_idle_source_20261116(public.icash_operation_spend)';
const lockSignature='icash_reliability_private.pending_work_relief_lock_source_20261116(public.icash_operation_spend)';
const get=()=>val(`select icash_reliability_private.pending_work_relief_idle_source_20261116(o) from public.icash_operation_spend o where operation_key='fixture-original'`);
const lock=()=>val(`select icash_reliability_private.pending_work_relief_lock_source_20261116(o) from public.icash_operation_spend o where operation_key='fixture-original'`);
const catalogSQL=`select jsonb_object_agg(p.oid::regprocedure::text,to_jsonb(p)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','icash_reliability_private')`;
async function temporary(sql,fn){await db.exec('begin');try{await db.exec(sql);await fn();}finally{await db.exec('rollback');}}
async function mutate(sql,fn=got=>assert.equal(got,null,sql)){await temporary(sql,async()=>fn(await get()));}
const previewInsert=(id=preview)=>`insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at,finished_at,result) values('${id}','owner_preview','${account}','owner-batch:${batch}',true,'2026-11-13T23:58Z','2026-11-13T23:59Z','{"outcome":"response","httpStatus":200,"creditsUsed":0}');`;
try{
 await db.exec(baseSQL()+read('tests/fixtures/reviewed-planning-relief-source-locks.sql'));
 await db.exec(`create index research_requests_operation_started on icash_research_private.requests(operation_key,created_at) where admitted;
 update public.icash_operation_rates set operation='owner_enrichment' where id='${rate}';
 update public.icash_accounts set workspace_ack_version='SYNTHETIC accepted workspace' where id='${account}';
 insert into public.icash_discovery_configs(account_id,enabled,auto_enabled,contacts_enabled,zip,rate_id,property_credit_micros,data_rights_until,seller_cost_reserve_cents)
 values('${account}',true,true,true,'90210','${rate}',10000,now()+interval '1 day',0);
 insert into icash_research_private.owner_batches(id,account_id,primary_screening,state,created_at,items,preview_receipt)
 values('${batch}','${account}','${batch}','claimed','2026-11-14T00:00Z','[]','{"credits":{"used":0}}');
 insert into icash_research_private.owner_batch_items(screening_id,batch_id,operation_key) values('${batch}','${batch}','fixture-original');
 insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at,finished_at,result)
 values('${batch}','owner_lookup','${account}','owner-batch:${batch}',true,'2026-11-14T00:00Z','2026-11-14T00:01Z','{"outcome":"http_error","httpStatus":400}');
 insert into icash_research_private.owner_exports(id,request,receipt,recovery_history,next_recover_at,recovery_attempts)
 values('${batch}','{}','{"httpStatus":400,"raw":{"error":{"code":"invalid_request"}}}','[]',now(),0);`);
 await db.exec('begin;'+read('config/reviewed-planning-relief-20261116.sql')+'commit;');
 assert.ok(await get(),'original no-preview legacy source is eligible');
 await db.exec(previewInsert());assert.equal(await get(),null,'reproduces actual normal-preview rejection before correction');
 const before=await val(catalogSQL),financial=await val(accountingSQL);
 for(const change of [
  'drop index icash_research_private.research_requests_operation_started;',
  `grant execute on function ${sourceSignature} to service_role;`,
  `create or replace function icash_reliability_private.pending_work_relief_lock_source_20261116(p_operation public.icash_operation_spend) returns void language plpgsql set search_path='' as $$begin null;end$$;`,
 ])await temporary(change,async()=>assert.rejects(db.exec(correction),/changed/));
 await assert.rejects(db.exec('begin;'+correction+"do $$begin raise exception 'SYNTHETIC ledger failure';end$$;commit;"),/SYNTHETIC ledger failure/);
 await db.exec('rollback');assert.deepEqual(await val(catalogSQL),before,'ledger failure rolls back both function replacements');
 await db.exec('begin;'+correction+'commit;');
 const after=await val(catalogSQL);
 assert.deepEqual(Object.keys(after).sort(),Object.keys(before).sort(),'no function added or removed');
 for(const [signature,row] of Object.entries(before)){
  if(['pending_work_relief_idle_source_20261116','pending_work_relief_lock_source_20261116'].includes(row.proname)){
   assert.notEqual(after[signature].prosrc,row.prosrc);
   assert.deepEqual({...after[signature],prosrc:null},{...row,prosrc:null},'all replaced function metadata/ACLs preserved');
  }else assert.deepEqual(after[signature],row,'unrelated function unchanged: '+signature);
 }
 assert.deepEqual(await val(accountingSQL),financial,'correction preserves all original financial rows, policies and controls');
 await assert.rejects(db.exec('begin;'+correction+'commit;'),/predecessor changed/);await db.exec('rollback');
 const source=await get();assert.equal(source.previewRequests.length,1);assert.equal(source.previewRequests[0].id,preview);await lock();
 await mutate(`delete from icash_research_private.requests where id='${preview}'`,v=>{assert.ok(v,'legacy zero remains eligible');assert.deepEqual(v.previewRequests,[]);assert.notDeepEqual(v,source,'removal changes frozen identity');});
 // Only the literal verified response/cost shape is accepted. No casts of
 // malformed result strings, unknown timestamps, late or duplicate work.
 for(const change of [
  `account_id='${other}'`,`account_id=null`,`kind='owner_lookup'`,`kind='photo'`,`kind=null`,
  'created_at=null','finished_at=null',"created_at='infinity'","finished_at='-infinity'",
  "created_at='2026-11-14T00:00Z'","finished_at='2026-11-13T23:57Z'","finished_at='2026-11-14T00:00Z'","finished_at='2026-11-14T00:01Z'",'finished_at=now()',
  `result='{"outcome":"unknown","httpStatus":200,"creditsUsed":0}'`,`result='{"outcome":"http_error","httpStatus":200,"creditsUsed":0}'`,
  `result='{"outcome":"response","httpStatus":500,"creditsUsed":0}'`,`result='{"outcome":"response","httpStatus":"200","creditsUsed":0}'`,
  `result='{"outcome":"response","httpStatus":200,"creditsUsed":1}'`,`result='{"outcome":"response","httpStatus":200,"creditsUsed":"0"}'`,
  `result='{"outcome":"response","httpStatus":200}'`,'result=null',
 ])await mutate(`update icash_research_private.requests set ${change} where id='${preview}'`);
 await mutate(previewInsert(other));
 await mutate(`update icash_research_private.requests set result=result||'{"returned":2}' where id='${preview}'`,v=>{assert.ok(v);assert.notDeepEqual(v,source,'full result retained in source fingerprint');});
 await mutate(`update icash_research_private.requests set operation_key='unrelated-key' where id='${preview}'`,v=>{assert.ok(v);assert.deepEqual(v.previewRequests,[]);assert.notDeepEqual(v,source,'key removal is distinguishable from frozen reviewed preview, not from pre-review legacy zero');});
 await mutate(`update icash_research_private.requests set admitted=false where id='${preview}'`,v=>{assert.ok(v);assert.notDeepEqual(v,source,'admission drift changes frozen identity');});
 await mutate(`update icash_research_private.requests set result='{"outcome":"unknown"}' where id='${batch}';update icash_research_private.owner_exports set receipt=null`,v=>assert.ok(v,'original unknown purchase remains unknown and can retain planning proof'));
 await mutate(`insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at,finished_at,result) values('${other}','owner_lookup','${account}','owner-batch:${batch}',true,'2026-11-13T23:57Z','2026-11-13T23:58Z','{"outcome":"unknown"}')`);

 // Test only: replace the fixed-pool scalar after installing the exact pinned
 // correction. Actual source/control/stage/activation bodies stay untouched.
 const pool=await val(poolSQL),digest=createHash('sha256').update(pool.map(x=>`${x.operation_key}\t${x.account_id}\t${x.source_sha256}`).sort().join('\n')).digest('hex');
 await db.exec(`create or replace function icash_reliability_private.relief_pool_sha_20261116() returns text language sql immutable set search_path='' as $$select '${digest}'::text$$;`);
 const selected=await val(selectedSQL);
 for(const change of [`operation_key='unrelated-key'`,`admitted=false`,`id='${other}'`,`result=result||'{"returned":2}'`])await temporary(`update icash_research_private.requests set ${change} where id='${preview}'`,async()=>{
  await assert.rejects(val(stageSQL(pool,selected)),/source|eligible|review/i,'frozen review rejects preview identity drift');
 });
 const stage=await val(stageSQL(pool,selected));assert.equal(stage.enabled,false);
 await temporary('',async()=>assert.rejects(db.exec(correction),/empty inactive lifecycle/));
 for(const change of [`delete from icash_research_private.requests where id='${preview}'`,`update icash_research_private.requests set result=result||'{"returned":2}' where id='${preview}'`,previewInsert(other)])await temporary(change,async()=>{
  const activated=await val(activateSQL(stage.manifestSha256));assert.equal(activated.eligibleOperations,0);assert.equal(activated.excludedOperations,1);
  assert.equal(await val(`select reason from icash_reliability_private.pending_work_relief_activation_20261116`),'source_changed');
 });
 const active=await val(activateSQL(stage.manifestSha256));assert.equal(active.eligibleOperations,1);assert.equal(active.excludedOperations,0);
 assert.deepEqual(await val(accountingSQL),financial,'stage/activation preserve original unknown money and all financial/control rows');
 for(const role of ['anon','authenticated','service_role'])for(const signature of [sourceSignature,lockSignature])assert.equal(await val(`select has_function_privilege('${role}','${signature}','EXECUTE')`),false,'private source helper is operator-only');
 console.log('owner preview source correction: normal preview reproduced/fixed; exact predecessors, empty lifecycle, source drift, activation exclusions and financial/ACL preservation passed');
}finally{await db.close();}
