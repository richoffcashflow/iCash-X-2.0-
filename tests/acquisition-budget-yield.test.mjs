import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {installBudgetYieldFixture,migration,migrationPath,predecessorHash,definition,policies,catalog,snapshot,
 assertOnlySchedulerHashesChanged,seedOrdinary,seedContinued,lane,value,read} from './helpers/acquisition-budget-yield-fixture.mjs';
const p=new PGlite(),v=(s,a=[])=>value(p,s,a);
const isolated=async fn=>{await p.exec('begin');try{return await fn();}finally{await p.exec('rollback');}};
try{
 assert.equal(migration,read(migrationPath));
 await installBudgetYieldFixture(p);
 const beforeDefinition=await definition(p),beforePolicies=await policies(p),beforeCatalog=await catalog(p);
 assert.equal(createHash('md5').update(beforeDefinition).digest('hex'),predecessorHash);
 const rejected=[
  "update icash_work_private.continuation_policy set scheduler_hash=repeat('0',32)",
  "update icash_work_private.preflight_step_policy set function_hashes=function_hashes-'public.icash_next_acquisition()'",
  "update icash_work_private.preflight_step_policy set function_hashes=function_hashes||jsonb_build_object('unexpected',repeat('0',32))",
  "update icash_research_private.acquisition_headroom_policy set acquisition_hash=repeat('0',32)",
  ...['icash_work_private.continuation_policy','icash_work_private.preflight_step_policy','icash_research_private.acquisition_headroom_policy'].flatMap(table=>[
   `update ${table} set enabled=false`,
   `update ${table} set enabled=false,activated_at=null,release_sha=null`,
  ]),
  'grant execute on function public.icash_next_acquisition() to authenticated',
  'alter function public.icash_next_acquisition() security definer',
  "create or replace function public.icash_next_acquisition() returns jsonb language sql as $$select null::jsonb$$",
  ...[
   ['icash_work_private.continuation_policy','new.issued:=new.issued+1'],
   ['icash_work_private.preflight_step_policy',"new.function_hashes:=new.function_hashes||jsonb_build_object('unrelated',repeat('0',32))"],
   ['icash_research_private.acquisition_headroom_policy',"new.release_sha:=repeat('c',40)"],
  ].map(([table,change])=>`create function public.fixture_policy_drift() returns trigger language plpgsql as $$begin ${change};return new;end$$;
   create trigger fixture_policy_drift before update on ${table} for each row execute function public.fixture_policy_drift();`),
 ];
 for(const mutation of rejected){
  await p.exec('begin');await p.exec(mutation);
  await assert.rejects(p.exec(migration),/Acquisition budget yield/);await p.exec('rollback');
  assert.equal(await definition(p),beforeDefinition);assert.deepEqual(await policies(p),beforePolicies);
 }
 // Failed ledger insertion must roll back both definition and all hash slots.
 await p.exec('begin');await p.exec(migration);
 await assert.rejects(p.exec('select 1/0 as synthetic_migration_ledger_failure'),/division by zero/);
 await p.exec('rollback');assert.equal(await definition(p),beforeDefinition);assert.deepEqual(await policies(p),beforePolicies);
 await p.exec('begin;'+migration+'commit;');
 const afterDefinition=await definition(p),afterHash=createHash('md5').update(afterDefinition).digest('hex');
 const needle='perform 1 from public.icash_operating_budget where id=1 and enabled for update;';
 assert.equal(afterDefinition,beforeDefinition.replace(needle,needle.replace('for update;','for update skip locked;')),
  'Only the initial lock acquisition changes; every selector, control, cap and final gate is byte-identical');
 assertOnlySchedulerHashesChanged(beforePolicies,await policies(p),afterHash);
 const afterCatalog=await catalog(p),expected=structuredClone(beforeCatalog);
 expected['public.icash_next_acquisition()'].definition=afterDefinition;
 assert.deepEqual(afterCatalog,expected,'All other function definitions, owners and ACLs survive');
 for(const role of ['anon','authenticated'])assert.equal(await v("select has_function_privilege($1,'public.icash_next_acquisition()','execute')",[role]),false);
 await isolated(async()=>{
  const c=await seedOrdinary(p,91001),before=await snapshot(p);
  await p.exec('set local role service_role');const selected=await lane(p,'research');assert(selected?.token);
  assert.equal(await v('select account_id from public.icash_automation_tickets where token=$1',[selected.token]),c.account);
  await p.exec('reset role');assert.equal(await v('select count(*)::int from icash_work_private.continuation_decisions'),1);
  assert.equal((await policies(p)).fair.issued,before.fairness[0].issued+1);
  assert.deepEqual((await snapshot(p)).operations,before.operations);
  assert.deepEqual((await snapshot(p)).requests,before.requests);
 });
 const controlCases=[
  ['Pause',c=>p.query('update public.icash_accounts set bot_paused=true where id=$1',[c.account])],
  ['disabled config',c=>p.query('update public.icash_discovery_configs set enabled=false where account_id=$1',[c.account])],
  ['funds',c=>p.query('update public.icash_wallets set reserved_cents=balance_cents where account_id=$1',[c.account])],
  ['disabled budget',()=>p.exec('update public.icash_operating_budget set enabled=false where id=1')],
 ];
 for(let i=0;i<controlCases.length;i++)await isolated(async()=>{
  const c=await seedOrdinary(p,91100+i);await controlCases[i][1](c);const before=await snapshot(p);
  assert.equal(await lane(p,'research'),null,controlCases[i][0]);
  assert.deepEqual(await snapshot(p),before,controlCases[i][0]+' cannot issue a ticket or change fairness/money');
 });
 await isolated(async()=>{
  const c1=await seedContinued(p,91200,{deadlineMinutes:10}),c2=await seedContinued(p,91201,{deadlineMinutes:20}),ordinary=await seedOrdinary(p,91202);
  await p.exec('update icash_work_private.continuation_policy set issued=0');
  const selected=[];
  for(let i=0;i<3;i++)selected.push(await lane(p,'research'));
  const accounts=await Promise.all(selected.map(t=>v('select account_id from public.icash_automation_tickets where token=$1',[t.token])));
  assert.deepEqual(accounts,[c1.account,c2.account,ordinary.account],'Existing two continuation / one ordinary turn order survives');
 });
 console.log('PASS acquisition budget yield: exact one-line patch, activated manifest rejection/rollback, only three hash slots changed, real research and fairness, unchanged Pause/funds/config/budget controls and private ACLs.');
}catch(e){console.error(e.stack,e.where??'');process.exitCode=1;}finally{await p.close();}
