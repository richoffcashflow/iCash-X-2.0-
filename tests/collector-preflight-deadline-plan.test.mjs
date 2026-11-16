import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {installCollectorDeadlineFixture,value,catalog,policy,history,deadlines,migration,original,marker,replacement,signature,read,edgeCases,positiveEdges} from './helpers/collector-deadline-fixture.mjs';
const pg=new PGlite(),v=(s,a=[])=>value(pg,s,a);
async function isolated(fn){await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}}
try{
 await installCollectorDeadlineFixture(pg);
 assert.equal(await v(`select md5(pg_get_functiondef('${signature}'::regprocedure))`),'136f9850a750ce7883f5e0514ff6e027');
 const beforeCatalog=await catalog(pg),beforePolicy=await policy(pg),beforeHistory=await history(pg);
 const indexExists=()=>v("select to_regclass('icash_research_private.icash_owner_preflight_primary_screening') is not null");
 const originalCheck=async()=>{assert.deepEqual(await catalog(pg),beforeCatalog);assert.deepEqual(await policy(pg),beforePolicy);assert.equal(await indexExists(),false);};
 await pg.exec('begin;'+migration);
 await assert.rejects(pg.exec('select 1/0 as migration_history_failure'),/division by zero/);await pg.exec('rollback');await originalCheck();
 for(const mutation of [
  `grant execute on function ${signature} to public`,
  `grant execute on function ${signature} to service_role with grant option`,
  `revoke execute on function ${signature} from service_role`,
  `alter function ${signature} security invoker`,`alter function ${signature} volatile`,
  `alter function ${signature} set search_path=public`,
  `alter function ${signature} owner to service_role`,
  `create role fixture_other;grant execute on function ${signature} to fixture_other`,
  `update icash_work_private.continuation_policy set enabled=false`,
  `update icash_work_private.continuation_policy set activated_at=null`,
  `update icash_work_private.continuation_policy set release_sha='invalid'`,
  `update icash_work_private.continuation_policy set continued_original_hashes=continued_original_hashes-'${signature}'`,
  `update icash_work_private.continuation_policy set continued_original_hashes=jsonb_set(continued_original_hashes,array['${signature}'],to_jsonb(repeat('0',32)))`,
  `update icash_work_private.continuation_policy set continued_original_hashes=continued_original_hashes||'{"unexpected":"drift"}'`,
  `alter function public.icash_enrichment_before_prospecting_budget(uuid) volatile`,
  `delete from public.icash_operating_budget`,
  `create index icash_owner_preflight_primary_screening on icash_research_private.owner_export_preflights(id)`,
 ]){
  await isolated(async()=>{await pg.exec(mutation);await assert.rejects(pg.exec(migration),/changed|already exists/);});await originalCheck();
 }
 await isolated(async()=>{
  await pg.exec(`create function public.fixture_policy_drift() returns trigger language plpgsql as $$begin new.issued:=new.issued+1;return new;end$$;
   create trigger fixture_policy_drift before update on icash_work_private.continuation_policy for each row execute function public.fixture_policy_drift();`);
  await assert.rejects(pg.exec(migration),/non-target policy changed/);
 });await originalCheck();
 await isolated(async()=>{
  await pg.exec(`create function public.fixture_target_hash_drift() returns trigger language plpgsql as $$begin
   new.continued_original_hashes:=jsonb_set(new.continued_original_hashes,array['${signature}'],to_jsonb('corrupted-target-only'::text));return new;end$$;
   create trigger fixture_target_hash_drift before update on icash_work_private.continuation_policy for each row execute function public.fixture_target_hash_drift();`);
  await assert.rejects(pg.exec(migration),/target policy hash changed/);
 });await originalCheck();
 await isolated(async()=>{await assert.rejects(pg.exec(migration.replace('create index icash_owner_preflight_primary_screening','create unique index icash_owner_preflight_primary_screening')),/index shape changed/);});await originalCheck();
 for(const [name,change] of edgeCases)await isolated(async()=>{
  await pg.exec(change);const old=await deadlines(pg),saved=await history(pg);
  await pg.exec(migration);const next=await deadlines(pg);
  assert.deepEqual(next,old,name);assert.equal(next.find(x=>x.n===1).deadline!==null,positiveEdges.has(name),name);
  assert.deepEqual(await history(pg),saved,name+' evidence unchanged');
 });
 await isolated(async()=>{
  await pg.exec(`update icash_research_private.owner_export_preflights p set state=case when n%2=0 then 'waiting' else 'ready' end,created_at=now()-interval '2 minutes',checked_at=now()-n*interval '1 second',next_check_at=now()-interval '1 second' from generate_series(1,100)n where p.id=public.fid(n)`);
  const old=await deadlines(pg);await pg.exec(migration);const next=await deadlines(pg);assert.deepEqual(next,old);assert.equal(next.filter(x=>x.n>0&&x.deadline!==null).length,100);
 });
 await pg.exec('begin;'+migration+'commit;');
 const afterCatalog=await catalog(pg);assert.deepEqual({...afterCatalog,definition:beforeCatalog.definition},beforeCatalog);
 assert.equal(afterCatalog.definition,original.replace(marker,replacement));
 const afterPolicy=await policy(pg);const expectedPolicy=structuredClone(beforePolicy);
 expectedPolicy.continued_original_hashes[signature]=await v(`select md5(pg_get_functiondef('${signature}'::regprocedure))`);
 assert.deepEqual(afterPolicy,expectedPolicy);assert.deepEqual(await history(pg),beforeHistory);assert.equal(await indexExists(),true);
 await pg.exec('set role service_role');assert.ok(await v('select icash_work_private.live_owner_preflight_deadline(public.fid(100000),public.fid(1))'));await pg.exec('reset role');
 await isolated(async()=>{await assert.rejects(pg.exec(migration),/source or privileges changed/);});
 assert.deepEqual(await policy(pg),afterPolicy);assert.deepEqual(await catalog(pg),afterCatalog);
 const files=readdirSync(new URL('../supabase/migrations',import.meta.url)).filter(f=>f.endsWith('_collector_preflight_deadline_plan.sql'));
 assert.equal(files.length,1,'CLI-generated migration required');assert.equal(read('supabase/migrations/'+files[0]),migration);
 console.log(`PASS collector deadline plan: ${edgeCases.length} source/NULL/expiry edges,100 positives, exact source/ACL/manifest/index guards, failed-history/replay/drift rollback and one-slot policy update. Synthetic helpers; not collector/full-schema/concurrency proof.`);
}finally{await pg.close();}
