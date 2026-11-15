// Native deadline and lock proof on the fixed disposable localhost database.
// Synthetic original sources only; no provider requests or customer operations.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {baseSql,stepSql,continuationSql,checkingSql,read} from '../tests/helpers/owner-expired-checking-fixture.mjs';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';

const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const clients=[],signature='public.icash_continue_expired_owner_preflight_ticket()';
const deadlineSql=read('config/owner-expired-ticket-deadlines.sql');
const version='20261115131828',digest=createHash('md5').update(deadlineSql).digest('hex');
const connect=async name=>{
 const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',application_name:'expired-deadline-'+name,connectionTimeoutMillis:5000});
 clients.push(c);await c.connect();await assertDisposablePostgresTarget(c);
 await c.query("set statement_timeout='8s';set lock_timeout='1s';set timezone='UTC'");return c;
};
const value=async(c,sql,args=[])=>Object.values((await c.query(sql,args)).rows[0]??{})[0];
const run=c=>value(c,'select public.icash_continue_expired_owner_preflight_ticket()');
const seed=(c,n,checking=true,age=120,retry=60)=>value(c,'select public.fixture_deadline_seed($1,$2,$3,$4)',[n,checking,age,retry]);
const journalCount=c=>value(c,'select count(*)::int from icash_research_private.expired_preflight_ticket_continuations');
const promptly=async fn=>{const start=performance.now(),result=await fn();assert(performance.now()-start<1000,'Contended continuation must return promptly');return result;};
const definition=c=>value(c,'select pg_get_functiondef($1::regprocedure)',[signature]);
const planSummary=plan=>({executionMs:plan['Execution Time'],rows:plan.Plan['Actual Rows'],estimatedCost:plan.Plan['Total Cost'],sharedHits:plan.Plan['Shared Hit Blocks'],sharedReads:plan.Plan['Shared Read Blocks']});
const policies=c=>value(c,`select jsonb_build_object(
 'step',(select to_jsonb(p) from icash_work_private.preflight_step_policy p where id=1),
 'base',(select to_jsonb(p) from icash_research_private.expired_preflight_ticket_policy p where id=1),
 'checking',(select to_jsonb(p) from icash_research_private.expired_checking_policy p where id=1))`);
const original=(c,source)=>value(c,`select jsonb_build_object(
 'preflight',(select to_jsonb(p) from icash_research_private.owner_export_preflights p where id=$1),
 'ticket',(select to_jsonb(t) from public.icash_automation_tickets t where id=$2),
 'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]'::jsonb) from icash_research_private.requests r where account_id=$3),
 'deferral',(select to_jsonb(d) from icash_research_private.owner_preflight_quota_deferrals d where preflight_id=$1))`,[source.preflight,source.ticket,source.account]);
const history=c=>value(c,`select jsonb_build_object(
 'continuations',(select coalesce(jsonb_agg(to_jsonb(j) order by ticket_id),'[]'::jsonb) from icash_research_private.expired_preflight_ticket_continuations j),
 'proofs',(select coalesce(jsonb_agg(to_jsonb(p) order by ticket_id),'[]'::jsonb) from icash_research_private.expired_checking_proofs p),
 'recoveries',(select coalesce(jsonb_agg(to_jsonb(r) order by ticket_id),'[]'::jsonb) from public.icash_owner_enrichment_recoveries r))`);

try{
 assert.equal(deadlineSql,read('supabase/migrations/'+version+'_owner_expired_ticket_deadlines.sql'));
 const admin=await connect('admin'),blocker=await connect('blocker'),worker=await connect('worker'),migrator=await connect('migrator');
 await admin.query('drop schema if exists icash_work_private cascade;drop schema if exists icash_private cascade;drop schema if exists icash_research_private cascade;drop schema if exists icash_owner_review_private cascade;drop schema public cascade;create schema public');
 await admin.query(baseSql);
 await admin.query('begin;'+stepSql+continuationSql+checkingSql+'commit;');
 for(const activation of ['icash_work_private.activate_preflight_step_capacity','icash_research_private.activate_expired_preflight_ticket_continuation','icash_research_private.activate_expired_checking_continuation']){
  assert.equal(await value(admin,`select ${activation}(repeat('b',40))`),true);
 }
 await admin.query(`create table public.fixture_deadline_migration_ledger(version text primary key,sql_digest text not null);
 create function public.fixture_deadline_seed(n integer,checking boolean,age_minutes integer,retry_minutes integer) returns jsonb language plpgsql as $$
 declare c jsonb;begin
  if checking then c:=public.fixture_expired_checking_seed(n);else c:=public.fixture_expired_ticket_seed(n);end if;
  -- Only synthetic fixture construction changes age/deadline. The installed
  -- migration and every continuation must preserve these original values.
  alter table icash_research_private.owner_export_preflights disable trigger owner_preflight_immutable;
  update icash_research_private.owner_export_preflights set created_at=now()-make_interval(mins=>age_minutes) where id=(c->>'preflight')::uuid;
  alter table icash_research_private.owner_export_preflights enable trigger owner_preflight_immutable;
  update public.icash_automation_tickets set owner_preview_retry_until=now()+make_interval(mins=>retry_minutes) where id=(c->>'ticket')::uuid;
  if icash_research_private.expired_preflight_ticket_current((c->>'ticket')::uuid,(c->>'preflight')::uuid) is distinct from true then raise exception 'Synthetic deadline source is not eligible';end if;
  return c;
 end$$;`);
 await worker.query('set role service_role');
 // Preserve an existing enabled policy and completed original journal through
 // both a failed ledger transaction and the successful deadline-only upgrade.
 const prior=await seed(admin,21001);assert.equal((await run(worker)).ticketId,prior.ticket);
 const priorSource=await original(admin,prior),priorHistory=await history(admin),priorPolicies=await policies(admin),priorDefinition=await definition(admin);
 const priorAcl=await value(admin,'select proacl::text from pg_proc where oid=$1::regprocedure',[signature]);
 await admin.query('begin');await admin.query(deadlineSql);
 await assert.rejects(admin.query('select 1/0 as simulated_final_ledger_failure'),/division by zero/);
 await admin.query('rollback');
 assert.equal(await definition(admin),priorDefinition);
 assert.deepEqual(await policies(admin),priorPolicies);
 assert.deepEqual(await history(admin),priorHistory);
 assert.equal(await value(admin,'select count(*)::int from public.fixture_deadline_migration_ledger'),0);

 // The real migration must wait behind the same budget lock as live repairs.
 // Observe PostgreSQL's blocker identity, rather than inferring from a sleep.
 await blocker.query('begin;select 1 from public.icash_operating_budget where id=1 for update');
 await migrator.query('begin');
 const install=migrator.query(deadlineSql).then(()=>({ok:true}),error=>({ok:false,error}));
 try{
  const start=performance.now();let waiting=false;
  while(performance.now()-start<1500){
   waiting=await value(admin,'select $1::integer=any(pg_blocking_pids($2::integer))',[blocker.processID,migrator.processID]);
   if(waiting)break;await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.equal(waiting,true,'Deadline migration serializes behind the operating-budget row');
  assert.equal(await definition(admin),priorDefinition,'Blocked migration cannot expose the new function early');
  assert.deepEqual(await policies(admin),priorPolicies,'Blocked migration cannot expose partial manifests');
 }finally{await blocker.query('rollback');}
 const installed=await install;assert.equal(installed.ok,true,installed.error?.message);
 await migrator.query('insert into public.fixture_deadline_migration_ledger values($1,$2)',[version,digest]);
 await migrator.query('commit');
 const nextDefinition=await definition(admin),nextPolicies=await policies(admin);
 assert.equal(nextDefinition,priorDefinition.replace('order by preflight_row.created_at,preflight_row.id limit 8 loop',"order by least(ticket_row.owner_preview_retry_until,preflight_row.created_at+interval '24 hours'),preflight_row.created_at,preflight_row.id,ticket_row.id limit 8 loop"));
 const nextHash=await value(admin,'select md5(pg_get_functiondef($1::regprocedure))',[signature]);
 const expectedPolicies=structuredClone(priorPolicies);
 for(const key of ['base','checking'])expectedPolicies[key].function_hashes[signature]=nextHash;
 assert.deepEqual(nextPolicies,expectedPolicies,'Only the two reviewed function hashes change; enabled, release, activation, triggers and step policy survive');
 assert.equal(await value(admin,'select proacl::text from pg_proc where oid=$1::regprocedure',[signature]),priorAcl);
 assert.deepEqual(await history(admin),priorHistory,'Original journals, proofs and recovery approvals survive migration unchanged');
 assert.deepEqual(await original(admin,prior),priorSource);
 assert.equal(await value(admin,'select sql_digest from public.fixture_deadline_migration_ledger where version=$1',[version]),digest);

 // A later-created checking source with the shorter original retry deadline
 // goes first; its waiting sibling and 24-hour source deadline remain bounded.
 const older=await seed(admin,21002,false,240,90),urgent=await seed(admin,21003,true,120,10);
 const urgentBefore=await original(admin,urgent);
 assert.equal((await run(worker)).ticketId,urgent.ticket);
 assert.equal(await journalCount(admin),2,'One successful continuation per maintenance invocation');
 const urgentAfter=await original(admin,urgent);
 const expectedUrgent=structuredClone(urgentBefore);
 expectedUrgent.ticket.outcome=urgentAfter.ticket.outcome;
 expectedUrgent.ticket.owner_preview_retry_after=urgentAfter.ticket.owner_preview_retry_after;
 assert.deepEqual(urgentAfter,expectedUrgent,'Original source, receipts, token, expiry, retry-until and deferral count are immutable');
 assert.deepEqual(await value(admin,'select before_ticket from icash_research_private.expired_preflight_ticket_continuations where ticket_id=$1',[urgent.ticket]),urgentBefore.ticket);
 assert.equal((await run(worker)).ticketId,older.ticket);
 const retryFirst=await seed(admin,21004,true,120,20),sourceFirst=await seed(admin,21005,false,1430,120);
 assert.equal((await run(worker)).ticketId,sourceFirst.ticket,'The original 24-hour source expiry can be earlier than ticket retry-until');
 assert.equal((await run(worker)).ticketId,retryFirst.ticket);

 // The deadline-first candidate may be advisory-locked or row-locked. The
 // next deadline still beats an older source with a less urgent retry window.
 for(const [offset,lock] of [[10,'advisory'],[20,'row']]){
  const old=await seed(admin,21000+offset,false,240,90),first=await seed(admin,21001+offset,true,120,10),second=await seed(admin,21002+offset,false,180,20);
  await blocker.query('begin');
  if(lock==='advisory')await blocker.query("select pg_advisory_xact_lock(hashtextextended('owner-preflight:'||$1::uuid,0))",[first.account]);
  else await blocker.query('select 1 from icash_research_private.owner_export_preflights where id=$1 for update',[first.preflight]);
  try{assert.equal((await promptly(()=>run(worker))).ticketId,second.ticket,lock+' lock skips only the earliest deadline');}
  finally{await blocker.query('rollback');}
  assert.equal((await run(worker)).ticketId,first.ticket);
  assert.equal((await run(worker)).ticketId,old.ticket);
 }

 // Lock all eight selected candidates. A free ninth candidate must not expand
 // the maintenance budget; after unlock each call still admits exactly one.
 const bounded=[];for(let i=0;i<9;i++)bounded.push(await seed(admin,21100+i,i%2===0,120,10+i));
 const beforeBound=await journalCount(admin);
 await blocker.query('begin');
 for(const source of bounded.slice(0,8))await blocker.query("select pg_advisory_xact_lock(hashtextextended('owner-preflight:'||$1::uuid,0))",[source.account]);
 try{assert.equal((await promptly(()=>run(worker))).status,'busy');assert.equal(await journalCount(admin),beforeBound,'The ninth source cannot bypass the eight-candidate bound');}
 finally{await blocker.query('rollback');}
 for(const source of bounded){const before=await journalCount(admin);assert.equal((await run(worker)).ticketId,source.ticket);assert.equal(await journalCount(admin),before+1);}

 const contested=await seed(admin,21200),contestedBefore=await original(admin,contested),beforeRace=await journalCount(admin);
 const contenders=await Promise.all(Array.from({length:12},(_,i)=>connect('claim-'+i)));
 await Promise.all(contenders.map(c=>c.query('set role service_role')));
 const raced=await Promise.all(contenders.map(run));
 assert.equal(raced.filter(r=>r.status==='continued').length,1,'Twelve concurrent claimants continue one original ticket once');
 assert.equal(await journalCount(admin),beforeRace+1);
 assert.equal(await value(admin,'select count(*)::int from icash_research_private.expired_checking_proofs where ticket_id=$1',[contested.ticket]),1);
 assert.deepEqual(await value(admin,'select before_ticket from icash_research_private.expired_preflight_ticket_continuations where ticket_id=$1',[contested.ticket]),contestedBefore.ticket);
 assert.equal((await run(worker)).status,'idle');

 // Pause wins even when the account has the earliest immutable deadline.
 const paused=await seed(admin,21201,true,120,10),afterPause=await seed(admin,21202,false,240,20),pausedBefore=await original(admin,paused);
 await blocker.query('begin;select 1 from public.icash_operating_budget where id=1 for update');
 await blocker.query('update public.icash_accounts set bot_paused=true where id=$1',[paused.account]);
 try{assert.equal((await promptly(()=>run(worker))).status,'busy');}finally{await blocker.query('commit');}
 assert.equal((await run(worker)).ticketId,afterPause.ticket);
 assert.equal((await run(worker)).status,'idle');
 assert.deepEqual(await original(admin,paused),pausedBefore,'Pause preserves every original source and ticket field');

 // Measure the actual selector separately for 31 waiting and 31 checking
 // sources, then verify each full continuation and its single-result budget.
 const selector=nextDefinition.slice(nextDefinition.indexOf('for candidate in ')+17,nextDefinition.indexOf(' limit 8 loop')+8);
 for(const [checking,base] of [[false,21300],[true,21400]]){
  const cohort=[];for(let i=0;i<31;i++)cohort.push(await seed(admin,base+i,checking,120,70-i));
  const cohortPlan=(await value(admin,'explain (analyze,buffers,format json) '+selector))[0];
  assert.equal(cohortPlan.Plan['Actual Rows'],8,'The real selector returns at most eight eligible candidates');
  const cohortBefore=await journalCount(admin),cohortStart=performance.now();
  assert.equal((await run(worker)).ticketId,cohort[30].ticket);
  const cohortMs=performance.now()-cohortStart;
  assert.equal(await journalCount(admin),cohortBefore+1,'A 31-source cohort still continues only one ticket per invocation');
  for(const source of cohort.slice(0,30).reverse())assert.equal((await run(worker)).ticketId,source.ticket);
  console.log(`Native 31-source ${checking?'checking':'waiting'} deadline selector:`,JSON.stringify({...planSummary(cohortPlan),continuationMs:Math.round(cohortMs)}));
 }

 // Keep the existing waiting-family backlog shape: 2,000 paused sources plus
 // 1,000 active sources rejected only after proof at the restrictive quote.
 await admin.query("set statement_timeout='30s'");
 try{await admin.query(`do $$declare c jsonb;n integer;begin
  for n in 22000..23999 loop
   c:=public.fixture_expired_ticket_seed(n);
   update public.icash_accounts set bot_paused=true where id=(c->>'account')::uuid;
  end loop;
  for n in 24000..24999 loop
   c:=public.fixture_expired_ticket_seed(n);
   update public.icash_automation_tickets set prospecting_quote_cents=1 where id=(c->>'ticket')::uuid;
  end loop;
 end$$;`);}finally{await admin.query("set statement_timeout='8s'");}
 const later=await seed(admin,25000,false),requestsBefore=await value(admin,'select count(*)::int from icash_research_private.requests');
 // Bulk fixture insertion outruns autovacuum. Collect normal table statistics
 // explicitly before comparing the identical old/new selector workloads; no
 // speculative index or relaxed runtime timeout is part of this rehearsal.
 await admin.query('analyze');
 const oldSelector=priorDefinition.slice(priorDefinition.indexOf('for candidate in ')+17,priorDefinition.indexOf(' limit 8 loop')+8);
 const oldPlan=(await value(admin,'explain (analyze,buffers,format json) '+oldSelector))[0];
 const deadlinePlan=(await value(admin,'explain (analyze,buffers,format json) '+selector))[0];
 assert.equal(oldPlan.Plan['Actual Rows'],1);assert.equal(deadlinePlan.Plan['Actual Rows'],1);
 console.log('Native analyzed 3,000 waiting-source selectors:',JSON.stringify({fifo:planSummary(oldPlan),deadline:planSummary(deadlinePlan)}));
 const scanStart=performance.now();
 assert.equal((await run(worker)).ticketId,later.ticket);
 const scanMs=performance.now()-scanStart;
 assert(scanMs<8000,'3,000 excluded waiting sources must fit the unchanged eight-second database deadline');
 assert.equal(await value(admin,'select count(*)::int from icash_research_private.expired_preflight_ticket_continuations c join public.icash_automation_tickets t on t.id=c.ticket_id join public.icash_accounts a on a.id=t.account_id where a.bot_paused or t.prospecting_quote_cents=1'),0);
 assert.equal(await value(admin,'select count(*)::int from icash_research_private.requests'),requestsBefore,'Continuation never creates a provider request');
 assert.equal(await value(admin,'select count(*)::int from public.icash_operation_spend'),0);
 assert.equal(await value(admin,'select count(*)::int from public.icash_credit_reservations'),0);
 assert.equal(await value(admin,'select count(*)::int from icash_research_private.owner_preflight_cleanup_admissions'),0);
 assert.deepEqual(await policies(admin),nextPolicies,'Scheduling does not change activation or policy manifests');
 console.log(`PASS native expired-ticket deadlines: atomic ledger rollback, real budget serialization, preserved activation/source journals, earliest retry/source deadlines, advisory and row-lock skip, eight-candidate/one-cycle bounds, twelve claimants, late Pause and 3,000 analyzed blocked waiting sources in ${Math.round(scanMs)}ms; no provider or paid work.`);
}finally{
 await Promise.allSettled(clients.map(c=>c.query('rollback')));
 await Promise.allSettled(clients.map(c=>c.end()));
}
