// Actual quota functions and concurrent transactions on the isolated fixture.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
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
async function waitForAdvisory(db,pid){
 for(let n=0;n<100;n++){
  const row=(await db.query('select wait_event_type,wait_event from pg_stat_activity where pid=$1',[pid])).rows[0];
  if(row?.wait_event_type==='Lock'&&row.wait_event==='advisory')return row;
  await new Promise(resolve=>setTimeout(resolve,5));
 }
 assert.fail('Expected a bounded advisory-lock waiter');
}
try{
 const admin=await connect('admin'),holder=await connect('holder'),reader=await connect('reader'),gate=await connect('gate');
 // Start more permissively so the test proves the migration's own SET LOCAL
 // bounds, rather than inheriting the connection helper's fixture defaults.
 await admin.query("set lock_timeout='12s';set statement_timeout='20s'");
 await admin.query('drop schema if exists icash_research_private cascade;drop schema public cascade;create schema public');
 await installSingleStateFixture(admin);assert.equal(migration,read(migrationPath));
 const beforeDefinition=await definition(admin),beforePolicy=await policy(admin),beforeEvidence=await evidence(admin);
 const adminPid=await value(admin,'select pg_backend_pid()');
 // Sustained contention is bounded by the existing two-second lock timeout.
 // Waiting cannot take the operating-budget row or publish a partial change.
 await holder.query('begin');await holder.query('select pg_advisory_xact_lock(726341927)');
 await admin.query('begin');const timeoutStarted=performance.now();
 const timeoutResult=admin.query(migration).then(()=>({unexpected:true}),error=>({error}));
 await waitForAdvisory(reader,adminPid);
 await reader.query('begin');assert.equal(await value(reader,'select id from public.icash_operating_budget where id=1 for update nowait'),1);
 await reader.query('rollback');assert.equal(await definition(reader),beforeDefinition);assert.deepEqual(await policy(reader),beforePolicy);
 const timedOut=await timeoutResult,timeoutMs=performance.now()-timeoutStarted;
 assert.equal(timedOut.error?.code,'55P03');assert(timeoutMs>=1500&&timeoutMs<7000,'Lock timeout remains two seconds, within the eight-second statement bound');
 await admin.query('rollback');await holder.query('rollback');
 assert.equal(await value(admin,"select current_setting('lock_timeout')"),'12s');
 assert.equal(await value(admin,"select current_setting('statement_timeout')"),'20s');
 assert.equal(await definition(admin),beforeDefinition);assert.deepEqual(await policy(admin),beforePolicy);assert.deepEqual(await evidence(admin),beforeEvidence);
 for(const hold of [
  'select 1 from public.icash_operating_budget where id=1 for update',
  'select 1 from icash_research_private.acquisition_headroom_policy where id=1 for update',
 ]){
  await holder.query('begin');await holder.query(hold);
  await admin.query('begin');await assert.rejects(admin.query(migration),error=>error.code==='55P03');
  await admin.query('rollback');await holder.query('rollback');
  assert.equal(await definition(admin),beforeDefinition);assert.deepEqual(await policy(admin),beforePolicy);
 }
 // The real lane entry acquires the same transaction lock. Only its general
 // work body is replaced with a synthetic pause; no provider is contacted.
 await admin.query(`create schema if not exists icash_work_private;
  create table if not exists icash_work_private.dispatch_policy(id integer primary key,enabled boolean);
  insert into icash_work_private.dispatch_policy(id,enabled) values(1,true) on conflict(id) do update set enabled=true;
  create or replace function public.icash_next_automation() returns jsonb language plpgsql set search_path='' as $$begin
   perform pg_advisory_xact_lock(684203115);return null;end$$;`);
 await admin.query(read('tests/fixtures/automation-lane-current.sql'));
 assert.equal(await value(admin,"select md5(pg_get_functiondef('public.icash_next_automation_lane(text)'::regprocedure))"),'3463e54ab56e8a7732a3af2febf9dc88');
 await admin.query('revoke all on function public.icash_next_automation_lane(text) from public,anon,authenticated;grant execute on function public.icash_next_automation_lane(text) to service_role');
 const migrationHash=createHash('sha256').update(migration).digest('hex');
 await admin.query(`create table public.fixture_migration_ledger(version text primary key,sql_hash text not null check(sql_hash='${migrationHash}'))`);
 await holder.query("set role service_role;set lock_timeout='8s'");
 const holderPid=await value(holder,'select pg_backend_pid()');
 const pendingInstall=async()=>{
  await gate.query('begin');await gate.query('select pg_advisory_xact_lock(684203115)');
  const ordinary=holder.query("select public.icash_next_automation_lane('general')");
  await waitForAdvisory(reader,holderPid);
  await admin.query('begin');const installed=admin.query(migration);await waitForAdvisory(reader,adminPid);
  assert.equal(await definition(reader),beforeDefinition);assert.deepEqual(await policy(reader),beforePolicy);
  await gate.query('commit');await ordinary;await installed;
  assert.equal(await value(admin,"select current_setting('lock_timeout')"),'2s');
  assert.equal(await value(admin,"select current_setting('statement_timeout')"),'8s');
  assert.equal(await value(admin,"select md5(pg_get_functiondef('public.icash_acquisition_capacity_available(uuid)'::regprocedure))"),'c8549a105f353bc11b0dcb904bbd8e71');
  assert.equal(await value(reader,'select pg_try_advisory_xact_lock(726341927)'),false,'Migration retains scheduler authority until its runner commits');
 };
 await pendingInstall();
 await assert.rejects(admin.query("insert into public.fixture_migration_ledger values('20261117180236','wrong-ledger-content')"),error=>error.code==='23514');
 await admin.query('rollback');assert.equal(await definition(admin),beforeDefinition);assert.deepEqual(await policy(admin),beforePolicy);
 assert.equal(await value(admin,'select count(*)::int from public.fixture_migration_ledger'),0,'Failed ledger insertion rolls back the complete waited installation');
 await pendingInstall();await admin.query('insert into public.fixture_migration_ledger values($1,$2)',['20261117180236',migrationHash]);await admin.query('commit');
 assert.equal(await value(admin,'select count(*)::int from public.fixture_migration_ledger'),1);
 assert.equal(await value(reader,'select pg_try_advisory_xact_lock(726341927)'),true,'Commit releases the migration lock for the next ordinary poll');
 await holder.query('reset role');
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
 console.log(JSON.stringify({result:'PASS native acquisition single-state',postgres:await value(admin,'show server_version'),afterHash,originalStateReads:200,newStateReads:100,boundedSchedulerWaitMs:Math.round(timeoutMs),shortActualLaneWaitInstalled:true,noBudgetLockWhileWaiting:true,waitedLedgerRollback:true,failedInstallRollback:true,freshStatementQuota:true,freshPause:true,finalAdmissionUnchanged:true}));
}catch(e){console.error(e.stack,e.where??'');process.exitCode=1;}finally{
 await Promise.allSettled(clients.map(c=>c.query('rollback')));await Promise.allSettled(clients.map(c=>c.end()));
}
