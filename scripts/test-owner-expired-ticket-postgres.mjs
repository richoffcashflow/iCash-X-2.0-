// Native concurrency proof. Fixed disposable localhost target only; no providers.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fixtureSql,stepPrerequisites,stepSql,continuationSql} from '../tests/helpers/owner-expired-ticket-fixture.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const database='icash_expired_ticket_check',clients=[];
const connect=async(name,db=database)=>{
 const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:db,application_name:'expired-ticket-'+name,connectionTimeoutMillis:5000});
 clients.push(c);await c.connect();await c.query("set statement_timeout='8s';set lock_timeout='1s'");return c;
};
const value=async(c,s,a=[])=>Object.values((await c.query(s,a)).rows[0]??{})[0];
const run=c=>value(c,'select public.icash_continue_expired_owner_preflight_ticket()');
const seed=(c,n)=>value(c,'select fixture_expired_ticket_seed($1)',[n]);
const promptly=async fn=>{const start=performance.now();const r=await fn();assert(performance.now()-start<1000,'Contended recovery must return promptly');return r;};
try{
 const bootstrap=await connect('bootstrap','postgres');
 if(!await value(bootstrap,'select exists(select 1 from pg_database where datname=$1)',[database]))await bootstrap.query('create database icash_expired_ticket_check');
 const admin=await connect('admin'),blocker=await connect('blocker'),worker=await connect('worker');
 assert.equal(await value(admin,'select current_database()'),database);
 await admin.query('drop schema if exists icash_work_private cascade;drop schema if exists icash_private cascade;drop schema if exists icash_research_private cascade;drop schema if exists icash_owner_review_private cascade;drop schema public cascade;create schema public');
 await admin.query(fixtureSql+stepPrerequisites);
 await admin.query('begin;'+stepSql+'commit;');
 assert.equal(await value(admin,"select icash_work_private.activate_preflight_step_capacity(repeat('c',40))"),true);
 const originalConstraint=await value(admin,"select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.icash_owner_enrichment_recoveries'::regclass and conname='icash_owner_enrichment_recoveries_code_stage_check'");
 await admin.query('begin');
 await admin.query(continuationSql);
 await assert.rejects(admin.query('select 1/0 as simulated_migration_ledger_failure'),/division by zero/);
 await admin.query('rollback');
 assert.equal(await value(admin,"select to_regclass('icash_research_private.expired_preflight_ticket_policy')"),null);
 assert.equal(await value(admin,"select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.icash_owner_enrichment_recoveries'::regclass and conname='icash_owner_enrichment_recoveries_code_stage_check'"),originalConstraint);
 await admin.query('begin;'+continuationSql+'commit;');
 assert.equal((await run(worker)).status,'disabled');
 const contenders=await Promise.all(Array.from({length:12},(_,i)=>connect('race-'+i)));
 const activation=await Promise.all(contenders.map(c=>value(c,"select icash_research_private.activate_expired_preflight_ticket_continuation(repeat('b',40))")));
 assert.equal(activation.filter(Boolean).length,1,'Exactly one administrative activation');
 await worker.query('set role service_role');
 await Promise.all(contenders.map(c=>c.query('set role service_role')));
 const c=await seed(admin,8101);
 const original=await value(admin,'select to_jsonb(p) from icash_research_private.owner_export_preflights p where id=$1',[c.preflight]);
 const raced=await Promise.all(contenders.map(run));
 assert.equal(raced.filter(x=>x.status==='continued').length,1);
 assert.equal(await value(admin,'select count(*)::int from icash_research_private.expired_preflight_ticket_continuations'),1);
 assert.deepEqual(await value(admin,'select to_jsonb(p) from icash_research_private.owner_export_preflights p where id=$1',[c.preflight]),original);
 assert.equal(await value(admin,'select count(*)::int from icash_research_private.requests'),0);
 assert.equal(await value(admin,'select count(*)::int from public.icash_operation_spend'),0);
 // A locked oldest account may not block the next independently eligible one.
 const first=await seed(admin,8102),second=await seed(admin,8103);
 await blocker.query('begin');await blocker.query("select pg_advisory_xact_lock(hashtextextended('owner-preflight:'||$1::uuid,0))",[first.account]);
 try{const result=await promptly(()=>run(worker));assert.equal(result.status,'continued');assert.equal(result.ticketId,second.ticket);}
 finally{await blocker.query('rollback');}
 assert.equal((await run(worker)).ticketId,first.ticket);
 // Nonblocking row locks also skip oldest and release their subtransaction's
 // locks, allowing an independent account to make progress in the same cycle.
 const rowFirst=await seed(admin,8104),rowSecond=await seed(admin,8105);
 await blocker.query('begin');await blocker.query('select 1 from icash_research_private.owner_export_preflights where id=$1 for update',[rowFirst.preflight]);
 try{const result=await promptly(()=>run(worker));assert.equal(result.ticketId,rowSecond.ticket);}
 finally{await blocker.query('rollback');}
 assert.equal((await run(worker)).ticketId,rowFirst.ticket);
 // A Pause that holds the same budget lock wins before original proof recheck.
 const paused=await seed(admin,8106);
 await blocker.query('begin');await blocker.query('select 1 from icash_operating_budget where id=1 for update');
 await blocker.query('update icash_accounts set bot_paused=true where id=$1',[paused.account]);
 try{assert.equal((await promptly(()=>run(worker))).status,'busy');}finally{await blocker.query('commit');}
 assert.equal((await run(worker)).status,'idle');
 assert.equal(await value(admin,'select outcome from icash_automation_tickets where id=$1',[paused.ticket]),'held');
 // Actual global cleanup is allowed to race; only its exact terminal receipt
 // lets the continuation hand back to ordinary renewal without another DELETE.
 const cleanup=await seed(admin,8107);
 await blocker.query('begin');
 const claim=await value(blocker,'select icash_claim_owner_preflight_cleanup($1)',[cleanup.preflight]);
 assert(claim);
 try{assert.equal((await promptly(()=>run(worker))).status,'busy');
  assert.equal(await value(blocker,'select icash_record_owner_preflight_cleanup($1,$2,$3::jsonb)',[cleanup.preflight,claim.token,JSON.stringify({httpStatus:200,raw:{data:{deleted:true}},rawText:'{"data":{"deleted":true}}'})]),true);
 }finally{await blocker.query('commit');}
 assert.equal((await run(worker)).ticketId,cleanup.ticket);
 // Many permanently excluded sources do not prevent a later eligible source.
 for(let n=8200;n<10200;n++){const blocked=await seed(admin,n);await admin.query('update icash_accounts set bot_paused=true where id=$1',[blocked.account]);}
 const last=await seed(admin,10201),start=performance.now();
 assert.equal((await run(worker)).ticketId,last.ticket);
 assert(performance.now()-start<3000,'2000 blocked original sources must fit the bounded collection window');
 // Active sources also reach the expensive original-source proof before the
 // final restrictive quote rejects them. Cheap Pause filtering alone does not
 // demonstrate bounded progress past this near-eligible backlog.
 await admin.query("set statement_timeout='30s'");
 try{await admin.query(`do $$declare c jsonb;n integer;begin
  for n in 14000..14999 loop
   c:=public.fixture_expired_ticket_seed(n);
   update public.icash_automation_tickets set prospecting_quote_cents=1 where id=(c->>'ticket')::uuid;
  end loop;
 end$$;`);}finally{await admin.query("set statement_timeout='8s'");}
 const afterActive=await seed(admin,15001),activeStart=performance.now();
 assert.equal((await run(worker)).ticketId,afterActive.ticket);
 assert(performance.now()-activeStart<3000,'1000 active late-rejected original sources must not hide the later eligible ticket');
 assert.equal(await value(admin,'select count(*)::int from icash_research_private.expired_preflight_ticket_continuations c join public.icash_automation_tickets t on t.id=c.ticket_id where t.prospecting_quote_cents=1'),0);
 // Policy rollback serializes before any new repair and retains all journals.
 const disabled=await seed(admin,10202),count=await value(admin,'select count(*)::int from icash_research_private.expired_preflight_ticket_continuations');
 await admin.query("begin;select 1 from icash_operating_budget where id=1 for update;update icash_research_private.expired_preflight_ticket_policy set enabled=false where id=1;commit;");
 assert.equal((await run(worker)).status,'disabled');
 assert.equal(await value(admin,'select outcome from icash_automation_tickets where id=$1',[disabled.ticket]),'held');
 assert.equal(await value(admin,'select count(*)::int from icash_research_private.expired_preflight_ticket_continuations'),count);
 console.log('PASS native expired-ticket continuation: migration rollback, one-time activation, 12 claimants, locked-oldest fairness, late Pause, canonical cleanup race, bounded blocked backlog, rollback and no provider or paid work.');
}finally{await Promise.allSettled(clients.map(async c=>{try{await c.query('rollback');}finally{await c.end();}}));}
