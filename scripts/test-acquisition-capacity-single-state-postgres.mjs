// Actual quota functions and concurrent transactions on the isolated fixture.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {installSingleStateFixture,migration,migrationPath,read,value,definition,policy,evidence,
 instrumentReserveReads,countReserveReads} from '../tests/helpers/acquisition-capacity-single-state-fixture.mjs';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg'),clients=[];
const connect=async name=>{
 const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',application_name:'capacity-single-state-'+name,connectionTimeoutMillis:5000});
 clients.push(c);await c.connect();await assertDisposablePostgresTarget(c);
 c.exec=s=>c.query(s);await c.query("set statement_timeout='8s';set lock_timeout='2s';set timezone='UTC'");return c;
};
try{
 const admin=await connect('admin'),holder=await connect('holder'),reader=await connect('reader');
 await admin.query('drop schema if exists icash_research_private cascade;drop schema public cascade;create schema public');
 await installSingleStateFixture(admin);assert.equal(migration,read(migrationPath));
 const beforeDefinition=await definition(admin),beforePolicy=await policy(admin),beforeEvidence=await evidence(admin);
 for(const hold of [
  'select pg_advisory_xact_lock(726341927)',
  'select 1 from public.icash_operating_budget where id=1 for update',
  'select 1 from icash_research_private.acquisition_headroom_policy where id=1 for update',
 ]){
  await holder.query('begin');await holder.query(hold);
  await admin.query('begin');await assert.rejects(admin.query(migration),error=>error.code==='55P03'||/Acquisition single-state scheduler busy/.test(error.message));
  await admin.query('rollback');await holder.query('rollback');
  assert.equal(await definition(admin),beforeDefinition);assert.deepEqual(await policy(admin),beforePolicy);
 }
 await admin.query('begin');await admin.query(migration);
 await assert.rejects(admin.query('select 1/0 as synthetic_migration_ledger_failure'),/division by zero/);
 await admin.query('rollback');assert.equal(await definition(admin),beforeDefinition);assert.deepEqual(await policy(admin),beforePolicy);
 await admin.query('begin;'+migration+'commit;');
 const afterHash=await value(admin,"select md5(pg_get_functiondef('public.icash_acquisition_capacity_available(uuid)'::regprocedure))");
 assert.equal(afterHash,'c8549a105f353bc11b0dcb904bbd8e71');
 assert.deepEqual(await policy(admin),{...beforePolicy,capacity_hash:afterHash});assert.deepEqual(await evidence(admin),beforeEvidence);
 await admin.query('update public.icash_dealmachine_request_budget set day_used=4000');
 const restore=await instrumentReserveReads(admin);
 assert.equal(await countReserveReads(admin,'fixture_capacity_before'),200);
 assert.equal(await countReserveReads(admin,'icash_acquisition_capacity_available'),100);
 await restore();
 const old=await value(admin,"select public.fixture_reserve_seed(820001,interval '3 days')");
 const fresh=await value(admin,"select public.fixture_reserve_seed(820002,interval '1 hour')");
 await reader.query('set role service_role');
 // There is no session/transaction cache. A committed quota or policy change
 // is seen on the next statement, including inside the same transaction.
 await reader.query('begin');assert.equal(await value(reader,'select public.icash_acquisition_capacity_available($1)',[old]),true);
 await holder.query('begin');await holder.query('update public.icash_dealmachine_request_budget set day_used=9800');
 assert.equal(await value(reader,'select public.icash_acquisition_capacity_available($1)',[old]),true,'Uncommitted counter updates stay invisible as before');
 await holder.query('commit');assert.equal(await value(reader,'select public.icash_acquisition_capacity_available($1)',[old]),false,'Fresh statement sees committed exhausted quota');
 await holder.query('update public.icash_dealmachine_request_budget set day_used=4669');
 assert.equal(await value(reader,'select public.icash_acquisition_capacity_available($1)',[old]),false);
 assert.equal(await value(reader,'select public.icash_acquisition_capacity_available($1)',[fresh]),true);
 await holder.query('update public.icash_accounts set bot_paused=true where id=$1',[fresh]);
 assert.equal(await value(reader,'select public.icash_acquisition_capacity_available($1)',[fresh]),false,'Committed Pause still removes protected starter allowance');
 await holder.query('update icash_research_private.acquisition_headroom_policy set enabled=false');
 assert.equal(await value(reader,'select public.icash_acquisition_capacity_available($1)',[old]),true,'Disabled headroom immediately retains original two-request capacity');
 await reader.query('rollback');
 // Availability remains non-authoritative: another request can consume the
 // last token before the caller reaches the unchanged final atomic limiter.
 await admin.query(`update icash_research_private.request_reserve_policy set enabled=false;
  update icash_research_private.request_pacing_policy set enabled=false;
  update public.icash_dealmachine_request_budget set day_used=9798,minute_start=now(),minute_used=58;`);
 assert.equal(await value(reader,'select public.icash_acquisition_capacity_available($1)',[old]),true);
 assert.equal(await value(holder,'select public.icash_take_dealmachine_request()'),true);
 assert.equal(await value(holder,'select public.icash_take_dealmachine_request()'),true);
 assert.equal(await value(reader,'select public.icash_take_dealmachine_request()'),false,'Existing final admission honors the later consumed quota');
 assert.equal(await value(admin,'select day_used from public.icash_dealmachine_request_budget'),9800);
 const beforeRead=await evidence(admin);assert.equal(await value(reader,'select public.icash_acquisition_capacity_available($1)',[old]),false);assert.deepEqual(await evidence(admin),beforeRead);
 console.log(JSON.stringify({result:'PASS native acquisition single-state',postgres:await value(admin,'show server_version'),afterHash,originalStateReads:200,newStateReads:100,failedInstallRollback:true,freshStatementQuota:true,freshPause:true,finalAdmissionUnchanged:true}));
}catch(e){console.error(e.stack,e.where??'');process.exitCode=1;}finally{
 await Promise.allSettled(clients.map(c=>c.query('rollback')));await Promise.allSettled(clients.map(c=>c.end()));
}
