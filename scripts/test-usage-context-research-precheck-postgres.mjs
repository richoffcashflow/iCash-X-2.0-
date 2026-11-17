// Captured report/selector/score SQL with local synthetic source and lock probes.
import assert from 'node:assert/strict';
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
 assert.fail('Expected the synthetic scoring probe to hold the actual selector');
};
try{
 const admin=await connect('admin'),holder=await connect('holder'),reader=await connect('reader');
 await admin.query('drop schema if exists auth cascade;drop schema if exists icash_work_private cascade;drop schema if exists icash_ranker_private cascade;drop schema public cascade;create schema public');
 await installUsageResearchFixture(admin);await seedResearch(admin,30);assert.equal(migration,read(migrationPath));
 const before=await definition(admin),beforeEvidence=await evidence(admin);
 await holder.query('begin');await holder.query('select pg_advisory_xact_lock(726341927)');
 await admin.query('begin');await assert.rejects(admin.query(migration),/Usage research precheck scheduler busy/);await admin.query('rollback');await holder.query('rollback');
 assert.equal(await definition(admin),before);
 await admin.query('begin');await admin.query(migration);await assert.rejects(admin.query('select 1/0 as synthetic_ledger_failure'),/division by zero/);await admin.query('rollback');assert.equal(await definition(admin),before);
 await admin.query('begin;'+migration+'commit;');
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
 console.log(JSON.stringify({result:'PASS native usage research precheck',postgres:await value(admin,'show server_version'),resultHash:'fc24c125163489d40d275e0b158b6455',irrelevantRankingTimeoutAvoided:true,eligibleRankingPreserved:true,lateCommittedConfigAndRateRefused:true,freshStatementControls:true,ledgerRollback:true}));
}catch(e){console.error(e.stack,e.where??'');process.exitCode=1;}finally{
 await Promise.allSettled(clients.map(c=>c.query('rollback')));await Promise.allSettled(clients.map(c=>c.end()));
}
