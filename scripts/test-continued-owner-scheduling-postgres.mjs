// Actual acquisition and issued-token recorder, native locks and late Pause.
// All data is synthetic; the only connection is the fixed disposable localhost.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {installContinuedSchedulingFixture,seedContinued,seedOrdinary,seedLive,seedReady,issue,source,original,decisions,value,read} from '../tests/helpers/continued-owner-scheduling-fixture.mjs';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg'),clients=[];
const connect=async name=>{
 const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',application_name:'continued-owner-'+name,connectionTimeoutMillis:5000});
 clients.push(c);await c.connect();await assertDisposablePostgresTarget(c);
 await c.query("set statement_timeout='8s';set lock_timeout='5s';set timezone='UTC'");return c;
};
const guardSignatures=['public.icash_owner_enrichment_retry_current(uuid,uuid)','public.icash_owner_enrichment_unstarted(uuid,uuid,text)',
 'public.icash_owner_preflight_due_at(uuid,uuid)','icash_work_private.owner_preflight_step_due(uuid)',
 'public.icash_acquisition_capacity_available(uuid)','public.icash_owner_retry_due_at(uuid)',
 'public.icash_dealmachine_capacity_available(integer,uuid)','public.icash_guard_owner_enrichment_recovery_credit()',
 'public.icash_guard_owner_enrichment_recovery_spend()','public.icash_record_owner_preflight_cleanup(uuid,uuid,jsonb)'];
const guardHashes=db=>value(db,"select jsonb_object_agg(signature,md5(pg_get_functiondef(signature::regprocedure))) from unnest($1::text[]) signature",[guardSignatures]);
const definition=db=>value(db,"select pg_get_functiondef('public.icash_next_acquisition()'::regprocedure)");
const policies=db=>value(db,`select jsonb_build_object('fair',(select to_jsonb(p) from icash_work_private.continuation_policy p),
 'step',(select to_jsonb(p) from icash_work_private.preflight_step_policy p),'headroom',(select to_jsonb(p) from icash_research_private.acquisition_headroom_policy p))`);
try{
 const admin=await connect('admin'),blocker=await connect('blocker'),worker=await connect('worker');
 await admin.query('drop schema if exists icash_work_private cascade;drop schema if exists icash_private cascade;drop schema if exists icash_research_private cascade;drop schema if exists icash_owner_review_private cascade;drop schema public cascade;create schema public');
 await installContinuedSchedulingFixture(admin);
 const migration=read('config/continued-owner-scheduling.sql');
 assert.equal(migration,read('supabase/migrations/20261115134000_continued_owner_scheduling.sql'));
 // Before the overlay, execute the real scheduler 101 times. No projection or
 // replacement selector can conceal the original account-order starvation.
 await admin.query('begin');
 const urgent=await seedContinued(admin,41000,{deadlineMinutes:5}),ordinary=[];
 for(let n=41100;n<41200;n++)ordinary.push(await seedOrdinary(admin,n));
 for(let i=0;i<100;i++){const selected=await issue(admin);assert(ordinary.some(c=>c.account===selected?.account_id));}
 assert.equal((await issue(admin)).id,urgent.ticket);
 assert.equal((await decisions(admin)).at(-1).continuation,false);
 assert(100*4>5*60,'The actual rank exceeds the original deadline at a synthetic four-second interval; the fast fixture does not simulate elapsed production time');
 await admin.query('rollback');
 const beforeDefinition=await definition(admin),beforePolicies=await policies(admin),beforeGuards=await guardHashes(admin);
 await admin.query('begin');await admin.query(migration);await assert.rejects(admin.query('select 1/0 as migration_ledger_failure'),/division by zero/);await admin.query('rollback');
 assert.equal(await definition(admin),beforeDefinition);assert.deepEqual(await policies(admin),beforePolicies);
 assert.equal(await value(admin,"select to_regprocedure('icash_work_private.continued_owner_preflight_source(uuid,uuid,uuid)')"),null);
 await admin.query('begin;'+migration+'commit;');assert.deepEqual(await guardHashes(admin),beforeGuards,'Existing final admission and financial guards remain byte-for-byte unchanged');
 await admin.query('begin;'+read('config/owner-wait-admission.sql')+'commit;');
 const upgraded=await policies(admin);
 for(const key of ['fair','step','headroom'])for(const field of ['enabled','release_sha','activated_at'])assert.equal(upgraded[key][field],beforePolicies[key][field]);
 await worker.query('set role service_role');

 // Concurrent real issuers share the existing budget lock. Every committed
 // decision must bind exactly one issued token and the original cleaned list.
 const continued=[];for(let i=0;i<6;i++)continued.push(await seedContinued(admin,41300+i,{checking:i%2===0,deadlineMinutes:10+i}));
 const ordinaryAfter=[];for(let i=0;i<3;i++)ordinaryAfter.push(await seedOrdinary(admin,41400+i));
 const originalSources=await Promise.all(continued.map(c=>source(admin,c))),originalTickets=await Promise.all(continued.map(c=>original(admin,c)));
 const requestsBefore=await value(admin,'select count(*)::int from icash_research_private.requests');
 const contenders=await Promise.all(Array.from({length:9},(_,i)=>connect('issue-'+i)));
 await Promise.all(contenders.map(c=>c.query('set role service_role')));
 const selected=await Promise.all(contenders.map(issue));assert(selected.every(Boolean));
 assert.equal(new Set(selected.map(t=>t.id)).size,9,'Concurrent workers cannot issue the same original twice');
 const saved=await decisions(admin);
 assert.deepEqual(saved.map(d=>d.continuation),[true,true,false,true,true,false,true,true,false]);
 assert.deepEqual(saved.filter(d=>d.continuation).map(d=>d.ticket_id),continued.map(c=>c.ticket));
 for(let i=0;i<continued.length;i++){
  const c=continued[i],ticket=selected.find(t=>t.id===c.ticket),decision=saved.find(d=>d.ticket_id===c.ticket);
  assert(ticket);assert.equal(decision.preflight_id,c.preflight);
  assert.equal(ticket.owner_preview_retry_until,originalTickets[i].owner_preview_retry_until);
  assert.equal(ticket.owner_preview_deferrals,originalTickets[i].owner_preview_deferrals);
  assert.equal(ticket.issue_attempts,originalTickets[i].issue_attempts);
  assert.deepEqual(await source(admin,c),originalSources[i]);
  assert.equal(await value(admin,"select encode(sha256(convert_to(token,'UTF8')),'hex') from public.icash_automation_tickets where id=$1",[ticket.id]),decision.issue_token_hash);
 }
 assert(saved.filter(d=>!d.continuation).every(d=>ordinaryAfter.some(c=>c.account===d.account_id)));
 assert.equal(await value(admin,'select count(*)::int from icash_research_private.requests'),requestsBefore,'Scheduling adds no provider request');
 assert.equal(await value(admin,'select count(*)::int from public.icash_operation_spend'),0);
 assert.equal(await value(admin,'select count(*)::int from public.icash_credit_reservations'),0);
 assert.equal(await value(admin,'select count(*)::int from public.icash_owner_contacts'),0);
 const one=continued[0];
 await Promise.all(contenders.map(c=>c.query('select icash_work_private.record_continuation_decision($1,$2,$3,true)',[one.ticket,one.account,one.screening])));
 assert.deepEqual(await decisions(admin),saved,'Repeated exact issued-token acknowledgment is idempotent under contention');

 // Two available tokens still cannot issue a cleaned original. Restore three
 // in a later due cycle without extending the original ticket or source.
 const capacity=await seedContinued(admin,41500),capacityBefore=await original(admin,capacity);
 for(const available of [0,2]){
  await admin.query('update public.fixture_cleanup_policy set ordinary=$1,starter=0',[available]);
  await admin.query("update public.icash_discovery_configs set next_run_at=now()-interval '1 minute' where account_id=$1",[capacity.account]);
  const dueBefore=await value(admin,'select next_run_at from public.icash_discovery_configs where account_id=$1',[capacity.account]);
  assert.equal(await value(worker,'select icash_work_private.continued_owner_preflight_deadline($1,$2)',[capacity.account,capacity.screening]),null);
  assert.equal(await issue(worker),null);assert.deepEqual(await decisions(admin),saved);
  assert.deepEqual(await value(admin,'select next_run_at from public.icash_discovery_configs where account_id=$1',[capacity.account]),dueBefore,'The actual acquisition headroom keeps the original account due');
 }
 await admin.query('update public.fixture_cleanup_policy set ordinary=3');
 await admin.query("update public.icash_discovery_configs set next_run_at=now()-interval '1 minute' where account_id=$1",[capacity.account]);
 assert.equal((await issue(worker)).id,capacity.ticket);
 assert.equal((await original(admin,capacity)).owner_preview_retry_until,capacityBefore.owner_preview_retry_until);

 // Pause commits under the same budget lock before the waiting issuer reaches
 // its current-source check. An unrelated ordinary account still progresses.
 const paused=await seedContinued(admin,41501,{deadlineMinutes:5}),other=await seedOrdinary(admin,41502),pausedOriginal=await original(admin,paused);
 await blocker.query('begin;select 1 from public.icash_operating_budget where id=1 for update');
 await blocker.query('update public.icash_accounts set bot_paused=true where id=$1',[paused.account]);
 const pending=issue(worker).then(result=>({result}),error=>({error}));
 try{
  const started=performance.now();let waiting=false;
  while(performance.now()-started<1500){waiting=await value(admin,'select $1::integer=any(pg_blocking_pids($2::integer))',[blocker.processID,worker.processID]);if(waiting)break;await new Promise(resolve=>setTimeout(resolve,20));}
  assert(waiting,'The actual issuer must block on the existing budget row');
 }finally{await blocker.query('commit');}
 const result=await pending;assert.ifError(result.error);assert.equal(result.result.account_id,other.account);
 assert.deepEqual(await original(admin,paused),pausedOriginal,'Late Pause cannot reissue or reset the original ticket');
 assert.equal(await value(worker,'select icash_work_private.continued_owner_preflight_deadline($1,$2)',[paused.account,paused.screening]),null);
 const lateGuards=[
  ['unknown provider cost',c=>admin.query('insert into icash_private.provider_costs values($1)',[`owners:${c.account}:${c.screening}`])],
  ['reserved wallet',c=>admin.query('update public.icash_wallets set reserved_cents=balance_cents where account_id=$1',[c.account])],
  ['changed source',c=>admin.query("update public.icash_screening_jobs set snapshot=jsonb_set(snapshot,'{propertyId}','\"prop_changed\"') where id=$1",[c.screening])],
  ['expired original',c=>admin.query('update public.icash_automation_tickets set owner_preview_retry_until=now() where id=$1',[c.ticket])],
  ['unconfirmed deletion',async c=>{
   await admin.query('alter table icash_research_private.owner_export_preflights disable trigger owner_preflight_immutable');
   await admin.query("update icash_research_private.owner_export_preflights set cleanup_receipts=jsonb_set(cleanup_receipts,'{0,receipt,rawText}','\"{}\"') where id=$1",[c.preflight]);
   await admin.query('alter table icash_research_private.owner_export_preflights enable trigger owner_preflight_immutable');
  }],
 ];
 for(let i=0;i<lateGuards.length;i++){
  await admin.query('begin');
  try{
   const c=await seedContinued(admin,41600+i),ordinary=await seedOrdinary(admin,41700+i);
   await lateGuards[i][1](c);const before=await original(admin,c),preflight=await source(admin,c),previousDecisions=await decisions(admin);
   await admin.query('set local role service_role');
   assert.equal(await value(admin,'select icash_work_private.continued_owner_preflight_deadline($1,$2)',[c.account,c.screening]),null,lateGuards[i][0]);
   assert.equal((await issue(admin)).account_id,ordinary.account,lateGuards[i][0]+' must preserve independent ordinary progress');
   await admin.query('reset role');
   const after=await original(admin,c);
   if(lateGuards[i][0]==='expired original')before.outcome='owner_preview_expired';
   assert.deepEqual(after,before,'Blocked source is not reissued or extended');assert.deepEqual(await source(admin,c),preflight);
   assert.equal((await decisions(admin)).length,previousDecisions.length+1);
  }finally{await admin.query('rollback');}
 }
 for(const boundary of ['capacity','export']){
  await admin.query('begin');
  try{
   const c=await seedContinued(admin,boundary==='capacity'?41800:41801),before=await original(admin,c),savedDecisions=await decisions(admin);
   await admin.query(boundary==='capacity'?
    "create or replace function public.icash_dealmachine_capacity_available(p_requests integer,p_account uuid) returns boolean language sql stable security definer set search_path='' as $$select null::boolean$$":
    "create or replace function public.icash_owner_active_export_capacity(p_account uuid) returns text language sql stable security definer set search_path='' as $$select null::text$$");
   await admin.query('set local role service_role');
   assert.equal(await value(admin,'select icash_work_private.continued_owner_preflight_deadline($1,$2)',[c.account,c.screening]),null,'NULL '+boundary+' fails closed');
   assert.equal(await issue(admin),null);await admin.query('reset role');
   assert.deepEqual(await original(admin,c),before);assert.deepEqual(await decisions(admin),savedDecisions);
  }finally{await admin.query('rollback');}
 }
 for(const liveFirst of [true,false]){
  await admin.query('begin');
  try{
   await admin.query('update icash_work_private.continuation_policy set issued=issued+(3-issued%3)%3');
   const n=liveFirst?41900:41910,journal=await seedContinued(admin,n,{deadlineMinutes:liveFirst?10:5}),live=await seedLive(admin,n+1,liveFirst?1:20),ordinary=await seedOrdinary(admin,n+2);
   await admin.query('set local role service_role');
   assert.equal((await issue(admin)).id,liveFirst?live.ticket:journal.ticket,'Native selector compares immutable deadlines across both families');
   assert.equal((await issue(admin)).id,liveFirst?journal.ticket:live.ticket);assert.equal((await issue(admin)).account_id,ordinary.account);
   await admin.query('reset role');assert.deepEqual((await decisions(admin)).slice(-3).map(d=>d.continuation),[true,true,false]);
  }finally{await admin.query('rollback');}
 }
 await admin.query('begin');
 try{
  await admin.query('update icash_work_private.continuation_policy set issued=issued+(3-issued%3)%3');
  const journal=await seedContinued(admin,41920,{deadlineMinutes:5}),live=await seedLive(admin,41921,20);
  await admin.query('update public.fixture_cleanup_policy set ordinary=2,starter=0');await admin.query('set local role service_role');
  assert.equal(await value(admin,'select icash_work_private.continued_owner_preflight_deadline($1,$2)',[journal.account,journal.screening]),null);
  assert.equal((await issue(admin)).id,live.ticket);await admin.query('reset role');assert.equal((await original(admin,journal)).state,'held');
 }finally{await admin.query('rollback');}
 for(const readyFirst of [true,false]){
  await admin.query('begin');
  try{
   await admin.query('update icash_work_private.continuation_policy set issued=issued+(3-issued%3)%3');
   const n=readyFirst?41930:41940,journal=await seedContinued(admin,n,{deadlineMinutes:readyFirst?10:5}),ready=await seedReady(admin,n+1,readyFirst?1:20);
   assert.equal(await value(admin,'select icash_research_private.owner_preflight_ready_current($1)',[ready.preflight]),true);
   await admin.query('set local role service_role');assert.equal((await issue(admin)).id,readyFirst?ready.ticket:journal.ticket);await admin.query('reset role');
  }finally{await admin.query('rollback');}
 }
 for(const role of ['anon','authenticated'])assert.equal(await value(admin,"select has_function_privilege($1,'icash_work_private.continued_owner_preflight_deadline(uuid,uuid)','execute')",[role]),false);
 assert.equal(await value(admin,"select has_function_privilege('service_role','icash_work_private.continued_owner_preflight_source(uuid,uuid,uuid)','execute')"),false);
 assert.equal(await value(admin,"select continued_original_hashes=(select jsonb_object_agg(signature,md5(pg_get_functiondef(signature::regprocedure))) from unnest(array['icash_work_private.continued_owner_preflight_source(uuid,uuid,uuid)','icash_work_private.continued_owner_preflight_deadline(uuid,uuid)','icash_work_private.live_owner_preflight_deadline(uuid,uuid)','public.icash_enrichment_before_prospecting_budget(uuid)']) signature) from icash_work_private.continuation_policy"),true);
 assert.deepEqual(await guardHashes(admin),beforeGuards);
 console.log('PASS native continued-original acquisition: actual rank101 reproduction, concurrent exact-ticket issuance and token recorder, six continuation/three ordinary turns, three-token capacity, ledger rollback, late Pause, unchanged guards and no provider work.');
}catch(error){console.error(error.stack,error.where??'');process.exitCode=1;}finally{await Promise.allSettled(clients.map(c=>c.end()));}
