// Actual wait bookkeeping and native acquisition. Fixed disposable loopback
// database only; fixture receipts never make a provider request or spend money.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {installOwnerWaitFixture,seedWaitBatch,scoreCalls,resetScoreCalls,seedLive,seedContinued,seedOrdinary,issue,source,original,decisions,value,read} from '../tests/helpers/owner-wait-admission-fixture.mjs';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg'),clients=[];
const connect=async name=>{
 const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',application_name:'owner-wait-'+name,connectionTimeoutMillis:5000});
 clients.push(c);await c.connect();await assertDisposablePostgresTarget(c);
 await c.query("set statement_timeout='8s';set lock_timeout='5s';set timezone='UTC'");return c;
};
const wait=(db,c)=>value(db,'select icash_work_private.record_export_wait($1,(select next_run_at from public.icash_discovery_configs where account_id=$1))',[c.account]);
const waitRows=(db,c)=>value(db,'select count(*)::int from icash_work_private.acquisition_export_waits where account_id=$1',[c.account]);
const definitions=db=>value(db,"select jsonb_object_agg(signature,pg_get_functiondef(signature::regprocedure)) from unnest($1::text[]) signature",[[
 'public.icash_next_acquisition()','public.icash_enrichment_before_prospecting_budget(uuid)','public.icash_enrichment_before_provider_quota(uuid)',
 'public.icash_owner_preflight_due_at(uuid,uuid)','icash_work_private.owner_preflight_step_due(uuid)',
 'icash_work_private.owner_preflight_two_step_current(uuid)','public.icash_dealmachine_capacity_available(integer,uuid)',
 'public.icash_owner_enrichment_retry_current(uuid,uuid)','public.icash_owner_enrichment_unstarted(uuid,uuid,text)',
 'public.icash_guard_owner_enrichment_recovery_credit()','public.icash_guard_owner_enrichment_recovery_spend()']]);
const recordDefinition=db=>value(db,"select pg_get_functiondef('icash_work_private.record_export_wait(uuid,timestamptz)'::regprocedure)");
const policies=db=>value(db,`select jsonb_build_object('fair',(select to_jsonb(p) from icash_work_private.continuation_policy p),
 'step',(select to_jsonb(p) from icash_work_private.preflight_step_policy p),'headroom',(select to_jsonb(p) from icash_research_private.acquisition_headroom_policy p))`);
const evidence=db=>value(db,`select jsonb_build_object(
 'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]'::jsonb) from icash_research_private.requests r),
 'spend',(select coalesce(jsonb_agg(to_jsonb(s) order by operation_key),'[]'::jsonb) from public.icash_operation_spend s),
 'credit',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]'::jsonb) from public.icash_credit_reservations r),
 'wallets',(select coalesce(jsonb_agg(to_jsonb(w) order by account_id),'[]'::jsonb) from public.icash_wallets w))`);
const isolate=async(db,fn)=>{await db.query('begin');try{return await fn();}finally{await db.query('rollback');}};
try{
 const admin=await connect('admin'),blocker=await connect('blocker'),worker=await connect('worker'),migrator=await connect('migrator');
 await admin.query('drop schema if exists icash_work_private cascade;drop schema if exists icash_private cascade;drop schema if exists icash_research_private cascade;drop schema if exists icash_owner_review_private cascade;drop schema public cascade;create schema public');
 await installOwnerWaitFixture(admin);
 const migration=read('config/owner-wait-admission.sql');
 assert.equal(migration,read('supabase/migrations/20261115143000_owner_wait_admission.sql'));
 const beforeDefinitions=await definitions(admin),beforeRecord=await recordDefinition(admin),beforePolicies=await policies(admin);
 // The real pre-upgrade wait callback defeats an otherwise admitted live step.
 await isolate(admin,async()=>{
  const c=await seedLive(admin,51000,20),before=await original(admin,c),preflight=await source(admin,c),saved=await evidence(admin);
  await admin.query('update public.fixture_cleanup_policy set ordinary=2,starter=0');
  assert.equal(await value(admin,'select icash_work_private.owner_preflight_step_due($1)',[c.account]),true);
  await admin.query('set local role service_role');assert.equal(await issue(admin),null);await admin.query('reset role');
  assert.equal(await waitRows(admin,c),1);assert.equal(await value(admin,'select next_run_at>now() from public.icash_discovery_configs where account_id=$1',[c.account]),true);
  assert.deepEqual(await original(admin,c),before);assert.deepEqual(await source(admin,c),preflight);assert.deepEqual(await evidence(admin),saved);
 });
 // A positive 200-candidate wait performs real ranking before this correction.
 await isolate(admin,async()=>{
  const c=await seedWaitBatch(admin,51001,200);await admin.query("insert into icash_research_private.owner_exports(request,terminal_at,capacity_review_id) values('{}',null,null)");
  await resetScoreCalls(admin);assert.equal(await wait(admin,c),true);assert.equal(await scoreCalls(admin),200);
 });
 // Failed enclosing migration-ledger work leaves every definition and policy
 // exactly original and does not expose partially created helper functions.
 await admin.query('begin');await admin.query(migration);await assert.rejects(admin.query('select 1/0 as migration_ledger_failure'),/division by zero/);await admin.query('rollback');
 assert.deepEqual(await definitions(admin),beforeDefinitions);assert.equal(await recordDefinition(admin),beforeRecord);assert.deepEqual(await policies(admin),beforePolicies);
 assert.equal(await value(admin,"select to_regprocedure('icash_work_private.owner_enrichment_wait_candidate(uuid)')"),null);
 // Installation shares the normal administrative budget lock, observed via
 // PostgreSQL blocker identity rather than a guessed sleep interval.
 await blocker.query('begin;select 1 from public.icash_operating_budget where id=1 for update');
 await migrator.query('begin');const installing=migrator.query(migration).then(()=>({ok:true}),error=>({error}));
 try{
  let waiting=false;const started=performance.now();
  while(performance.now()-started<1500){waiting=await value(admin,'select $1::integer=any(pg_blocking_pids($2::integer))',[blocker.processID,migrator.processID]);if(waiting)break;await new Promise(resolve=>setTimeout(resolve,20));}
  assert(waiting,'Migration waits behind the shared budget row');assert.equal(await recordDefinition(admin),beforeRecord);
 }finally{await blocker.query('rollback');}
 const installed=await installing;assert.ifError(installed.error);await migrator.query('commit');
 assert.deepEqual(await definitions(admin),beforeDefinitions,'Selection, eligibility, quotas and financial authority are unchanged');
 const afterPolicies=await policies(admin);
 for(const name of ['fair','step','headroom'])for(const field of ['enabled','release_sha','activated_at'])assert.equal(afterPolicies[name][field],beforePolicies[name][field],'Existing activation provenance remains unchanged');
 assert.equal(afterPolicies.fair.issued,beforePolicies.fair.issued,'Installing bookkeeping cannot consume a scheduling turn');
 // Exercise the full release order, including the compatible fourth wrapper
 // optimization, before real concurrent acquisition and late-control cases.
 const eligibility=read('config/owner-expired-checking-eligibility.sql');
 assert.equal(eligibility,read('supabase/migrations/20261115150210_owner_expired_checking_eligibility.sql'));
 await admin.query('begin;'+eligibility+'commit;');
 await worker.query('set role service_role');

 for(const [kind,tokens,turn,allowed] of [['live',2,0,true],['live',2,2,false],['ordinary',2,0,false],['cleaned',2,0,false],['live',3,0,true],['cleaned',3,0,true]])await isolate(admin,async()=>{
  const n=51100+tokens*10+turn+(kind==='ordinary'?100:kind==='cleaned'?200:0),c=kind==='live'?await seedLive(admin,n,20):kind==='cleaned'?await seedContinued(admin,n):await seedOrdinary(admin,n);
  await admin.query('update public.fixture_cleanup_policy set ordinary=$1,starter=0',[tokens]);await admin.query('update icash_work_private.continuation_policy set issued=$1',[turn]);
  const before=kind==='ordinary'?null:await original(admin,c),preflight=kind==='ordinary'?null:await source(admin,c),saved=await evidence(admin);
  await admin.query('set local role service_role');const selected=await issue(admin);await admin.query('reset role');
  assert.equal(Boolean(selected),allowed,`${kind}, ${tokens} tokens, turn ${turn}`);
  if(allowed&&kind!=='ordinary'){
   assert.equal(selected.id,c.ticket);assert.equal(selected.owner_preview_retry_until,before.owner_preview_retry_until);
   assert.equal(selected.owner_preview_deferrals,before.owner_preview_deferrals);assert.equal(selected.issue_attempts,before.issue_attempts);
  }else if(before)assert.deepEqual(await original(admin,c),before);
  if(preflight)assert.deepEqual(await source(admin,c),preflight);assert.deepEqual(await evidence(admin),saved);assert.equal(await waitRows(admin,c),0);
 });
 for(const kind of ['live','cleaned'])await isolate(admin,async()=>{
  const c=kind==='live'?await seedLive(admin,51400,20):await seedContinued(admin,51401);
  await admin.query("insert into icash_research_private.owner_exports(request,terminal_at,capacity_review_id) values('{}',null,null)");
  const before=await original(admin,c),saved=await evidence(admin);
  assert.equal(await value(admin,'select icash_work_private.owner_preflight_step_due($1)',[c.account]),false,'Real export busy does not become the two-step exception');
  await admin.query('set local role service_role');assert.equal(await issue(admin),null);await admin.query('reset role');
  assert.equal(await waitRows(admin,c),1);assert.deepEqual(await original(admin,c),before);assert.deepEqual(await evidence(admin),saved);
 });
 // Same funded source and same exact due time, without executing a ranker.
 await isolate(admin,async()=>{
  const c=await seedWaitBatch(admin,51500,200);await admin.query("insert into icash_research_private.owner_exports(request,terminal_at,capacity_review_id) values('{}',null,null)");
  const saved=await evidence(admin);await resetScoreCalls(admin);
  assert.equal(await wait(admin,c),true);assert.equal(await scoreCalls(admin),0);assert.deepEqual(await evidence(admin),saved);
 });
 // Verify boolean eligibility directly against the exact ranked predecessor,
 // including empty, manual-control, source-invalid and financially blocked sets.
 const mutations=[
  async()=>{},
  c=>admin.query("update public.icash_screening_jobs set state='failed' where account_id=$1",[c.account]),
  c=>admin.query('update public.icash_wallets set reserved_cents=balance_cents where account_id=$1',[c.account]),
  c=>admin.query("insert into public.icash_property_controls(account_id,property_id,manual) select account_id,snapshot->>'propertyId',true from public.icash_screening_jobs where account_id=$1 on conflict do nothing",[c.account]),
  c=>admin.query("update public.icash_screening_jobs set completed_at=now()-interval '25 hours' where account_id=$1",[c.account]),
  c=>admin.query("update public.icash_screening_jobs set result='{}' where account_id=$1",[c.account]),
 ];
 for(let i=0;i<mutations.length;i++)await isolate(admin,async()=>{
  const c=await seedWaitBatch(admin,51600+i,200);await mutations[i](c);
  const expected=(await value(admin,'select public.icash_enrichment_before_provider_quota($1)',[c.account]))!==null;
  await resetScoreCalls(admin);assert.equal(await value(admin,'select icash_work_private.owner_enrichment_wait_candidate($1)',[c.account]),expected);
  assert.equal(await scoreCalls(admin),0,'Existence does no ranking for eligibility case '+i);
 });
 for(const [label,mutate] of [
  ['unknown original',c=>admin.query('insert into icash_private.provider_costs values($1)',[`owners:${c.account}:${c.screening}`])],
  ['stale source',c=>admin.query("update public.icash_screening_jobs set snapshot=jsonb_set(snapshot,'{propertyId}','\"prop_changed\"') where id=$1",[c.screening])],
  ['reserved wallet',c=>admin.query('update public.icash_wallets set reserved_cents=balance_cents where account_id=$1',[c.account])],
 ])await isolate(admin,async()=>{
  const c=await seedLive(admin,51700,20);await mutate(c);await admin.query('update public.fixture_cleanup_policy set ordinary=2,starter=0');
  const before=await original(admin,c),preflight=await source(admin,c),saved=await evidence(admin);
  await admin.query('set local role service_role');assert.equal(await issue(admin),null,label);await admin.query('reset role');
  assert.deepEqual(await original(admin,c),before);assert.deepEqual(await source(admin,c),preflight);assert.deepEqual(await evidence(admin),saved);
 });
 // Current customer Pause commits before a waiting scheduler's locked read;
 // an independent eligible two-token live source still gets the next slot.
 const paused=await seedLive(admin,51800,20),independent=await seedLive(admin,51801,20);
 await admin.query('update public.fixture_cleanup_policy set ordinary=2,starter=0');
 const pausedTicket=await original(admin,paused),pausedSource=await source(admin,paused),saved=await evidence(admin);
 await blocker.query('begin;select 1 from public.icash_operating_budget where id=1 for update');await blocker.query('update public.icash_accounts set bot_paused=true where id=$1',[paused.account]);
 const pending=issue(worker).then(result=>({result}),error=>({error}));
 try{
  let waiting=false;const started=performance.now();
  while(performance.now()-started<1500){waiting=await value(admin,'select $1::integer=any(pg_blocking_pids($2::integer))',[blocker.processID,worker.processID]);if(waiting)break;await new Promise(resolve=>setTimeout(resolve,20));}
  assert(waiting,'The actual issuer waits on the budget lock');
 }finally{await blocker.query('commit');}
 const result=await pending;assert.ifError(result.error);assert.equal(result.result.id,independent.ticket);
 assert.deepEqual(await original(admin,paused),pausedTicket);assert.deepEqual(await source(admin,paused),pausedSource);assert.deepEqual(await evidence(admin),saved);
 assert.equal(await waitRows(admin,paused),0);assert.equal(await waitRows(admin,independent),0);
 for(const role of ['anon','authenticated'])for(const fn of ['icash_work_private.record_export_wait(uuid,timestamptz)','icash_work_private.owner_enrichment_wait_candidate(uuid)','icash_work_private.owner_enrichment_candidate_exists(uuid)']){
  assert.equal(await value(admin,'select has_function_privilege($1,$2,\'execute\')',[role,fn]),false);
 }
 assert.deepEqual(await definitions(admin),beforeDefinitions);
 console.log('PASS native owner wait admission: real prior two-token stall, exact live-step bypass, ordinary/renewal/busy holds, 200-to-zero score calls with eligibility equivalence, atomic migration rollback, budget-lock Pause, unchanged original evidence and no provider or paid work.');
}catch(error){console.error(error.stack,error.where??'');process.exitCode=1;}finally{await Promise.allSettled(clients.map(c=>c.end()));}
