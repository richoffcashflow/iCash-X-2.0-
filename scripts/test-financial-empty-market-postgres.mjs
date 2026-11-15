// Native races only in this fixed disposable localhost database. No providers.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import * as fixture from '../tests/helpers/financial-empty-market-fixture.mjs';

const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const database='icash_financial_empty_fixture',clients=[];
const connect=async(name,db=database)=>{
 const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:db,
  application_name:'financial-empty-'+name,connectionTimeoutMillis:5000});
 clients.push(c);await c.connect();await c.query("set timezone='UTC';set statement_timeout='8s';set lock_timeout='5s';");return c;
};
const value=async(c,sql,args=[])=>Object.values((await c.query(sql,args)).rows[0]??{})[0];
const finish=c=>value(c,'select public.icash_finish_empty_financial_market($1,$2,$3,$4)',
 [fixture.account,fixture.scope,fixture.plan,fixture.policy]);
const waitForLock=async(observer,name)=>{
 const deadline=Date.now()+4000;
 while(!await value(observer,"select exists(select 1 from pg_stat_activity where datname=$1 and application_name=$2 and wait_event_type='Lock')",[database,'financial-empty-'+name])){
  assert(Date.now()<deadline,'Expected '+name+' to wait on the independently held source/control row');
  await new Promise(resolve=>setTimeout(resolve,20));
 }
};

try{
 const bootstrap=await connect('bootstrap','postgres');
 assert.equal(await value(bootstrap,'select current_database()'),'postgres');
 assert.equal(await value(bootstrap,'select host(inet_server_addr())'),'127.0.0.1');
 if(!await value(bootstrap,'select exists(select 1 from pg_database where datname=$1)',[database]))await bootstrap.query('create database '+database);
 const admin=await connect('observer'),holder=await connect('holder'),runner=await connect('runner');
 assert.equal(await value(admin,'select current_database()'),database);
 await admin.query("do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end$$;");
 const setup=async()=>{
  await admin.query('drop schema if exists icash_research_private cascade;drop schema if exists icash_call_offer_private cascade;drop schema public cascade;create schema public;');
  await admin.query('grant usage on schema public to service_role');
  for(const sql of [fixture.setupSql.replace(/create role (anon|authenticated|service_role);/g,''),fixture.migration,fixture.seedSql])await admin.query(sql);
 };
 const source=()=>value(admin,'select to_jsonb(e) from icash_research_private.estimates e where e.account_id=$1 and e.operation_key=$2',
  [fixture.account,`discovery:${fixture.account}:${fixture.revision}:${fixture.scope.p_page}`]);
 const wallets=()=>value(admin,"select jsonb_agg(to_jsonb(w) order by account_id) from public.icash_wallets w");
 // The fixture exports the ledger's exact private name so the native and local
 // suites inspect the same implementation rather than separate models.
 assert.match(fixture.proofTable,/^icash_research_private\.[a-z_]+$/);
 const proofCount=()=>value(admin,`select count(*)::int from ${fixture.proofTable}`);
 const unchangedAfterRefusal=async(beforeSource,beforeWallets)=>{
  assert.equal(await proofCount(),0);
  assert.equal(await value(admin,'select count(*)::int from public.icash_discovery_filter_pages'),0);
  assert.deepEqual(await source(),beforeSource);
  assert.deepEqual(await wallets(),beforeWallets);
  assert.equal(await value(admin,'select revision::text from public.icash_discovery_configs where account_id=$1',[fixture.account]),fixture.revision);
 };

 await setup();
 const originalSource=await source(),originalWallets=await wallets();
 const contenders=await Promise.all(Array.from({length:12},(_,i)=>connect('contender-'+i)));
 await Promise.all(contenders.map(c=>c.query('set role service_role')));
 const answers=await Promise.all(contenders.map(finish));
 assert.equal(answers.filter(Boolean).length,1,'One original empty baseline authorizes at most one market decision');
 assert.equal(await proofCount(),1);
 assert.equal(await value(admin,'select count(*)::int from public.icash_discovery_filter_pages'),1,'Skipped audiences do not become invented observations');
 assert.equal(await value(admin,"select count(*)::int from public.icash_discovery_filter_pages where plan->>'strategy'='baseline' and state='empty'"),1);
 assert.equal(await value(admin,"select coalesce(sum(pages),0)::int from public.icash_discovery_filter_cursors where account_id=$1 and revision=$2 and strategy<>'baseline'",[fixture.account,fixture.revision]),0,'Skipped audiences do not gain fake page counts');
 assert.deepEqual(await source(),originalSource);assert.deepEqual(await wallets(),originalWallets);
 assert.equal(await value(admin,'select count(*)::int from public.icash_operation_spend'),0);
 assert.equal(await finish(runner),false,'An old capability cannot close the successor market');

 const lateControls=[
  ['Pause','update public.icash_accounts set bot_paused=true where id=$1',[fixture.account]],
  ['disabled financial policy','update icash_research_private.financial_settings set enabled=false where id=1',[]],
  ['changed exclusion snapshot',"update icash_research_private.exclusions set last_synced_at=last_synced_at+interval '1 second' where id=1",[]],
  ['reserved other arm',"select 1 from public.icash_operating_budget where id=1 for update;",[]],
  ['dispatched other arm',"select 1 from public.icash_operating_budget where id=1 for update;",[]],
 ];
 for(const [label,mutation,args] of lateControls){
  await setup();const beforeSource=await source(),beforeWallets=await wallets();
  await holder.query('begin');
  try{
   await holder.query(mutation,args);
   if(label.endsWith('other arm'))await holder.query(
    'insert into public.icash_operation_spend(operation_key,account_id,rate_id,permission_until,state) values($1,$2,$3,$4,$5)',
    [`discovery:${fixture.account}:${fixture.revision}:999`,fixture.account,fixture.scope.p_rate,fixture.scope.p_permission_until,label.startsWith('reserved')?'reserved':'dispatched']);
   const pending=finish(runner);await waitForLock(admin,'runner');await holder.query('commit');
   assert.equal(await pending,false,label+' committed ahead of finalization must remain authoritative');
   await unchangedAfterRefusal(beforeSource,beforeWallets);
  }finally{await holder.query('rollback');}
 }

 // The receipt can expire while a caller waits. Transaction-start now() is
 // insufficient here: the final source check must use the post-lock clock.
 await setup();
 await admin.query("update icash_research_private.estimates set saved_at=clock_timestamp()-interval '299 seconds'");
 const agingSource=await source(),agingWallets=await wallets();
 await holder.query('begin');await holder.query('select 1 from public.icash_operating_budget where id=1 for update');
 try{
  const pending=finish(runner);await waitForLock(admin,'runner');
  await new Promise(resolve=>setTimeout(resolve,1100));await holder.query('commit');
  assert.equal(await pending,false,'Source expiration during a lock wait must prevent broad completion');
  await unchangedAfterRefusal(agingSource,agingWallets);
 }finally{await holder.query('rollback');}

 // A transaction interrupted after the decision leaves no partial cursor,
 // market or proof change; retrying the same genuine source remains one-use.
 await setup();const rollbackSource=await source(),rollbackWallets=await wallets();
 await runner.query('begin');assert.equal(await finish(runner),true);await runner.query('rollback');
 await unchangedAfterRefusal(rollbackSource,rollbackWallets);
 assert.equal(await finish(runner),true);assert.equal(await proofCount(),1);

 // If valid completion wins first, a later Pause waits and cannot rewrite its
 // original source receipt or manufacture any paid activity.
 await setup();const preservedSource=await source();await holder.query('begin');
 try{
  assert.equal(await finish(holder),true);
  const pending=runner.query('update public.icash_accounts set bot_paused=true where id=$1',[fixture.account]);
  await waitForLock(admin,'runner');await holder.query('commit');await pending;
  assert.equal(await proofCount(),1);assert.deepEqual(await source(),preservedSource);
  assert.equal(await value(admin,'select count(*)::int from public.icash_operation_spend'),0);
  assert.equal(await finish(runner),false);
 }finally{await holder.query('rollback');}
 console.log('PASS native financial empty market: 12 concurrent finalizers, late Pause/policy/exclusion/unknown-arm controls, atomic rollback, original evidence and zero fabricated skipped pages or spend.');
}finally{await Promise.allSettled(clients.map(c=>c.end()));}
