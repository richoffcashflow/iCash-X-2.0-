import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {installPriorityFixture,migration,migrationPath,captured,signature,beforeRank,afterRank,
 definition,policies,catalog,snapshot,assertOnlySchedulerHashesChanged,seedOrdinary,seedContinued,
 lane,value,read,budget,operation,priority,oldPriority} from './helpers/research-priority-fixture.mjs';
const p=new PGlite(),v=(s,a=[])=>value(p,s,a);
const isolated=async fn=>{await p.exec('begin');try{return await fn();}finally{await p.exec('rollback');}};
try{
 assert.equal(migration,read(migrationPath));await installPriorityFixture(p);
 const beforeDefinition=await definition(p),beforePolicies=await policies(p),beforeCatalog=await catalog(p);
 for(const mutation of [
  'grant execute on function public.icash_daily_work_target(uuid) to authenticated',
  'alter function public.icash_daily_work_target(uuid) security definer',
  'alter function public.icash_daily_work_target(uuid) volatile',
  "alter function public.icash_daily_work_target(uuid) set search_path='public'",
  "create or replace function public.icash_daily_work_target(p_account uuid) returns jsonb language sql stable as $$select null::jsonb$$",
  'grant execute on function public.icash_next_acquisition() to authenticated',
  'alter function public.icash_next_acquisition() security definer',
  "create or replace function public.icash_next_acquisition() returns jsonb language sql as $$select null::jsonb$$",
  "update icash_work_private.continuation_policy set scheduler_hash=repeat('0',32)",
  "update icash_work_private.preflight_step_policy set function_hashes=function_hashes-'public.icash_next_acquisition()'",
  "update icash_work_private.preflight_step_policy set function_hashes=function_hashes||jsonb_build_object('unexpected',repeat('0',32))",
  "update icash_research_private.acquisition_headroom_policy set acquisition_hash=repeat('0',32)",
  ...['icash_work_private.continuation_policy','icash_work_private.preflight_step_policy','icash_research_private.acquisition_headroom_policy'].map(t=>`update ${t} set enabled=false`),
  ...[['icash_work_private.continuation_policy','new.issued:=new.issued+1'],
   ['icash_work_private.preflight_step_policy',"new.function_hashes:=new.function_hashes||jsonb_build_object('unrelated',repeat('0',32))"],
   ['icash_research_private.acquisition_headroom_policy',"new.release_sha:=repeat('c',40)"]].map(([t,s])=>
   `create function public.fixture_priority_drift() returns trigger language plpgsql as $$begin ${s};return new;end$$;
    create trigger fixture_priority_drift before update on ${t} for each row execute function public.fixture_priority_drift();`),
 ]){
  await p.exec('begin');await p.exec(mutation);await assert.rejects(p.exec(migration),/Research priority/);await p.exec('rollback');
  assert.equal(await definition(p),beforeDefinition);assert.deepEqual(await policies(p),beforePolicies);
  assert.equal(await v('select to_regprocedure($1)',[signature]),null,'Failed patch leaves no helper');
 }
 await p.exec('begin;'+migration);await assert.rejects(p.exec('select 1/0'),/division by zero/);await p.exec('rollback');
 assert.deepEqual(await catalog(p),beforeCatalog);assert.deepEqual(await policies(p),beforePolicies);
 await p.exec('begin;'+migration+'commit;');
 const afterDefinition=await definition(p),afterHash=createHash('md5').update(afterDefinition).digest('hex');
 assert.equal(afterDefinition,beforeDefinition.replace(beforeRank,afterRank),'Only the ranking expression changes');
 assertOnlySchedulerHashesChanged(beforePolicies,await policies(p),afterHash);
 const afterCatalog=await catalog(p),expected=structuredClone(beforeCatalog);
 expected['public.icash_next_acquisition()'].definition=afterDefinition;
 delete afterCatalog[signature];assert.deepEqual(afterCatalog,expected,'All original bodies, owners and ACLs are unchanged');
 assert.equal(await v("select md5(pg_get_functiondef('public.icash_daily_work_target(uuid)'::regprocedure))"),captured.find(f=>f.signature==='public.icash_daily_work_target(uuid)').hash);
 for(const role of ['anon','authenticated'])assert.equal(await v('select has_function_privilege($1,$2,\'execute\')',[role,signature]),false);
 assert.equal(await v('select has_function_privilege(\'service_role\',$1,\'execute\')',[signature]),true);
 assert.deepEqual(await v('select jsonb_build_object(\'stable\',provolatile=\'s\',\'invoker\',not prosecdef,\'path\',proconfig) from pg_proc where oid=$1::regprocedure',[signature]),{stable:true,invoker:true,path:['search_path=""']});
 await isolated(async()=>{
  const c=await seedOrdinary(p,95000),other=await seedOrdinary(p,95001);
  assert.equal(await priority(p,c.account),null);assert.equal(await oldPriority(p,c.account),null);
  // Actual target SQL and new scalar agree across absent/zero/odd/large budgets,
  // multiple funding records, settled time boundaries, coverage and unknowns.
  for(const cents of [null,0,1,2,3,101,1000,9007199254740000]){
   await budget(p,c.account,cents);
   for(const [i,o] of [{charge:0},{charge:1},{charge:150,covered:50},{charge:50,covered:100},
    {charge:500,age:'24 hours'},{charge:700,age:'25 hours'},{charge:800,age:'-1 hour'},
    {state:'dispatched',charge:900,cap:9000},{state:'reserved',charge:900,cap:9000}].entries()){
    const key=`vector-${cents}-${i}`;await operation(p,c.account,key,o);
    assert.equal(await priority(p,c.account),await oldPriority(p,c.account),key);
   }
  }
  await operation(p,other.account,'other-account',{charge:999999});
  const moneyBefore=await snapshot(p);
  assert.equal(await priority(p,c.account),await oldPriority(p,c.account));
  assert.deepEqual(await snapshot(p),moneyBefore,'Ranking never changes original operations, wallets or requests');
 });
 await isolated(async()=>{
  const c=await seedOrdinary(p,95100);await budget(p,c.account,1000);
  await operation(p,c.account,'original-unknown',{state:'dispatched',cap:999999});
  await operation(p,c.account,'actual-use',{charge:125,covered:25});
  await p.exec(`create or replace function icash_reliability_private.pending_planning_cents(o public.icash_operation_spend) returns bigint
   language plpgsql stable as $$begin raise exception 'Synthetic pending-report boundary unavailable';end$$;`);
  await p.exec('savepoint original');await assert.rejects(oldPriority(p,c.account),/pending-report boundary unavailable/);await p.exec('rollback to savepoint original');
  assert.equal(Number(await priority(p,c.account)),0.2,'Scheduler priority is independent of pending-cost reporting');
  const before=await snapshot(p);await p.exec('set local role service_role');
  const t=await lane(p,'research');assert(t?.token);await p.exec('reset role');
  assert.equal(await v('select account_id from public.icash_automation_tickets where token=$1',[t.token]),c.account);
  const after=await snapshot(p);for(const k of ['budget','accounts','wallets','operations','reservations','requests'])assert.deepEqual(after[k],before[k],k);
 });
 await isolated(async()=>{
  const accounts=[];
  for(let i=0;i<7;i++){
   const c=await seedOrdinary(p,95200+i);accounts.push(c);await budget(p,c.account,1000);await operation(p,c.account,'rank-'+i,{charge:(6-i)*50});
  }
  await p.exec("update public.icash_discovery_configs set next_run_at=now()-interval '1 minute'");
  const expected=(await p.query(`select account_id from public.icash_discovery_configs order by ${beforeRank.replaceAll('d.account_id','account_id')},next_run_at,account_id`)).rows[0].account_id;
  const t=await lane(p,'research');assert(t?.token);
  assert.equal(await v('select account_id from public.icash_automation_tickets where token=$1',[t.token]),expected,'Original exact settled-use rank selects same account');
 });
 for(const [i,change] of [
  c=>p.query('update public.icash_accounts set bot_paused=true where id=$1',[c.account]),
  c=>p.query('update public.icash_wallets set reserved_cents=balance_cents where account_id=$1',[c.account]),
  c=>p.query('update public.icash_discovery_configs set enabled=false where account_id=$1',[c.account]),
  ()=>p.exec('update public.icash_operating_budget set enabled=false'),
 ].entries())await isolated(async()=>{
  const c=await seedOrdinary(p,95300+i);await change(c);const before=await snapshot(p);
  assert.equal(await lane(p,'research'),null);assert.deepEqual(await snapshot(p),before);
 });
 await isolated(async()=>{
  const c1=await seedContinued(p,95400,{deadlineMinutes:10}),c2=await seedContinued(p,95401,{deadlineMinutes:20}),ordinary=await seedOrdinary(p,95402);
  await p.exec('update icash_work_private.continuation_policy set issued=0');
  const got=[];for(let i=0;i<3;i++){const t=await lane(p,'research');got.push(await v('select account_id from public.icash_automation_tickets where token=$1',[t.token]));}
  assert.deepEqual(got,[c1.account,c2.account,ordinary.account]);
 });
 console.log(JSON.stringify({result:'PASS research priority cost isolation',afterHash,sourcePinned:true,rankEquivalent:true,fullTargetUnchanged:true,unknownOperationsPreserved:true,finalControlsPreserved:true}));
}catch(e){console.error(e.stack,e.where??'');process.exitCode=1;}finally{await p.close();}
