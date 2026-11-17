import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {installSingleStateFixture,migration,migrationPath,read,value,signature,definition,policy,evidence,sources,
 instrumentReserveReads,countReserveReads} from './helpers/acquisition-capacity-single-state-fixture.mjs';
const p=await PGlite.create(),v=(s,a=[])=>value(p,s,a);
const isolated=async fn=>{await p.exec('begin');try{await fn();}finally{await p.exec('rollback');}};
try{
 assert.equal(migration,read(migrationPath));
 await installSingleStateFixture(p);
 const before=await definition(p),beforePolicy=await policy(p),beforeEvidence=await evidence(p);
 await isolated(async()=>{
  await p.exec('update public.icash_dealmachine_request_budget set day_used=4000');
  const restore=await instrumentReserveReads(p);
  assert.equal(await countReserveReads(p,'icash_acquisition_capacity_available'),200,'Original wrapper rereads stable global reserve state for every eligible account');
  await restore();
 });
 const rejected=[
  "update icash_research_private.acquisition_headroom_policy set capacity_hash=repeat('0',32)",
  "update icash_research_private.acquisition_headroom_policy set acquisition_hash=repeat('0',32)",
  "update icash_research_private.acquisition_headroom_policy set resume_hash=repeat('0',32)",
  'update icash_research_private.acquisition_headroom_policy set enabled=false',
  'delete from public.icash_operating_budget',
  ...sources.flatMap(s=>[
   `grant execute on function ${s.signature} to authenticated`,
   `alter function ${s.signature} volatile`,
   `alter function ${s.signature} set search_path=public`,
   `alter function ${s.signature} security invoker`,
   `alter function ${s.signature} owner to service_role`,
   `alter function ${s.signature} parallel safe`,
   s.definition.replace('begin\n','begin\n -- synthetic source drift\n'),
  ]),
  `create function public.fixture_policy_drift() returns trigger language plpgsql as $$begin new.release_sha:=repeat('b',40);return new;end$$;
   create trigger fixture_policy_drift before update on icash_research_private.acquisition_headroom_policy for each row execute function public.fixture_policy_drift();`,
  `create function public.fixture_policy_drift() returns trigger language plpgsql as $$begin
   execute 'grant execute on function public.icash_acquisition_capacity_available(uuid) to authenticated';return new;end$$;
   create trigger fixture_policy_drift before update on icash_research_private.acquisition_headroom_policy for each row execute function public.fixture_policy_drift();`,
 ];
 for(const change of rejected){
  await p.exec('begin');await p.exec(change);
  await assert.rejects(p.exec(migration),/Acquisition single-state/);await p.exec('rollback');
  assert.equal(await definition(p),before);assert.deepEqual(await policy(p),beforePolicy);
 }
 await p.exec('begin');
 await assert.rejects(p.exec(migration.replaceAll('c8549a105f353bc11b0dcb904bbd8e71','00000000000000000000000000000000')),/Acquisition single-state result changed/);
 await p.exec('rollback');assert.equal(await definition(p),before);assert.deepEqual(await policy(p),beforePolicy);
 await p.exec('begin');await p.exec(migration);
 await assert.rejects(p.exec('select 1/0 as synthetic_migration_ledger_failure'),/division by zero/);
 await p.exec('rollback');assert.equal(await definition(p),before);assert.deepEqual(await policy(p),beforePolicy);
 await p.exec('begin;'+migration+'commit;');
 const after=await definition(p),afterHash=createHash('md5').update(after).digest('hex');
 assert.deepEqual(await policy(p),{...beforePolicy,capacity_hash:afterHash});
 assert.deepEqual(await evidence(p),beforeEvidence,'Migration changes no quota state, request, pacing setting or admission receipt');
 for(const source of sources.filter(s=>s.signature!=='icash_acquisition_capacity_available(uuid)')){
  assert.equal(await v('select pg_get_functiondef($1::regprocedure)',[source.signature]),source.definition,'Shared admission and original private evidence calculations stay byte-identical');
 }
 const old=await v("select public.fixture_reserve_seed(810001,interval '3 days')");
 const fresh=await v("select public.fixture_reserve_seed(810002,interval '1 hour')");
 const changes=[
  '',
  'update icash_research_private.acquisition_headroom_policy set enabled=false',
  'update icash_research_private.request_pacing_policy set enabled=false',
  'update icash_research_private.request_reserve_policy set enabled=false',
  'update public.icash_dealmachine_request_budget set day_used=4000',
  'update public.icash_dealmachine_request_budget set day_used=4668',
  'update public.icash_dealmachine_request_budget set day_used=4670',
  'update public.icash_dealmachine_request_budget set day_used=9800',
  'update public.icash_dealmachine_request_budget set day_used=9799',
  "update public.icash_dealmachine_request_budget set day_start=now()-interval '25 hours'",
  "update public.icash_dealmachine_request_budget set day_start=now()+interval '1 hour'",
  'update public.icash_dealmachine_request_budget set minute_used=58',
  'update public.icash_dealmachine_request_budget set minute_used=59',
  'update public.icash_dealmachine_request_budget set minute_used=60',
  "update public.icash_dealmachine_request_budget set minute_start=now()-interval '2 minutes',minute_used=60",
  "update public.icash_dealmachine_request_budget set minute_start=now()+interval '1 minute'",
  "update icash_research_private.quota_feedback set blocked_until=now()+interval '1 hour'",
  'update public.icash_accounts set bot_paused=true',
  'update public.icash_accounts set membership_allowed=false',
  'update public.icash_accounts set workspace_ack_version=null',
  'update public.icash_wallets set reserved_cents=balance_cents',
  "insert into public.icash_billing_reviews(account_id) select id from public.icash_accounts",
  "insert into public.icash_support_cancel_requests select id,now() from public.icash_accounts",
  'delete from public.icash_dealmachine_request_budget',
 ];
 let comparisons=0;
 for(const change of changes)await isolated(async()=>{
  if(change)await p.exec(change);
  const original=await evidence(p);
  for(const account of [null,old,fresh]){
   const row=(await p.query('select public.fixture_capacity_before($1) before,public.icash_acquisition_capacity_available($1) after',[account])).rows[0];
   assert.equal(row.after,row.before,change+' '+account);comparisons++;
  }
  assert.deepEqual(await evidence(p),original,'Availability reads cannot spend, settle or rewrite quota/source evidence');
 });
 // Explicit malformed/NULL cases exercise the old outer IF NOT behavior. The
 // real state function cannot normally produce these shapes; keep equivalence.
 for(const state of [null,{}, {ordinaryRemaining:null,reserveRemaining:0},
  {ordinaryRemaining:2,pacingActive:true,ordinaryUnpacedRemaining:3,reserveRemaining:0},
  {ordinaryRemaining:2,pacingActive:true,ordinaryUnpacedRemaining:null,reserveRemaining:0}])await isolated(async()=>{
  await p.exec(`create or replace function icash_research_private.request_reserve_state(p_at timestamptz default now()) returns jsonb
   language sql stable security definer set search_path='' as $$select ${state===null?'null::jsonb':"'"+JSON.stringify(state)+"'::jsonb"}$$;`);
  for(const account of [null,old,fresh]){
   const row=(await p.query('select public.fixture_capacity_before($1) before,public.icash_acquisition_capacity_available($1) after',[account])).rows[0];
   assert.equal(row.after,row.before);comparisons++;
  }
 });
 await isolated(async()=>{
  await p.exec('update public.icash_dealmachine_request_budget set day_used=4000');
  const restore=await instrumentReserveReads(p);
  assert.equal(await countReserveReads(p,'fixture_capacity_before'),200);
  assert.equal(await countReserveReads(p,'icash_acquisition_capacity_available'),100,'One state calculation per account, no second count under enabled headroom');
  await restore();
 });
 for(const [change,beforeReads,afterReads] of [
  ['update icash_research_private.acquisition_headroom_policy set enabled=false',100,100],
  ["update icash_research_private.quota_feedback set blocked_until=now()+interval '1 hour'",0,0],
  ['update public.icash_dealmachine_request_budget set minute_used=59',0,0],
  ['update public.icash_dealmachine_request_budget set day_used=9800',0,0],
  ['delete from public.icash_dealmachine_request_budget',0,0],
 ])await isolated(async()=>{
  await p.exec('update public.icash_dealmachine_request_budget set day_used=4000');await p.exec(change);
  const restore=await instrumentReserveReads(p);
  assert.equal(await countReserveReads(p,'fixture_capacity_before'),beforeReads,change);
  assert.equal(await countReserveReads(p,'icash_acquisition_capacity_available'),afterReads,change);
  await restore();
 });
 for(const role of ['anon','authenticated'])assert.equal(await v('select has_function_privilege($1,$2,\'execute\')',[role,signature]),false);
 await p.exec('set role service_role');assert.equal(await v('select public.icash_acquisition_capacity_available($1)',[old]),false);await p.exec('reset role');
 console.log(JSON.stringify({result:'PASS acquisition single-state',afterHash,comparisons,originalStateReads:200,newStateReads:100,sharedAdmissionUnchanged:true}));
}catch(e){console.error(e.stack,e.where??'');process.exitCode=1;}finally{await p.close();}
