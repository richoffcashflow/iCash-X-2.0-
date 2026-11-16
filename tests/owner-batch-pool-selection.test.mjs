import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {installOwnerPoolFixture,seedMixedPool,seedHandlerOriginal,candidates,sourceCatalog,policy,history,value,read,migration,signature} from './helpers/owner-batch-pool-fixture.mjs';
const pg=new PGlite(),v=(sql,args=[])=>value(pg,sql,args);
try{
 assert.equal(migration,read('supabase/migrations/20261116194633_owner_batch_pool_selection.sql'));
 await installOwnerPoolFixture(pg);
 const active=await seedMixedPool(pg,61001),mobile=await seedMixedPool(pg,61002,{mobile:true});
 const live=await v('select public.fixture_preflight_seed(61003,true)');
 const continued=await seedHandlerOriginal(pg,61004,{size:3,competitors:true});
 const beforeLive=await candidates(pg,live),beforeContinued=await candidates(pg,continued);
 assert.equal(beforeLive.length,1);assert.equal(beforeContinued.length,3);
 const originals=new Map();
 for(const c of [active,mobile]){
  const result=await candidates(pg,c);originals.set(c.account,result);
  assert.equal(result.length,5);
  const pools=await v('select public.icash_owner_targeting_pools($1,$2)',[c.account,result.map(x=>x.screeningId)]);
  assert.equal(result.filter(x=>pools[x.screeningId]===pools[c.screening]).length,1,'Reproduce one useful item after the old five-item limit');
 }
 const beforeCatalog=await sourceCatalog(pg),beforePolicy=await policy(pg),beforeHistory=await history(pg);
 await pg.exec('begin;'+migration);
 await assert.rejects(pg.exec('select 1/0 as migration_ledger_failure'),/division by zero/);
 await pg.exec('rollback');
 assert.deepEqual(await sourceCatalog(pg),beforeCatalog);assert.deepEqual(await policy(pg),beforePolicy);assert.deepEqual(await history(pg),beforeHistory);
 for(const mutation of [
  'grant execute on function public.icash_owner_batch_candidates(uuid,uuid) to public',
  'grant execute on function public.icash_owner_batch_candidates(uuid,uuid) to service_role with grant option',
  'alter function public.icash_owner_batch_candidates(uuid,uuid) security invoker',
  'alter function public.icash_owner_batch_candidates(uuid,uuid) volatile',
  'alter function public.icash_owner_targeting_pool(uuid,uuid) volatile',
  "update icash_work_private.continuation_policy set continued_cohort_hashes=continued_cohort_hashes-'public.icash_owner_batch_candidates(uuid,uuid)'",
  "update icash_work_private.continuation_policy set continued_cohort_hashes=continued_cohort_hashes||'{\"extra\":\"wrong\"}'",
  'alter function icash_work_private.continued_owner_batch_cohort(uuid,uuid) volatile',
  'update icash_work_private.continuation_policy set enabled=false',
  'delete from public.icash_operating_budget where id=1',
 ]){
  await pg.exec('begin;'+mutation);
  await assert.rejects(pg.exec(migration),/Owner pool/,mutation);await pg.exec('rollback');
  assert.deepEqual(await sourceCatalog(pg),beforeCatalog);assert.deepEqual(await policy(pg),beforePolicy);assert.deepEqual(await history(pg),beforeHistory);
 }
 await pg.exec('begin;'+migration+'commit;');
 const afterCatalog=await sourceCatalog(pg),afterPolicy=await policy(pg);
 assert.deepEqual(Object.keys(afterCatalog),Object.keys(beforeCatalog));
 for(const [key,before] of Object.entries(beforeCatalog))if(!key.includes('icash_owner_batch_candidates('))assert.deepEqual(afterCatalog[key],before,'Unchanged final/source guard: '+key);
 assert.deepEqual({...afterPolicy,continued_cohort_hashes:beforePolicy.continued_cohort_hashes},beforePolicy);
 assert.deepEqual({...afterPolicy.continued_cohort_hashes,[signature]:beforePolicy.continued_cohort_hashes[signature]},beforePolicy.continued_cohort_hashes);
 assert.equal(afterPolicy.continued_cohort_hashes[signature],await v('select md5(pg_get_functiondef($1::regprocedure))',[signature]));
 assert.deepEqual(await history(pg),beforeHistory);
 for(const c of [active,mobile]){
  const result=await candidates(pg,c);
  assert.deepEqual(result.map(x=>x.screeningId),[c.screening,...c.matching.slice(0,4)]);
  const pools=await v('select public.icash_owner_targeting_pools($1,$2)',[c.account,result.map(x=>x.screeningId)]);
  assert(result.every(x=>pools[x.screeningId]===pools[c.screening]));
 }
 assert.deepEqual(await candidates(pg,live),beforeLive,'Keep the exact live source');
 assert.deepEqual(await candidates(pg,continued),beforeContinued,'Keep the original continued order, not UUID order');
 await pg.exec('begin');await pg.query('update public.icash_wallets set balance_cents=210 where account_id=$1',[continued.account]);
 assert.deepEqual(await candidates(pg,continued),[],'An unaffordable original cohort cannot be trimmed or backfilled');
 await pg.exec('rollback');
 await pg.exec('begin;update icash_research_private.owner_export_settings set enabled=false');
 for(const c of [active,mobile])assert.deepEqual(await candidates(pg,c),originals.get(c.account),'Legacy non-export selection stays unchanged');
 await pg.exec('rollback');
 for(const [label,sql,args,expected] of [
  ['wallet/floor cap','update public.icash_wallets set balance_cents=210 where account_id=$1',[active.account],[active.screening,active.matching[0]]],
  ['reserved funds','update public.icash_wallets set reserved_cents=balance_cents where account_id=$1',[active.account],[]],
  ['outreach reserve','update public.fixture_cleanup_policy set outreach_floor=9900',[],[]],
  ['disabled research','update public.icash_discovery_configs set enabled=false where account_id=$1',[active.account],[]],
  ['disabled contacts','update public.icash_discovery_configs set contacts_enabled=false where account_id=$1',[active.account],[]],
  ['expired rate',"update public.icash_operation_rates set expires_at=now()-interval '1 second' where id=$1",[active.rate],[]],
  ['manual primary',"insert into public.icash_property_controls(account_id,property_id,manual) select account_id,snapshot->>'propertyId',true from public.icash_screening_jobs where id=$1",[active.screening],[]],
  ['stale primary',"update public.icash_screening_jobs set completed_at=now()-interval '25 hours' where id=$1",[active.screening],[]],
  ['financial hold',"update public.icash_screening_jobs set result='{\"financialCheck\":{\"status\":\"held\"}}' where id=$1",[active.screening],[]],
  ['ticketed sibling',"insert into public.icash_automation_tickets(account_id,kind,screening_id) values($1,'contacts',$2)",[active.account,active.matching[0]],[active.screening,...active.matching.slice(1,5)]],
  ['stale sibling',"update public.icash_screening_jobs set completed_at=now()-interval '25 hours' where id=$1",[active.matching[0]],[active.screening,...active.matching.slice(1,5)]],
 ]){
  await pg.exec('begin');await pg.query(sql,args);
  assert.deepEqual((await candidates(pg,active)).map(x=>x.screeningId),expected,label);
  await pg.exec('rollback');
 }
 assert.deepEqual(await candidates(pg,{account:active.account,screening:mobile.screening}),[],'A different account cannot supply the primary');
 await pg.exec('begin');await assert.rejects(pg.exec(migration),/Owner pool candidate prerequisite changed/);await pg.exec('rollback');
 assert.deepEqual(await history(pg),beforeHistory,'Selection never purchases, reserves, rewrites originals or changes quota');
 console.log('PASS owner pool selection: reproduced 1-of-5 mixed batches, full compatible active/mobile groups, original live/continued sources, budgets/controls, exact source/ACL/manifest guards and transactional rollback.');
}catch(error){console.error(error.stack,error.where??'');process.exitCode=1;}finally{await pg.close();}
