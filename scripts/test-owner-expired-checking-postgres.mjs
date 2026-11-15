// Native transactions only, in a fixed disposable localhost database. No providers.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {baseSql,stepSql,continuationSql,checkingSql} from '../tests/helpers/owner-expired-checking-fixture.mjs';
import {rehearseRecoveryStageUpgrade} from '../tests/helpers/owner-recovery-stage-rehearsal.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const database='icash_expired_checking_check',clients=[];
const connect=async(name,db=database)=>{
 const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:db,application_name:'expired-checking-'+name,connectionTimeoutMillis:5000});
 clients.push(c);await c.connect();await c.query("set statement_timeout='8s';set lock_timeout='1s'");return c;
};
const value=async(c,s,a=[])=>Object.values((await c.query(s,a)).rows[0]??{})[0];
const run=c=>value(c,'select public.icash_continue_expired_owner_preflight_ticket()');
const seed=(c,n)=>value(c,'select public.fixture_expired_checking_seed($1)',[n]);
const admit=(c,source,request=randomUUID())=>value(c,'select public.icash_admit_expired_checking_cleanup($1,$2,$3)',[source.account,source.preflight,request]);
const original=(c,source)=>value(c,'select to_jsonb(p) from icash_research_private.owner_export_preflights p where id=$1',[source.preflight]);
const sourceRead=(c,source)=>value(c,'select public.icash_continued_owner_preflight($1,$2,$3::jsonb,false)',[source.account,source.screening,JSON.stringify(source.items)]);
const ordinaryClaim=(c,source,items=source.items,request=source.request)=>value(c,'select public.icash_claim_owner_preflight($1,$2::jsonb,$3::jsonb)',[source.account,JSON.stringify(items),JSON.stringify(request)]);
const terminal={httpStatus:200,raw:{data:{deleted:true}},rawText:'{"data":{"deleted":true}}'};
const record=(c,source,token,receipt=terminal)=>value(c,'select public.icash_record_owner_preflight_cleanup($1,$2,$3::jsonb)',[source.preflight,token,JSON.stringify(receipt)]);
const promptly=async fn=>{const start=performance.now(),r=await fn();assert(performance.now()-start<1000,'Contended continuation must return promptly');return r;};
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

try{
 const bootstrap=await connect('bootstrap','postgres');
 if(!await value(bootstrap,'select exists(select 1 from pg_database where datname=$1)',[database]))await bootstrap.query('create database icash_expired_checking_check');
 const admin=await connect('admin'),blocker=await connect('blocker'),worker=await connect('worker');
 assert.equal(await value(admin,'select current_database()'),database);
 await admin.query('drop schema if exists icash_work_private cascade;drop schema if exists icash_private cascade;drop schema if exists icash_research_private cascade;drop schema if exists icash_owner_review_private cascade;drop schema public cascade;create schema public');
 await admin.query(baseSql);
 assert.equal(stepSql,read('config/owner-preflight-step-capacity.sql'));
 assert.equal(continuationSql,read('config/owner-expired-preflight-ticket-continuation.sql'));
 assert.equal(checkingSql,read('config/owner-expired-checking-continuation.sql'));
 const originalClaim=await value(admin,"select pg_get_functiondef('public.icash_claim_owner_preflight(uuid,jsonb,jsonb)'::regprocedure)");
 const originalCleanup=await value(admin,"select pg_get_functiondef('icash_research_private.owner_preflight_cleanup_current(uuid,uuid)'::regprocedure)");
 const oldConstraint=await value(admin,"select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.icash_owner_enrichment_recoveries'::regclass and conname='icash_owner_enrichment_recoveries_code_stage_check'");
 // Exact ordered migration bytes share the runner's ledger transaction. A
 // failed final ledger write must undo all three policy and source changes.
 await admin.query('begin');
 await admin.query(stepSql);await admin.query(continuationSql);await admin.query(checkingSql);
 await assert.rejects(admin.query('select 1/0 as simulated_final_migration_ledger_failure'),/division by zero/);
 await admin.query('rollback');
 for(const relation of ['icash_work_private.preflight_step_policy','icash_research_private.expired_preflight_ticket_policy','icash_research_private.expired_checking_policy'])assert.equal(await value(admin,'select to_regclass($1)',[relation]),null);
 assert.equal(await value(admin,"select pg_get_functiondef('public.icash_claim_owner_preflight(uuid,jsonb,jsonb)'::regprocedure)"),originalClaim);
 assert.equal(await value(admin,"select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.icash_owner_enrichment_recoveries'::regclass and conname='icash_owner_enrichment_recoveries_code_stage_check'"),oldConstraint);
 // Also reproduce the real separate migration transactions: stage one is
 // already committed disabled, old stage two fails on historical rows, and
 // corrected stage two/three resume without replaying the first migration.
 await rehearseRecoveryStageUpgrade({exec:sql=>admin.query(sql),query:(sql,args)=>admin.query(sql,args)},{stepSql,continuationSql,checkingSql},{beforeStageTwo:async()=>{
  // A live preflight writer can subsequently read its recovery approval. The
  // migration must wait on its original preflight DDL lock before taking the
  // recovery-table lock, rather than creating a reverse-order deadlock.
  await blocker.query('begin;lock table icash_research_private.owner_export_preflights in row exclusive mode');
  await worker.query('begin');
  const started=performance.now(),install=worker.query(continuationSql).then(()=>({ok:true}),error=>({ok:false,error}));
  try{
   let waiting=false;
   while(performance.now()-started<1500){
    waiting=await value(admin,"select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='expired-checking-worker' and not l.granted and l.relation='icash_research_private.owner_export_preflights'::regclass)");
    if(waiting)break;await new Promise(resolve=>setTimeout(resolve,20));
   }
   assert.equal(waiting,true,'Migration waits on the preflight relation before recovery history');
   await blocker.query("set local statement_timeout='1s'");
   assert.equal(await value(blocker,'select count(*)::int from public.icash_owner_enrichment_recoveries'),86,'Original writer can read recovery history while migration waits');
  }finally{await blocker.query('rollback');}
  const installed=await install;await worker.query('rollback');
  assert.equal(installed.ok,true,installed.error?.code+' '+installed.error?.message);
  assert(performance.now()-started<6000,'Contended staging remains inside its bounded lock window');
 }});
 assert.equal(await value(admin,"select pg_get_functiondef('icash_research_private.owner_preflight_cleanup_current(uuid,uuid)'::regprocedure)"),originalCleanup,'Active waiting cleanup authority is unchanged');
 const pending=await seed(admin,11101),before=await original(admin,pending);
 assert.equal((await run(worker)).status,'disabled');
 assert.equal(await value(admin,"select icash_work_private.activate_preflight_step_capacity(repeat('b',40))"),true);
 assert.equal(await value(admin,"select icash_research_private.activate_expired_preflight_ticket_continuation(repeat('b',40))"),true);
 assert.equal((await run(worker)).status,'idle','Disabled overlay does not repair the checking family');
 assert.deepEqual(await original(admin,pending),before);
 const contenders=await Promise.all(Array.from({length:12},(_,i)=>connect('race-'+i)));
 const activated=await Promise.all(contenders.map(c=>value(c,"select icash_research_private.activate_expired_checking_continuation(repeat('b',40))")));
 assert.equal(activated.filter(Boolean).length,1,'Exactly one administrative overlay activation');
 await worker.query('set role service_role');await Promise.all(contenders.map(c=>c.query('set role service_role')));
 const requestCount=await value(admin,'select count(*)::int from icash_research_private.requests');
 const repaired=await Promise.all(contenders.map(run));
 assert.equal(repaired.filter(x=>x.status==='continued').length,1);
 assert.equal(await value(admin,'select count(*)::int from icash_research_private.expired_checking_proofs'),1);
 assert.deepEqual(await original(admin,pending),before,'A repair never changes the expired source, baseline or eligible handler');
 assert.equal(await value(admin,'select count(*)::int from icash_research_private.requests'),requestCount,'Repair creates no provider request');
 assert.equal(await value(admin,'select count(*)::int from public.icash_operation_spend'),0,'Repair creates no paid operation');
 assert.equal((await sourceRead(worker,pending)).cleanupRequired,true);
 // Quota refusal must not consume the cleanup attempt or original lease.
 await admin.query('update public.fixture_cleanup_policy set quota=false');
 assert.equal((await admit(worker,pending)).status,'quota_wait');
 assert.equal((await original(admin,pending)).cleanup_attempts,0);
 assert.equal(await value(admin,'select count(*)::int from icash_research_private.owner_preflight_cleanup_admissions where preflight_id=$1',[pending.preflight]),0);
 await admin.query('update public.fixture_cleanup_policy set quota=true');
 const cleanupRaces=await Promise.all(contenders.map(c=>admit(c,pending)));
 const accepted=cleanupRaces.filter(x=>x.status==='admitted');assert.equal(accepted.length,1);
 assert.equal((await original(admin,pending)).cleanup_attempts,1);
 assert.equal(await value(admin,'select count(*)::int from icash_research_private.owner_preflight_cleanup_admissions where preflight_id=$1',[pending.preflight]),1);
 assert.equal((await admit(worker,pending)).status,'held','An original unknown cleanup never receives another admission');
 assert.equal(await record(worker,pending,accepted[0].token),true);
 assert.equal((await sourceRead(worker,pending)).cleanupRequired,false);
 assert.equal((await ordinaryClaim(worker,pending)).status,'create','Canonical original deletion permits normal fresh generation');

 // An account advisory lock on the oldest source cannot starve another one.
 const oldest=await seed(admin,11102),next=await seed(admin,11103);
 await blocker.query('begin');await blocker.query("select pg_advisory_xact_lock(hashtextextended('owner-preflight:'||$1::uuid,0))",[oldest.account]);
 try{assert.equal((await promptly(()=>run(worker))).ticketId,next.ticket);}finally{await blocker.query('rollback');}
 assert.equal((await run(worker)).ticketId,oldest.ticket);

 // Late Pause and conflicting original-eligible projections win the shared
 // budget lock before the proof is rechecked, retaining the original hold.
 const paused=await seed(admin,11104);
 await blocker.query('begin');await blocker.query('select 1 from public.icash_operating_budget where id=1 for update');
 await blocker.query('update public.icash_accounts set bot_paused=true where id=$1',[paused.account]);
 try{assert.equal((await promptly(()=>run(worker))).status,'busy');}finally{await blocker.query('commit');}
 assert.equal((await run(worker)).status,'idle');
 const conflicted=await seed(admin,11105);
 await blocker.query('begin');await blocker.query('select 1 from public.icash_operating_budget where id=1 for update');
 await blocker.query("insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,result) values($1,'owner_preview',$2,$3,null,null)",[randomUUID(),conflicted.account,'owner-preflight:'+conflicted.preflight+':eligible']);
 try{assert.equal((await promptly(()=>run(worker))).status,'busy');}finally{await blocker.query('commit');}
 assert.equal((await run(worker)).status,'idle','An additional unknown eligible request is not a zero-cost refusal');
 assert.equal(await value(admin,'select icash_research_private.expired_checking_original_proof($1)',[conflicted.preflight]),null);

 // Global FIFO cleanup may win first. Keep its original token and canonical
 // terminal receipt; neither the repair nor normal renewal repeats DELETE.
 const fifo=await seed(admin,11106);
 await blocker.query('begin');const fifoClaim=await value(blocker,'select public.icash_claim_owner_preflight_cleanup($1)',[fifo.preflight]);assert(fifoClaim);
 try{assert.equal((await promptly(()=>run(worker))).status,'busy');assert.equal(await record(blocker,fifo,fifoClaim.token),true);}finally{await blocker.query('commit');}
 assert.equal((await run(worker)).ticketId,fifo.ticket);
 assert.equal((await sourceRead(worker,fifo)).cleanupRequired,false);
 assert.equal((await ordinaryClaim(worker,fifo)).status,'create');
 const unknown=await seed(admin,11107),unknownClaim=await value(admin,'select public.icash_claim_owner_preflight_cleanup($1)',[unknown.preflight]);
 await record(admin,unknown,unknownClaim.token,{httpStatus:null,raw:null,rawText:null});
 assert.equal((await run(worker)).status,'idle','Unknown global cleanup is preserved without reenrollment');

 // A late Pause also prevents a journaled source's provider cleanup admission.
 const cleanupPause=await seed(admin,11108);assert.equal((await run(worker)).ticketId,cleanupPause.ticket);
 await blocker.query('begin');await blocker.query('select 1 from public.icash_operating_budget where id=1 for update');
 await blocker.query('update public.icash_accounts set bot_paused=true where id=$1',[cleanupPause.account]);
 try{assert.equal((await promptly(()=>admit(worker,cleanupPause))).status,'pending');}finally{await blocker.query('commit');}
 assert.equal((await admit(worker,cleanupPause)).status,'held');assert.equal((await original(admin,cleanupPause)).cleanup_attempts,0);

 // Permanently excluded historical rows cannot consume the bounded eight-row
 // repair scan or hide a later eligible account behind expired-source history.
 await admin.query("set statement_timeout='30s'");
 try{
  await admin.query(`do $$declare c jsonb;n integer;begin
   for n in 12000..12999 loop
    c:=public.fixture_expired_checking_seed(n);
    update public.icash_accounts set bot_paused=true where id=(c->>'account')::uuid;
   end loop;
  end$$;`);
 }finally{await admin.query("set statement_timeout='8s'");}
 const later=await seed(admin,13001),scanStart=performance.now();
 assert.equal((await run(worker)).ticketId,later.ticket);
 assert(performance.now()-scanStart<3000,'1000 paused checking sources must not block a later eligible original');
 // These active sources retain valid original denial/baseline proof and fail
 // only at the restrictive quoted cap after that evidence has been checked.
 // This exercises the costly filter before LIMIT, not only cheap Pause joins.
 await admin.query("set statement_timeout='30s'");
 try{await admin.query(`do $$declare c jsonb;n integer;begin
  for n in 14000..14999 loop
   c:=public.fixture_expired_checking_seed(n);
   update public.icash_automation_tickets set prospecting_quote_cents=1 where id=(c->>'ticket')::uuid;
  end loop;
 end$$;`);}finally{await admin.query("set statement_timeout='8s'");}
 const afterActive=await seed(admin,15001),activeStart=performance.now();
 assert.equal((await run(worker)).ticketId,afterActive.ticket);
 assert(performance.now()-activeStart<3000,'1000 active late-rejected checking sources must not hide the later eligible ticket');
 assert.equal(await value(admin,'select count(*)::int from icash_research_private.expired_checking_proofs p join public.icash_automation_tickets t on t.id=p.ticket_id where t.prospecting_quote_cents=1'),0);

 // Rollback prevents new repairs while durable source/financial fences remain.
 const rollbackSource=await seed(admin,11109);assert.equal((await run(worker)).ticketId,rollbackSource.ticket);
 const unrepaired=await seed(admin,11110),proofCount=await value(admin,'select count(*)::int from icash_research_private.expired_checking_proofs');
 await admin.query('begin;select 1 from public.icash_operating_budget where id=1 for update;update icash_research_private.expired_checking_policy set enabled=false;commit;');
 assert.equal((await run(worker)).status,'idle');
 assert.equal(await value(admin,'select count(*)::int from icash_research_private.expired_checking_proofs'),proofCount);
 assert.equal(await value(admin,'select count(*)::int from icash_research_private.expired_checking_proofs where ticket_id=$1',[unrepaired.ticket]),0);
 assert.equal((await sourceRead(worker,rollbackSource)).cleanupRequired,true,'Already journaled source binding survives policy rollback');
 const changedItems=rollbackSource.items.map(x=>({...x,ids:['per_999999']})),changedRequest={...rollbackSource.request,people_ids:['per_999999']};
 await assert.rejects(ordinaryClaim(worker,rollbackSource,changedItems,changedRequest),/Original continued preflight cleanup required/,'Old application cannot bypass source cleanup with a fresh fingerprint');
 const rollbackAdmission=await admit(worker,rollbackSource);assert.equal(rollbackAdmission.status,'admitted','Already journaled safe cleanup can finish after disabling new repairs');
 assert.equal(await record(worker,rollbackSource,rollbackAdmission.token),true);
 assert.equal((await ordinaryClaim(worker,rollbackSource,changedItems,changedRequest)).status,'create');
 assert.equal(await value(admin,'select count(*)::int from public.icash_operation_spend'),0);
 console.log('PASS native expired checking continuation: exact three-migration atomic rollback, one-time activation, 12 repair/cleanup claimants, quota-before-attempt, lock fairness, late Pause, conflicting unknown request, global cleanup, immutable rollback source fence and no paid/provider work.');
}finally{await Promise.allSettled(clients.map(async c=>{try{await c.query('rollback');}finally{await c.end();}}));}
