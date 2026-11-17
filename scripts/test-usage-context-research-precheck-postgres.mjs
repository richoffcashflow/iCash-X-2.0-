// Captured report/selector/score SQL with local synthetic source and lock probes.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {installUsageResearchFixture,migration,migrationPath,read,value,definition,evidence,account,user,rate,
 context,seedResearch,instrumentScoring,resetScoring,scoringCalls} from '../tests/helpers/usage-context-research-precheck-fixture.mjs';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg'),clients=[];
const connect=async name=>{
 const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',application_name:'usage-research-precheck-'+name,connectionTimeoutMillis:5000});
 clients.push(c);await c.connect();await assertDisposablePostgresTarget(c);
 c.exec=s=>c.query(s);await c.query("set statement_timeout='8s';set lock_timeout='2s';set timezone='UTC'");return c;
};
const waitForProbe=async(admin,pid)=>{
 for(let i=0;i<100;i++){
  const wait=(await admin.query('select wait_event_type,wait_event from pg_stat_activity where pid=$1',[pid])).rows[0];
  if(wait?.wait_event_type==='Lock'&&wait.wait_event==='advisory')return wait;
  await new Promise(resolve=>setTimeout(resolve,5));
 }
 assert.fail('Expected a synthetic advisory-lock waiter');
};
try{
 const admin=await connect('admin'),holder=await connect('holder'),reader=await connect('reader'),gate=await connect('gate');
 // The migration itself must supply its bounds, independently of connection
 // defaults. SET LOCAL must restore these wider defaults after rollback.
 await admin.query("set lock_timeout='12s';set statement_timeout='20s'");
 await admin.query('drop schema if exists auth cascade;drop schema if exists icash_work_private cascade;drop schema if exists icash_ranker_private cascade;drop schema public cascade;create schema public');
 await installUsageResearchFixture(admin);await seedResearch(admin,30);assert.equal(migration,read(migrationPath));
 const before=await definition(admin),beforeEvidence=await evidence(admin);
 await holder.query('begin');await holder.query('select pg_advisory_xact_lock(726341927)');
 const adminPid=await value(admin,'select pg_backend_pid()');
 await admin.query('begin');const timeoutStarted=performance.now();
 const timeoutResult=admin.query(migration).then(()=>({unexpected:true}),error=>({error}));
 await waitForProbe(reader,adminPid);assert.equal(await definition(reader),before);assert.deepEqual(await evidence(reader),beforeEvidence);
 const timedOut=await timeoutResult,timeoutMs=performance.now()-timeoutStarted;
 assert.equal(timedOut.error?.code,'55P03');assert(timeoutMs>=1500&&timeoutMs<7000,'Migration supplies the two-second lock limit within its eight-second statement limit');
 await admin.query('rollback');await holder.query('rollback');assert.equal(await definition(admin),before);
 assert.equal(await value(admin,"select current_setting('lock_timeout')"),'12s');assert.equal(await value(admin,"select current_setting('statement_timeout')"),'20s');
 // Exercise a brief holder through the real transaction-locking lane entry.
 // Its general body is a local pause only; it never issues provider work.
 await admin.query(`create table icash_work_private.dispatch_policy(id integer primary key,enabled boolean);
  insert into icash_work_private.dispatch_policy values(1,true);
  create function public.icash_next_automation() returns jsonb language plpgsql set search_path='' as $$begin
   perform pg_advisory_xact_lock(684203116);return null;end$$;`);
 await admin.query(read('tests/fixtures/automation-lane-current.sql'));
 assert.equal(await value(admin,"select md5(pg_get_functiondef('public.icash_next_automation_lane(text)'::regprocedure))"),'3463e54ab56e8a7732a3af2febf9dc88');
 await admin.query('revoke all on function public.icash_next_automation_lane(text) from public,anon,authenticated;grant execute on function public.icash_next_automation_lane(text) to service_role');
 const migrationHash=createHash('sha256').update(migration).digest('hex');
 await admin.query(`create table public.fixture_migration_ledger(version text primary key,sql_hash text not null check(sql_hash='${migrationHash}'))`);
 await holder.query("set role service_role;set lock_timeout='8s'");const holderPid=await value(holder,'select pg_backend_pid()');
 const pendingInstall=async()=>{
  await gate.query('begin');await gate.query('select pg_advisory_xact_lock(684203116)');
  const ordinary=holder.query("select public.icash_next_automation_lane('general')");await waitForProbe(reader,holderPid);
  await admin.query('begin');const installed=admin.query(migration);await waitForProbe(reader,adminPid);
  assert.equal(await definition(reader),before);assert.deepEqual(await evidence(reader),beforeEvidence);
  await gate.query('commit');await ordinary;await installed;
  assert.equal(await value(admin,"select current_setting('lock_timeout')"),'2s');assert.equal(await value(admin,"select current_setting('statement_timeout')"),'8s');
  assert.equal(await value(admin,"select md5(pg_get_functiondef('public.icash_usage_loop_context(uuid,uuid)'::regprocedure))"),'fc24c125163489d40d275e0b158b6455');
  assert.equal(await value(reader,'select pg_try_advisory_xact_lock(726341927)'),false,'Installer retains transaction authority until ledger completion');
 };
 await pendingInstall();await assert.rejects(admin.query("insert into public.fixture_migration_ledger values('20261117180250','wrong-ledger-content')"),error=>error.code==='23514');
 await admin.query('rollback');assert.equal(await definition(admin),before);assert.deepEqual(await evidence(admin),beforeEvidence);
 assert.equal(await value(admin,'select count(*)::int from public.fixture_migration_ledger'),0);
 await pendingInstall();await admin.query('insert into public.fixture_migration_ledger values($1,$2)',['20261117180250',migrationHash]);await admin.query('commit');
 assert.equal(await value(admin,'select count(*)::int from public.fixture_migration_ledger'),1);
 assert.equal(await value(reader,'select pg_try_advisory_xact_lock(726341927)'),true,'Commit releases authority for the next ordinary poll');
 await holder.query('reset role');
 assert.equal(await value(admin,"select md5(pg_get_functiondef('public.icash_usage_loop_context(uuid,uuid)'::regprocedure))"),'fc24c125163489d40d275e0b158b6455');
 assert.deepEqual(await evidence(admin),beforeEvidence);await instrumentScoring(admin);
 await reader.query('set role service_role');const readerPid=await value(reader,'select pg_backend_pid()');
 await admin.query('update public.icash_discovery_configs set enabled=false');
 await holder.query('begin');await holder.query('select pg_advisory_xact_lock(684203114)');
 await reader.query("set statement_timeout='500ms'");
 const blocked=context(reader,'fixture_usage_context_before').then(value=>({value}),error=>({error}));
 await waitForProbe(admin,readerPid);assert.equal((await blocked).error?.code,'57014','Original report waits for ranking that cannot produce work');
 await resetScoring(admin);const skip=await context(reader);assert.equal(skip.work,null);assert.equal(await scoringCalls(admin),0);
 await admin.query('update public.icash_discovery_configs set enabled=true');
 const stillRequired=context(reader).then(value=>({value}),error=>({error}));await waitForProbe(admin,readerPid);
 assert.equal((await stillRequired).error?.code,'57014','Eligible work retains the actual ranking dependency');
 await holder.query('rollback');await reader.query("set statement_timeout='8s'");
 // A rate/config change committed during ranking remains visible to the
 // unchanged post-selection validation. The precheck grants no authority.
 for(const [label,change] of [
  ['disabled config','update public.icash_discovery_configs set enabled=false'],
  ['expired rate','update public.icash_operation_rates set expires_at=now()'],
 ]){
  await admin.query("update public.icash_discovery_configs set enabled=true;update public.icash_operation_rates set expires_at=now()+interval '1 day'");
  await holder.query('begin');await holder.query('select pg_advisory_xact_lock(684203114)');
  const pending=context(reader);await waitForProbe(admin,readerPid);
  await holder.query(change);await holder.query('commit');
  assert.equal((await pending).work,null,label+' committed during ranking is still refused');
 }
 // Fresh read-committed statements within one reader transaction do not reuse
 // the prior precheck. All report fields still match the captured original.
 await reader.query('begin');
 assert.deepEqual(await context(reader),await context(reader,'fixture_usage_context_before'));
 await holder.query("update public.icash_discovery_configs set enabled=true;update public.icash_operation_rates set expires_at=now()+interval '1 day'");
 const fresh=await context(reader);assert.equal(fresh.work.kind,'research');assert.deepEqual(fresh,await context(reader,'fixture_usage_context_before'));
 await holder.query('update public.icash_operation_rates set verified_at=null');
 await resetScoring(admin);const unverified=await context(reader);assert.equal(unverified.work,null);assert.equal(await scoringCalls(admin),0);assert.deepEqual(unverified,await context(reader,'fixture_usage_context_before'));
 await reader.query('rollback');
 console.log(JSON.stringify({result:'PASS native usage research precheck',postgres:await value(admin,'show server_version'),resultHash:'fc24c125163489d40d275e0b158b6455',boundedSchedulerWaitMs:Math.round(timeoutMs),shortActualLaneWaitInstalled:true,waitedLedgerRollback:true,irrelevantRankingTimeoutAvoided:true,eligibleRankingPreserved:true,lateCommittedConfigAndRateRefused:true,freshStatementControls:true,ledgerRollback:true}));
}catch(e){console.error(e.stack,e.where??'');process.exitCode=1;}finally{
 await Promise.allSettled(clients.map(c=>c.query('rollback')));await Promise.allSettled(clients.map(c=>c.end()));
}
