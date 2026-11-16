// Native, disposable localhost-only rehearsal. All original evidence is synthetic.
// The actual ledger, immutable recording guard/audit and dial transition are used.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';

const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const root=new URL('../',import.meta.url),clients=[];
const read=path=>readFile(new URL(path,root),'utf8');
const release='d'.repeat(40),sha='a'.repeat(64);
const uid=n=>`00000000-0000-4000-9000-${String(n).padStart(12,'0')}`;
const connect=async name=>{
 const db=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',application_name:'undialed-review-'+name,connectionTimeoutMillis:5000});
 clients.push(db);await db.connect();await assertDisposablePostgresTarget(db);
 await db.query("set statement_timeout='8s';set lock_timeout='5s';set timezone='UTC'");return db;
};
const value=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const definition=(sql,name)=>{
 const start=sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);assert(start>=0,name);
 const end=sql.indexOf('$function$;',start);assert(end>start,name);return sql.slice(start,end+12);
};
let admin,blocker,worker;
const finish=(f,db=admin,args=[f.review,f.account,f.operation,release])=>value(db,'select public.icash_finish_reviewed_undialed_recording($1,$2,$3,$4)',args);
const claim=(f,db=admin)=>value(db,"select public.icash_transition_call_recording($1,$2,$3,'consent_pending','claim_dial','{}')",[f.recording,f.account,f.operation]);
const financial=async f=>value(admin,`select jsonb_build_object(
 'operation',to_jsonb(o),'credit',(select to_jsonb(c) from public.icash_credit_reservations c where c.id=o.credit_reservation_id),
 'wallet',(select to_jsonb(w) from public.icash_wallets w where w.account_id=o.account_id),
 'usage',(select coalesce(jsonb_agg(to_jsonb(l) order by id),'[]') from public.icash_credit_ledger l where l.event_key in ('usage:'||o.operation_key,'usage-coverage:'||o.operation_key)),
 'coverage',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.icash_usage_coverage c where c.operation_key=o.operation_key))
 from public.icash_operation_spend o where o.operation_key=$1`,[f.operation]);
const housekeeping=f=>admin.query("update public.icash_call_recordings set row_version=row_version+1,last_action='claim_reconcile',reconcile_attempts=reconcile_attempts+1,updated_at=clock_timestamp() where id=$1",[f.recording]);
const waitForLock=async application=>{
 for(let i=0;i<100;i++){
  if(await value(admin,"select exists(select 1 from pg_stat_activity where application_name=$1 and wait_event_type='Lock')",[application]))return;
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 assert.fail('Competing transaction did not reach the authoritative lock');
};
async function beforeFinalizer(f,write){
 await blocker.query('begin');
 try{
  await blocker.query('select id from public.icash_operating_budget where id=1 for update');
  await write(blocker);
  await assert.rejects(()=>finish(f,worker),error=>error.code==='55P03','In-flight original evidence must refuse immediately');
  await blocker.query('commit');
  return await finish(f,worker);
 }catch(error){await blocker.query('rollback');throw error;}
}

async function setup(){
 await admin.query('drop schema if exists icash_recording_private cascade;drop schema if exists icash_private cascade;drop schema public cascade;create schema public');
 await admin.query(await read('tests/fixtures/voice-predial-foundation.sql'));
 await admin.query(await read('tests/fixtures/reviewed-undialed-recording-foundation.sql'));
 await admin.query(await read('tests/fixtures/voice-predial-settle-baseline.sql'));
 const original=await read('config/required-call-recording.sql');
 const events=original.slice(original.indexOf('create table icash_recording_private.events ('),original.indexOf('-- Exact allowlists'))
  .replace('create function icash_recording_private.audit_immutable()','create or replace function icash_recording_private.audit_immutable()');
 await admin.query(events);
 const direct=await read('config/direct-recorded-outbound.sql');
 await admin.query(definition(direct,'icash_recording_private.guard'));
 // Apply the actual guard-only final-clock patch, preserving its literal prerequisite.
 const finalClock=await read('config/required-call-recording-final-clock.sql');
 const guardPatch=finalClock.slice(finalClock.indexOf('do $patch$'),finalClock.indexOf(" definition:=pg_get_functiondef('public.icash_transition_call_recording"));
 await admin.query(guardPatch+'end $patch$;');
 await admin.query(definition(direct,'public.icash_transition_call_recording'));
 const migration=await read('config/reviewed-undialed-recording.sql');
 assert(await read('supabase/migrations/20261115212701_reviewed_undialed_recording.sql')===migration,'The installed migration and reviewed SQL must match byte for byte');
 await admin.query(migration);
 assert.equal(await value(admin,"select md5(pg_get_functiondef('public.icash_settle_operation(text,bigint,bigint,text)'::regprocedure))"),'c2eb9850afe01778577ccfce5838f33b');
}

// Exact synthetic review construction is below; production reviews are private
// operator evidence and cannot be inserted by the service role.
let sequence=100;
async function seed(options={}){
 const n=sequence++,f=await value(admin,'select public.fixture_predial_seed($1)',[n]);
 await admin.query('update public.icash_accounts set bot_paused=false where id=$1',[f.account]);
 f.recording=uid(n);f.review=uid(n+10000);
 const began=new Date(Date.now()-3600000),created=new Date(began.getTime()+1000),logged=new Date(began.getTime()+2000),completed=new Date(began.getTime()+3000);
 await admin.query('insert into public.icash_wallets(account_id,balance_cents,reserved_cents) values($1,4000,0) on conflict do nothing',[f.account]);
 await admin.query('update public.icash_operation_spend set dispatched_at=$2 where operation_key=$1',[f.operation,began]);
 await admin.query("update public.icash_automation_tickets set state='held',outcome='provider_outcome_unknown_no_retry',created_at=$2::timestamptz-interval '1 second',expires_at=$2::timestamptz+interval '2 minutes',completed_at=$3 where id=$1",[f.ticket,began,completed]);
 await admin.query(`insert into public.icash_call_recordings(id,account_id,operation_key,voice_job_id,entry_policy,party,
 provider_account_sid,nonce_hash,stop_token_hash,disclosure_version,pricing_policy,from_phone,to_phone,
 branch_id,version_id,permission_id,screening_id,contact_key,agent_id,rate_id,charge_cap_cents,max_total_seconds,
 created_at,consent_deadline_at,updated_at,next_reconcile_at)
 select $1,j.account_id,j.operation_key,j.id,'direct_recorded_v1','seller','AC'||repeat('a',32),repeat('b',64),repeat('c',64),
 'fixture-disclosure','{}','+12025550101','+12025550102','agtbrch_fixture','agtvrsn_fixture',j.id,j.id,repeat('d',64),'agent_fixture',
 o.rate_id,o.charge_cap_cents,600,$2,$2::timestamptz+interval '2 minutes',$2,clock_timestamp()
 from public.icash_voice_jobs j join public.icash_operation_spend o on o.operation_key=j.operation_key where j.id=$3`,[f.recording,created,f.job]);
 await admin.query(`insert into icash_recording_private.capacity_quarantines(operation_key,account_id,voice_job_id,recording_id,contact_key,reason,evidence)
 values($1,$2,$3,$4,repeat('d',64),'expired_unstarted_recording','{"retryAllowed":false,"financialHold":"unchanged","providerOutcome":"unknown","dialClaimedAt":null}')`,[f.operation,f.account,f.job,f.recording]);
 await housekeeping(f);
 if(options.historyVersions>2)await admin.query('select public.fixture_undialed_housekeeping($1,$2)',[f.recording,options.historyVersions-2]);
 const proof={version:'original-dial-claim-log-v1',event:'recording_dispatch_held',stage:'dial_claim',recordingId:f.recording,
  holdSaved:false,reason:'provider_or_database_outcome_unknown',requestId:'fixture-request-123456',deploymentId:'dpl_synthetic123456789',
  commitSha:'b'.repeat(40),occurredAt:logged.toISOString(),logSha256:sha,sourceSha256:sha,historyInvariantSha256:sha,...options.proof};
 if(options.review!==false){
  await admin.query(`insert into icash_recording_private.undialed_reviews(id,recording_id,account_id,operation_key,job_id,ticket_id,dispatched_at,reviewed_row_version,
   events_sha256,recording_sha256,operation_sha256,job_sha256,ticket_sha256,quarantine_sha256,database_definitions,source_evidence)
   select $1,r.id,r.account_id,r.operation_key,r.voice_job_id,t.id,o.dispatched_at,r.row_version,
   coalesce($4,icash_recording_private.undialed_hash((select jsonb_agg(to_jsonb(e) order by row_version) from icash_recording_private.events e where e.recording_id=r.id))),
   icash_recording_private.undialed_hash(icash_recording_private.undialed_recording_snapshot(to_jsonb(r))),
   icash_recording_private.undialed_hash(icash_recording_private.undialed_operation_snapshot(to_jsonb(o))),
   icash_recording_private.undialed_hash(to_jsonb(j)),icash_recording_private.undialed_hash(to_jsonb(t)),icash_recording_private.undialed_hash(to_jsonb(q)),
   jsonb_build_object('guard',md5(pg_get_functiondef('icash_recording_private.guard()'::regprocedure)),
    'audit',md5(pg_get_functiondef('icash_recording_private.audit()'::regprocedure)),
    'immutable',md5(pg_get_functiondef('icash_recording_private.audit_immutable()'::regprocedure)),
    'transition',md5(pg_get_functiondef('public.icash_transition_call_recording(uuid,uuid,text,text,text,jsonb)'::regprocedure)),
    'finishCredit',md5(pg_get_functiondef('public.icash_finish_credit(uuid,text,bigint,text)'::regprocedure)),
    'margin',md5(pg_get_functiondef('public.icash_account_margin_ok(uuid,bigint,bigint,boolean)'::regprocedure)),
    'settle',md5(pg_get_functiondef('public.icash_settle_operation(text,bigint,bigint,text)'::regprocedure))),$3
   from public.icash_call_recordings r join public.icash_operation_spend o on o.operation_key=r.operation_key
   join public.icash_voice_jobs j on j.id=r.voice_job_id join public.icash_automation_tickets t on t.voice_job_id=j.id
   join icash_recording_private.capacity_quarantines q on q.operation_key=o.operation_key where r.id=$2`,[f.review,f.recording,proof,options.eventsHash??null]);
  if(options.activation!==false)await admin.query('insert into icash_recording_private.undialed_activations(review_id,enabled,release_sha,expires_at) values($1,$2,$3,clock_timestamp()+interval \'1 hour\')',[f.review,options.enabled!==false,release]);
 }
 return f;
}

async function refused(f,action=()=>finish(f)){
 const before=await financial(f),quarantine=await value(admin,'select to_jsonb(q) from icash_recording_private.capacity_quarantines q where operation_key=$1',[f.operation]);
 assert.equal(await action(),false);
 assert.deepEqual(await financial(f),before);
 assert.equal(await value(admin,'select count(*)::int from icash_recording_private.undialed_receipts where review_id=$1',[f.review]),0);
 assert.deepEqual(await value(admin,'select to_jsonb(q) from icash_recording_private.capacity_quarantines q where operation_key=$1',[f.operation]),quarantine);
}

async function tests(){
 for(const options of [{review:false},{activation:false},{enabled:false},{eventsHash:'f'.repeat(64)},
  {proof:{stage:'dial'}},{proof:{recordingId:uid(999999)}},{proof:{holdSaved:true}},
  {proof:{reason:'deadline_exceeded'}},{proof:{logSha256:'bad'}},{proof:{occurredAt:'9999-01-01T00:00:00.000Z'}}])await refused(await seed(options));
 let f=await seed();
 await refused(f,()=>finish(f,admin,[f.review,uid(888888),f.operation,release]));
 await refused(f,()=>finish(f,admin,[f.review,f.account,'voice:'+uid(777777),release]));
 await refused(f,()=>finish(f,admin,[f.review,f.account,f.operation,'e'.repeat(40)]));
 await admin.query("update icash_recording_private.undialed_activations set expires_at=clock_timestamp()-interval '1 second' where review_id=$1",[f.review]);
 await refused(f);

 const mutations=[
  f=>admin.query("update public.icash_call_recordings set dial_claimed_at=clock_timestamp(),row_version=row_version+1,last_action='claim_dial' where id=$1",[f.recording]),
  f=>admin.query("update public.icash_call_recordings set call_sid='CA'||repeat('f',32),row_version=row_version+1,last_action='bind_call' where id=$1",[f.recording]),
  f=>admin.query("update public.icash_call_recordings set reconcile_lease_token=gen_random_uuid(),reconcile_lease_expires_at=clock_timestamp()+interval '1 minute',row_version=row_version+1,last_action='claim_reconcile' where id=$1",[f.recording]),
  f=>admin.query("update public.icash_call_recordings set row_version=row_version+1,last_action='unreviewed_action' where id=$1",[f.recording]),
  f=>admin.query("update public.icash_voice_jobs set provider_call_sid='CA'||repeat('e',32) where id=$1",[f.job]),
  f=>admin.query("update public.icash_credit_reservations set amount_cents=amount_cents+1 where id=$1",[f.reservation]),
  f=>admin.query("update public.icash_credit_reservations set status='released' where id=$1",[f.reservation]),
  f=>admin.query("delete from public.icash_credit_reservations where id=$1",[f.reservation]),
  f=>admin.query("update public.icash_credit_reservations set operation_key='wrong:'||operation_key where id=$1",[f.reservation]),
  f=>admin.query('update public.icash_credit_reservations set account_id=$2 where id=$1',[f.reservation,uid(999998)]),
  f=>admin.query("update public.icash_operation_spend set reserved_micros=reserved_micros+1 where operation_key=$1",[f.operation]),
  f=>admin.query("update public.icash_automation_tickets set state='consumed',completed_at=null where id=$1",[f.ticket]),
  f=>admin.query("insert into public.icash_cost_observations(source_ref) values($1||':late')",[f.operation]),
  f=>admin.query("insert into public.icash_cost_observations(event_key) values($1)",[f.operation]),
  f=>admin.query("insert into public.icash_live_conversations(operation_key) values($1)",[f.operation]),
  f=>admin.query("insert into public.icash_cost_manifests(operation_key) values($1)",[f.operation]),
  f=>admin.query("insert into icash_private.provider_costs(operation_key) values($1)",[f.operation]),
  f=>admin.query("insert into public.icash_usage_coverage(operation_key) values($1)",[f.operation]),
  f=>admin.query("insert into public.icash_credit_ledger(account_id,event_key,kind,delta_cents,evidence_ref) values($1,'usage:'||$2,'usage',0,'synthetic contradiction')",[f.account,f.operation]),
  f=>admin.query("insert into public.icash_recorded_gate_terminal_receipts(recording_id) values($1)",[f.recording]),
  f=>admin.query("insert into icash_recording_private.terminal_cost_receipts(recording_id) values($1)",[f.recording]),
  f=>admin.query("insert into icash_recording_private.call_creation_rejections(recording_id) values($1)",[f.recording]),
  f=>admin.query("insert into icash_recording_private.predial_aborts(operation_key) values($1)",[f.operation]),
 ];
 for(const mutate of mutations){f=await seed();await mutate(f);await refused(f);}
 for(const patch of ['balance_cents=-1','reserved_cents=1']){
  f=await seed();
  try{await admin.query('update public.icash_wallets set '+patch+' where account_id=$1',[f.account]);await refused(f);}
  finally{await admin.query('update public.icash_wallets set balance_cents=4000,reserved_cents=0 where account_id=$1',[f.account]);}
 }

 f=await seed();
 await admin.query('alter table icash_recording_private.events disable trigger icash_recording_audit_immutable');
 await admin.query('delete from icash_recording_private.events where recording_id=$1 and row_version=1',[f.recording]);
 await admin.query('alter table icash_recording_private.events enable trigger icash_recording_audit_immutable');
 await refused(f);
 f=await seed();await admin.query('alter table public.icash_call_recordings disable trigger icash_recording_audit');
 await refused(f);await admin.query('alter table public.icash_call_recordings enable trigger icash_recording_audit');
 f=await seed();const originalMargin=await value(admin,"select pg_get_functiondef('public.icash_account_margin_ok(uuid,bigint,bigint,boolean)'::regprocedure)");
 await admin.query('create or replace function public.icash_account_margin_ok(uuid,bigint,bigint,boolean) returns boolean language sql as $$select true$$');
 await refused(f);await admin.query(originalMargin);

 f=await seed();await housekeeping(f);await housekeeping(f);
 const quarantine=await value(admin,'select to_jsonb(q) from icash_recording_private.capacity_quarantines q where operation_key=$1',[f.operation]);
 await admin.query('update public.icash_accounts set bot_paused=true where id=$1',[f.account]);
 const before=await financial(f),budget=await value(admin,'select to_jsonb(b) from public.icash_operating_budget b where id=1');
 const concurrent=await Promise.all(Array.from({length:8},(_,i)=>connect('parallel-'+i)));
 const competing=await Promise.allSettled(Array.from({length:24},(_,i)=>finish(f,concurrent[i%8])));
 assert(competing.some(r=>r.status==='fulfilled'&&r.value===true));
 for(const r of competing)if(r.status==='rejected')assert.equal(r.reason.code,'55P03');else assert.equal(r.value,true);
 for(const db of concurrent)assert.equal(await finish(f,db),true,'A completed exact original remains idempotent after contention');
 const after=await financial(f);
 assert.equal(after.operation.state,'settled');assert.equal(after.operation.actual_micros,0);assert.equal(after.operation.charged_cents,0);
 assert.equal(after.credit.status,'released');assert.equal(after.credit.settled_cents,null);
 assert.deepEqual(after.wallet,before.wallet);assert.deepEqual(after.usage,[]);assert.deepEqual(after.coverage,[]);
 assert.equal(after.operation.cost_basis,before.operation.cost_basis,'Pre-provider proof does not invent a complete-cost classification');
 assert.equal(await value(admin,'select count(*)::int from public.icash_cost_manifests where operation_key=$1',[f.operation]),0);
 assert.equal(Number(budget.reserved_micros)-Number(await value(admin,'select reserved_micros::text from public.icash_operating_budget where id=1')),1000000);
 assert.equal(await value(admin,'select spent_micros::text from public.icash_operating_budget where id=1'),String(budget.spent_micros),'Supplier spent is unchanged');
 assert.equal(await value(admin,'select count(*)::int from icash_recording_private.undialed_receipts where review_id=$1',[f.review]),1);
 assert.equal(await value(admin,'select bot_paused from public.icash_accounts where id=$1',[f.account]),true);
 assert.deepEqual(await value(admin,'select to_jsonb(q) from icash_recording_private.capacity_quarantines q where operation_key=$1',[f.operation]),quarantine);
 assert.equal(await claim(f),null,'The original recording cannot be dialed after finalization');
 await assert.rejects(()=>admin.query('delete from icash_recording_private.undialed_receipts where review_id=$1',[f.review]),/append only/i);
 await assert.rejects(()=>admin.query('update icash_recording_private.undialed_reviews set reviewed_row_version=1 where id=$1',[f.review]),/append only/i);

 await admin.query('set role service_role');
 try{
  await assert.rejects(()=>admin.query('insert into icash_recording_private.undialed_reviews(id) values(gen_random_uuid())'),/permission denied/i);
  assert.equal(await finish(f),true,'Only execution is granted to the service role');
 }finally{await admin.query('reset role');}

 f=await seed();await admin.query('update fixture_margin set allowed=false');
 assert.equal(await finish(f),true);
 assert.equal(await value(admin,'select bot_paused from public.icash_accounts where id=$1',[f.account]),true,'Existing margin protection still runs');
 await admin.query('update fixture_margin set allowed=true');

 // Locks cannot refresh an old repeatable snapshot. A genuine conflicting
 // receipt commits after the snapshot, and the finalizer must refuse at entry.
 f=await seed();await worker.query('begin isolation level repeatable read');
 try{
  await worker.query('select count(*) from public.icash_cost_observations');
  await admin.query('insert into public.icash_cost_observations(source_ref) values($1||\':after-old-snapshot\')',[f.operation]);
  await refused(f,()=>finish(f,worker));
 }finally{await worker.query('rollback');}
 f=await seed();await worker.query('begin isolation level serializable');
 try{await refused(f,()=>finish(f,worker));}finally{await worker.query('rollback');}

 f=await seed({historyVersions:3370});
 assert.equal(await value(admin,'select count(*)::int from icash_recording_private.events where recording_id=$1',[f.recording]),3370);
 const began=Date.now();assert.equal(await finish(f),true);
 console.log(`PASS native synthetic 3,370-event history finalized in ${Date.now()-began}ms; no production latency claim.`);

 f=await seed();const lateBefore=await financial(f);
 assert.equal(await beforeFinalizer(f,db=>db.query('insert into public.icash_cost_observations(source_ref) values($1||\':late\')',[f.operation])),false);
 assert.deepEqual(await financial(f),lateBefore);

 // Model an original claim authorized before expiry whose transaction completes
 // late. Only the fixture clock changes; provider calls never occur.
 await admin.query("create or replace function icash_recording_private.clock_now() returns timestamptz language sql volatile as $$select clock_timestamp()-interval '1 hour'$$");
 f=await seed();assert.equal(await beforeFinalizer(f,async db=>assert(await claim(f,db))),false);
 await admin.query("create or replace function icash_recording_private.clock_now() returns timestamptz language sql volatile as $$select clock_timestamp()$$");
 await refused(f);
 f=await seed();
 await blocker.query('begin');
 try{
  assert.equal(await finish(f,blocker),true);
  const pending=claim(f,worker);await waitForLock('undialed-review-worker');
  await blocker.query('commit');assert.equal(await pending,null);
 }catch(error){await blocker.query('rollback');throw error;}

 f=await seed();await blocker.query('begin');
 try{
  assert.equal(await finish(f,blocker),true);
  const late=worker.query('insert into public.icash_cost_observations(source_ref) values($1||\':late-after-finalization\')',[f.operation]);
  await waitForLock('undialed-review-worker');await blocker.query('commit');await late;
  const settled=await financial(f);assert.equal(await finish(f),false,'A real late receipt remains visible and prevents a stale success claim');
  assert.deepEqual(await financial(f),settled);
  assert.equal(await value(admin,'select count(*)::int from icash_recording_private.undialed_receipts where review_id=$1',[f.review]),1);
  assert.equal(await value(admin,"select count(*)::int from public.icash_cost_observations where source_ref=$1||':late-after-finalization'",[f.operation]),1);
 }catch(error){await blocker.query('rollback');throw error;}

 f=await seed();const rollbackBefore=await financial(f);
 await admin.query(`create function fixture_fail_undialed() returns trigger language plpgsql as $$begin if new.outcome='original_handler_never_dialed' then raise exception 'SYNTHETIC_FINAL_WRITE_FAILURE';end if;return new;end$$;
 create trigger fixture_fail_undialed before update on public.icash_voice_jobs for each row execute function fixture_fail_undialed()`);
 await assert.rejects(()=>finish(f),/SYNTHETIC_FINAL_WRITE_FAILURE/);
 assert.deepEqual(await financial(f),rollbackBefore);
 assert.equal(await value(admin,'select count(*)::int from icash_recording_private.undialed_receipts where review_id=$1',[f.review]),0);
 await admin.query('drop trigger fixture_fail_undialed on public.icash_voice_jobs;drop function fixture_fail_undialed()');
 console.log('PASS native reviewed undialed recovery: original proof/ACL/refusal checks, immutable history prefix with housekeeping, 24 competing finalizers settle once, late claim and receipt races, rollback and no replay.');
}

try{
 admin=await connect('admin');blocker=await connect('blocker');worker=await connect('worker');
 await setup();
 await tests();
}catch(error){console.error(error.stack,error.where??'');process.exitCode=1;}
finally{await Promise.allSettled(clients.map(c=>c.end()));}
