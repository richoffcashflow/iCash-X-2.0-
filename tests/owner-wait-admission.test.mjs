import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {installOwnerWaitFixture,seedLive,seedContinued,seedOrdinary,seedWaitBatch,issue,source,original,decisions,value,read,resetScoreCalls,scoreCalls,recordWait,waitRow,candidateExists,beforeCandidate,evidence} from './helpers/owner-wait-admission-fixture.mjs';
const p=new PGlite(),q=(s,a=[])=>p.query(s,a),v=(s,a=[])=>value(p,s,a);
const isolated=async fn=>{await p.exec('begin');try{return await fn();}finally{await p.exec('rollback');}};
const busy=()=>q("insert into icash_research_private.owner_exports(request,terminal_at,capacity_review_id) values('{}',null,null)");
const migration=()=>read('config/owner-wait-admission.sql');
const definition=signature=>v('select pg_get_functiondef($1::regprocedure)',[signature]);
const unchanged=['public.icash_next_acquisition()','public.icash_enrichment_before_prospecting_budget(uuid)',
 'public.icash_enrichment_before_provider_quota(uuid)','public.icash_owner_preflight_due_at(uuid,uuid)',
 'icash_work_private.owner_preflight_step_due(uuid)','public.icash_dealmachine_capacity_available(integer,uuid)',
 'public.icash_acquisition_capacity_available(uuid)','public.icash_claim_owner_preflight(uuid,jsonb,jsonb)',
 'public.icash_guard_owner_enrichment_recovery_credit()','public.icash_guard_owner_enrichment_recovery_spend()'];
try{
 await installOwnerWaitFixture(p);
 await isolated(async()=>{
  const c=await seedLive(p,51000);await q('update public.fixture_cleanup_policy set ordinary=2,starter=0');
  const before=await original(p,c),preflight=await source(p,c),money=await evidence(p);
  assert.equal(await v('select icash_work_private.owner_preflight_step_due($1)',[c.account]),true);
  assert.equal(await issue(p),null,'Actual wait bookkeeping overrides an otherwise eligible two-request phase');
  assert(await waitRow(p,c));assert.equal(await v('select next_run_at>now() from public.icash_discovery_configs where account_id=$1',[c.account]),true);
  assert.deepEqual(await original(p,c),before);assert.deepEqual(await source(p,c),preflight);assert.deepEqual(await evidence(p),money);
 });
 await isolated(async()=>{
  const c=await seedWaitBatch(p,51001);await busy();await resetScoreCalls(p);
  assert.equal(await recordWait(p,c),true);assert.equal(await scoreCalls(p),200,'The old existence check executes all200 ranking scores');
 });
 const beforeDefinitions=Object.fromEntries(await Promise.all(unchanged.map(async s=>[s,await definition(s)]))),oldWait=await definition('icash_work_private.record_export_wait(uuid,timestamptz)');
 await p.exec('begin');
 await p.exec('alter function icash_work_private.owner_preflight_step_due(uuid) owner to anon');
 await assert.rejects(p.exec(migration()),/Owner wait admission prerequisite changed/);
 await p.exec('rollback');
 assert.equal(await v("select pg_get_userbyid(proowner) from pg_proc where oid='icash_work_private.owner_preflight_step_due(uuid)'::regprocedure"),'postgres');
 assert.equal(await v("select to_regprocedure('icash_work_private.owner_enrichment_wait_candidate(uuid)')"),null);
 await p.exec('begin');await p.exec(migration());await assert.rejects(p.exec('select 1/0 as migration_ledger_failure'),/division by zero/);await p.exec('rollback');
 assert.equal(await definition('icash_work_private.record_export_wait(uuid,timestamptz)'),oldWait);
 assert.equal(await v("select to_regprocedure('icash_work_private.owner_enrichment_wait_candidate(uuid)')"),null);
 await p.exec('begin;'+migration()+'commit;');assert.equal(migration(),read('supabase/migrations/20261115143000_owner_wait_admission.sql'));
 for(const [s,d] of Object.entries(beforeDefinitions))assert.equal(await definition(s),d,'Ranking/admission unchanged: '+s);
 // The fixture installed the first two migrations; verify all connected
 // acquisition cases with the complete four-migration release in order.
 const eligibility=read('config/owner-expired-checking-eligibility.sql');
 assert.equal(eligibility,read('supabase/migrations/20261115150210_owner_expired_checking_eligibility.sql'));
 await p.exec('begin;'+eligibility+'commit;');
 await isolated(async()=>{
  const c=await seedLive(p,51100);await q('update public.fixture_cleanup_policy set ordinary=2,starter=0');
  const before=await original(p,c),preflight=await source(p,c),money=await evidence(p);
  const selected=await issue(p);assert.equal(selected.id,c.ticket);assert.notEqual(selected.token,before.token);
  for(const k of ['owner_preview_retry_until','owner_preview_deferrals','owner_preview_screening_hash','issue_attempts'])assert.equal(selected[k],before[k]);
  assert.equal(await waitRow(p,c),undefined);assert.deepEqual(await source(p,c),preflight);assert.deepEqual(await evidence(p),money);
  assert.equal((await decisions(p))[0].preflight_id,c.preflight);
 });
 for(const turn of [0,2])for(const tokens of [0,2,3])for(const kind of ['live','ordinary','cleaned'])await isolated(async()=>{
  const n=51200+turn*100+tokens*10+['live','ordinary','cleaned'].indexOf(kind);
  const c=kind==='live'?await seedLive(p,n):kind==='cleaned'?await seedContinued(p,n):await seedOrdinary(p,n);
  await q('update public.fixture_cleanup_policy set ordinary=$1,starter=0',[tokens]);await q('update icash_work_private.continuation_policy set issued=$1',[turn]);
  const before=kind==='ordinary'?null:await original(p,c),money=await evidence(p);
  const allowed=tokens===3||tokens===2&&kind==='live'&&turn===0,selected=await issue(p);
  assert.equal(Boolean(selected),allowed,`${kind}:turn${turn},tokens${tokens}`);
  if(allowed&&kind!=='ordinary')assert.equal(selected.id,c.ticket);
  if(!allowed&&before)assert.deepEqual(await original(p,c),before);
  assert.equal(await waitRow(p,c),undefined);assert.deepEqual(await evidence(p),money);
 });
 for(const kind of ['live','cleaned','ordinary'])await isolated(async()=>{
  const c=kind==='live'?await seedLive(p,51500):kind==='cleaned'?await seedContinued(p,51501):await seedOrdinary(p,51502);
  await busy();const money=await evidence(p);await resetScoreCalls(p);
  assert.equal(await v('select icash_work_private.owner_preflight_step_due($1)',[c.account]),false);
  assert.equal(await recordWait(p,c),true,'An export-busy source cannot borrow the two-step bypass');
  assert(await waitRow(p,c));assert.equal(await scoreCalls(p),0);assert.deepEqual(await evidence(p),money);
 });
 for(const mutate of [
  c=>q('update public.icash_accounts set bot_paused=true where id=$1',[c.account]),
  c=>q('update public.icash_wallets set reserved_cents=balance_cents where account_id=$1',[c.account]),
  c=>q("update public.icash_screening_jobs set snapshot=jsonb_set(snapshot,'{propertyId}','\"prop_changed\"') where id=$1",[c.screening]),
  c=>q('insert into icash_private.provider_costs values($1)',[`owners:${c.account}:${c.screening}`]),
  c=>q("update public.icash_automation_tickets set outcome='held_for_reconciliation' where id=$1",[c.ticket]),
 ])await isolated(async()=>{
  const c=await seedLive(p,51600);await q('update public.fixture_cleanup_policy set ordinary=2,starter=0');await mutate(c);
  const before=await original(p,c),preflight=await source(p,c),money=await evidence(p);
  assert.equal(await issue(p),null);assert.deepEqual(await original(p,c),before);assert.deepEqual(await source(p,c),preflight);assert.deepEqual(await evidence(p),money);
 });
 await isolated(async()=>{
  const c=await seedWaitBatch(p,51700),money=await evidence(p);await busy();
  const conditions=[
   ['unchanged',()=>Promise.resolve()],
   ['no financial eligibility',()=>q("update public.icash_screening_jobs set result='{}' where account_id=$1",[c.account])],
   ['manual properties',()=>q("insert into public.icash_property_controls(account_id,property_id,manual) select account_id,snapshot->>'propertyId',true from public.icash_screening_jobs where account_id=$1",[c.account])],
   ['exhausted funds',()=>q('update public.icash_wallets set reserved_cents=balance_cents where account_id=$1',[c.account])],
   ['stale evidence',()=>q("update public.icash_screening_jobs set completed_at=now()-interval '25 hours' where account_id=$1",[c.account])],
   ['wrong property type',()=>q("update public.icash_screening_jobs set snapshot=jsonb_set(snapshot,'{propertyType}','\"land\"') where account_id=$1",[c.account])],
   ['seller-request family',()=>q("update public.icash_screening_jobs set snapshot=jsonb_set(snapshot,'{sellerRequest}','{}') where account_id=$1",[c.account])],
   ['outreach wait',()=>p.exec("create or replace function public.icash_research_waiting_on_outreach(uuid) returns boolean language sql stable as $$select true$$")],
   ['missing contact rate',()=>q('update public.icash_discovery_configs set contact_rate_id=null where account_id=$1',[c.account])],
  ];
  for(const [name,mutate] of conditions){
   await p.exec('savepoint eligibility_case');await mutate();
   const expected=(await beforeCandidate(p,c))!==null;await resetScoreCalls(p);
   assert.equal(await candidateExists(p,c),expected,name+' preserves exact actual eligibility');assert.equal(await scoreCalls(p),0,name+' never evaluates ranking');
   await p.exec('rollback to eligibility_case');
  }
  await resetScoreCalls(p);assert.equal(await recordWait(p,c),true);assert.equal(await scoreCalls(p),0,'200eligible candidates now require zero ranking-score calls');
  const row=await waitRow(p,c);assert(row);await q("update public.icash_discovery_configs set next_run_at=now()-interval '1 second' where account_id=$1",[c.account]);
  assert.equal(await recordWait(p,c),true);assert.equal((await waitRow(p,c)).waiting_since,row.waiting_since,'Original wait age survives another confirmed wait');
  assert.deepEqual(await evidence(p),money);
 });
 for(const role of ['anon','authenticated'])for(const fn of ['icash_work_private.record_export_wait(uuid,timestamptz)','icash_work_private.owner_enrichment_wait_candidate(uuid)','icash_work_private.owner_enrichment_candidate_exists(uuid)'])assert.equal(await v('select has_function_privilege($1,$2,\'execute\')',[role,fn]),false);
 for(const [s,d] of Object.entries(beforeDefinitions))assert.equal(await definition(s),d);
 console.log('PASS actual wait bookkeeping: reproduced two-token live stall and200discarded scores; connected scheduler, exact unranked eligibility, ordinary/renewal controls, busy/unknown holds, immutable deadlines/money and zero ranking on wait checks.');
}catch(error){console.error(error.stack,error.where??'');process.exitCode=1;}finally{await p.close();}
