import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {setupSql,migration,read} from './helpers/owner-preflight-cleanup-fixture.mjs';
const pg=new PGlite(),q=(sql,args=[])=>pg.query(sql,args),v=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0]??{})[0];
const activate=sha=>v('select icash_research_private.activate_owner_preflight_cleanup($1)',[sha]);
const policy=()=>v('select to_jsonb(p) from icash_research_private.owner_preflight_cleanup_policy p where id=1');
const sha='a'.repeat(40);
const rollback=async fn=>{await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}};
try{
 await pg.exec(setupSql);
 assert.equal(migration,read('supabase/migrations/20261114212434_owner_preflight_cleanup_handoff.sql'));
 assert(!/^\s*(begin|commit);\s*$/mi.test(migration),'Only the supported migration runner owns transaction control');
 assert(migration.includes("notify pgrst, 'reload schema';"));
 const baseline=await v("select md5(pg_get_functiondef('public.icash_claim_owner_preflight(uuid,jsonb,jsonb)'::regprocedure))");
 // Simulate a ledger-write failure after all migration SQL. SQL and ledger
 // must roll back together; no partially installed policy or patched claim.
 await pg.exec('create table fixture_migration_ledger(version text primary key);insert into fixture_migration_ledger values(\'duplicate\')');
 await assert.rejects(pg.exec('begin;'+migration+"insert into fixture_migration_ledger values('duplicate');commit;"),/duplicate key/);
 await pg.exec('rollback');
 assert.equal(await v("select to_regclass('icash_research_private.owner_preflight_cleanup_policy')"),null);
 assert.equal(await v("select to_regprocedure('public.icash_admit_owner_preflight_cleanup(uuid,uuid,uuid)')"),null);
 assert.equal(await v("select md5(pg_get_functiondef('public.icash_claim_owner_preflight(uuid,jsonb,jsonb)'::regprocedure))"),baseline);
 await pg.exec('begin;'+migration+"insert into fixture_migration_ledger values('cleanup');commit;");
 const installed=await policy(),signatures=Object.keys(installed.function_hashes);
 assert.equal(signatures.length,19);assert.equal(Object.keys(installed.trigger_hashes).length,3);
 assert.equal(installed.enabled,false);assert.equal(installed.release_sha,null);assert.equal(installed.activated_at,null);
 for(const invalid of [null,'','a'.repeat(39),'a'.repeat(41),'G'.repeat(40),sha+'\n']){
  assert.equal(await activate(invalid),false);assert.deepEqual(await policy(),installed);
 }
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(await v("select has_function_privilege($1,'icash_research_private.activate_owner_preflight_cleanup(text)','execute')",[role]),false);
  assert.equal(await v("select has_table_privilege($1,'icash_research_private.owner_preflight_cleanup_policy','update')",[role]),false);
 }
 assert.equal(await v("select prosecdef from pg_proc where oid='icash_research_private.activate_owner_preflight_cleanup(text)'::regprocedure"),false,'Administrative activation cannot borrow definer privileges');
 await rollback(async()=>{await pg.exec('set local role service_role');await assert.rejects(activate(sha),/permission denied/);});
 // Every required function, including original evidence/renewal/source gates,
 // is checked after installation. A security attribute change also drifts hash.
 for(const signature of signatures)await rollback(async()=>{
  await pg.exec(`alter function ${signature} set statement_timeout='250ms'`);
  assert.equal(await activate(sha),false,signature);assert.deepEqual(await policy(),installed);
 });
 for(const changed of [{},Object.fromEntries(signatures.slice(1).map(s=>[s,installed.function_hashes[s]])),{...installed.function_hashes,[signatures[0]]:null},{...installed.function_hashes,[signatures[0]]:'wrong'},Object.fromEntries(signatures.map((s,i)=>[i===0?'public.unknown_fixture()':s,installed.function_hashes[s]]))])await rollback(async()=>{
  await q('update icash_research_private.owner_preflight_cleanup_policy set function_hashes=$1',[JSON.stringify(changed)]);
  const before=await policy();assert.equal(await activate(sha),false);assert.deepEqual(await policy(),before);
 });
 for(const name of Object.keys(installed.trigger_hashes))await rollback(async()=>{
  const table=name==='owner_preflight_cleanup_admission_immutable'?'owner_preflight_cleanup_admissions':'owner_export_preflights';
  await pg.exec(`alter table icash_research_private.${table} disable trigger ${name}`);
  assert.equal(await activate(sha),false);assert.deepEqual(await policy(),installed);
 });
 await rollback(async()=>{await pg.exec('update icash_operating_budget set enabled=false where id=1');assert.equal(await activate(sha),false);assert.deepEqual(await policy(),installed);});
 await rollback(async()=>{await pg.exec('delete from icash_operating_budget where id=1');assert.equal(await activate(sha),false);assert.deepEqual(await policy(),installed);});
 await rollback(async()=>{await pg.exec('delete from icash_research_private.owner_preflight_cleanup_policy where id=1');assert.equal(await activate(sha),false);});
 await rollback(async()=>{assert.equal(await activate(sha),true);await assert.rejects(pg.exec('select 1/0'),/division by zero/);});
 assert.deepEqual(await policy(),installed,'A later transaction failure rolls activation back atomically');
 assert.equal(await activate(sha),true);const activated=await policy();assert.equal(activated.enabled,true);assert.equal(activated.release_sha,sha);assert(activated.activated_at);
 assert.equal(await activate(sha),false);assert.equal(await activate('b'.repeat(40)),false);assert.deepEqual(await policy(),activated,'Activation is one-time even for identical SHA');
 await pg.exec('update icash_research_private.owner_preflight_cleanup_policy set enabled=false where id=1');const disabled=await policy();
 assert.equal(await activate(sha),false);assert.deepEqual(await policy(),disabled,'A prior release cannot reactivate after rollback');
 console.log('PASS private cleanup activation: all 19 function hashes, required manifests/triggers, full SHA, application ACLs, one-time release, disabled/missing budget and atomic migration/ledger/activation failures.');
}catch(e){console.error(e.message,e.where??'');process.exitCode=1;}finally{await pg.close();}
