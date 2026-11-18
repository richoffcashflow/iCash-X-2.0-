// Actual captured wait wrapper and source helpers on the fixed disposable
// database. No provider, dispatch, or paid-admission function is invoked.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
import {install,seedOrdinary,value,definition,signature,before,after,afterHash,
 migration,migrationPath,read,sqlBody,rows,catalog,policies,histories,
 expectedPolicies,planNodes} from '../tests/helpers/owner-wait-local-gate-fixture.mjs';

const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg'),clients=[];
const connect=async name=>{
 const db=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',
  database:'icash_reliability',application_name:'owner-wait-local-'+name,connectionTimeoutMillis:5000});
 clients.push(db);await db.connect();await assertDisposablePostgresTarget(db);
 await db.query("set statement_timeout='8s';set lock_timeout='5s';set timezone='UTC'");return db;
};
const literal=id=>{
 if(id===null)return 'null';
 assert.match(id,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
 return `'${id}'::uuid`;
};
const execute=(db,name,id)=>value(db,`execute ${name}(${literal(id)})`);
const waitForBlocker=async(db,blocker,worker)=>{
 const started=performance.now();
 while(performance.now()-started<1500){
  if(await value(db,'select $1::integer=any(pg_blocking_pids($2::integer))',[blocker.processID,worker.processID]))return;
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 assert.fail('Expected migration blocker was not observed');
};
const isolate=async(db,fn)=>{await db.query('begin');try{return await fn();}finally{await db.query('rollback');}};

try{
 const admin=await connect('admin'),blocker=await connect('blocker'),migrator=await connect('migrator'),reader=await connect('reader');
 await admin.query('drop schema if exists icash_work_private cascade;drop schema if exists icash_private cascade;drop schema if exists icash_research_private cascade;drop schema if exists icash_owner_review_private cascade;drop schema public cascade;create schema public');
 await install(admin);assert.equal(migration,read(migrationPath));assert.equal(await definition(admin),before);

 const present=await seedOrdinary(admin,73100),empty=await seedOrdinary(admin,73101),unrelated=await seedOrdinary(admin,73102);
 await admin.query('delete from public.icash_screening_jobs where account_id=$1',[empty.account]);
 const cases=[{name:'eligible',account:present.account,expected:true},{name:'empty',account:empty.account,expected:false}];
 const mutations=[
  ['missing-property-type',"snapshot=snapshot-'propertyType'"],
  ['null-property-type',"snapshot=jsonb_set(snapshot,'{propertyType}','null')"],
  ['null-seller-request',"snapshot=snapshot||'{\"sellerRequest\":null}'::jsonb"],
  ['missing-state',"snapshot=snapshot#-'{raw,data,state}'"],
  ['null-financial-check',"result='{\"financialCheck\":null}'"],
  ['missing-financial-check',"result='{}'"],
  ['null-completed-at','completed_at=null'],
  ['expired-source',"completed_at=now()-interval '25 hours'"],
 ];
 for(let i=0;i<mutations.length;i++){
  const c=await seedOrdinary(admin,73110+i);
  await admin.query(`update public.icash_screening_jobs set ${mutations[i][1]} where account_id=$1`,[c.account]);
  cases.push({name:mutations[i][0],account:c.account,expected:false});
 }
 const manual=await seedOrdinary(admin,73130);
 await admin.query("insert into public.icash_property_controls(account_id,property_id,manual) select account_id,snapshot->>'propertyId',true from public.icash_screening_jobs where account_id=$1",[manual.account]);
 cases.push({name:'manual-property',account:manual.account,expected:false});
 const unfunded=await seedOrdinary(admin,73131);
 await admin.query('update public.icash_wallets set reserved_cents=balance_cents where account_id=$1',[unfunded.account]);
 cases.push({name:'reserved-funds',account:unfunded.account,expected:false});
 cases.push({name:'null-account',account:null,expected:false},{name:'missing-account',account:'00000000-0000-0000-0000-000000000001',expected:false});

 // Keep the extra data on one unrelated account. This exposes a broad scan
 // without constructing thousands of unrelated financial/source fixtures.
 await admin.query(`insert into public.icash_screening_jobs(id,account_id,event_key,snapshot,state,result,completed_at)
  select md5('local-wait-plan-'||n)::uuid,s.account_id,'local-wait-plan-'||n,
   jsonb_set(s.snapshot,'{propertyId}',to_jsonb('plan-property-'||n)),s.state,s.result,s.completed_at
  from public.icash_screening_jobs s cross join generate_series(1,12000)n where s.id=$1`,[unrelated.screening]);
 await admin.query('analyze public.icash_screening_jobs;analyze public.icash_automation_tickets;analyze public.icash_discovery_configs;analyze public.icash_operation_rates');
 const oldCatalog=await catalog(admin),oldPolicies=await rows(admin,policies),oldHistory=await rows(admin,histories);
 const hintStart=after.indexOf(' select case when ')+' select case when '.length,hintEnd=after.indexOf(' then (\n',hintStart);
 assert(hintEnd>hintStart,'Exact static hint boundary must exist');
 const hint=after.slice(hintStart,hintEnd).replaceAll('p_account','$1::uuid');
 const plans=[];let comparisons=0;
 for(const mode of ['force_generic_plan','force_custom_plan']){
  await admin.query(`begin read only;set local plan_cache_mode=${mode};prepare old_gate(uuid) as ${sqlBody(before)};prepare new_gate(uuid) as ${sqlBody(after)};prepare hint_gate(uuid) as select ${hint}`);
  const oldVector=[],newVector=[];
  for(const c of cases){
   oldVector.push(await execute(admin,'old_gate',c.account));newVector.push(await execute(admin,'new_gate',c.account));
   assert.equal(oldVector.at(-1),c.expected,mode+': '+c.name+' fixture expectation');comparisons++;
  }
  assert.deepEqual(newVector,oldVector,mode+' preserves the complete result vector');
  for(const [name,id] of [['empty',empty.account],['present',present.account]]){
   const plan=(await value(admin,`explain(analyze,buffers,format json) execute hint_gate(${literal(id)})`))[0];
   const nodes=planNodes(plan.Plan),screening=nodes.filter(n=>n['Relation Name']==='icash_screening_jobs');
   assert(screening.length,'Hint must inspect its source relation');
   assert(!screening.some(n=>n['Node Type']==='Seq Scan'&&n['Actual Loops']>0),'Hint must not scan unrelated screening rows');
   assert(nodes.some(n=>n['Index Cond']?.includes('account_id')),'Hint retains an account index condition');
   plans.push({mode,source:name,milliseconds:plan['Execution Time'],sharedHits:plan.Plan['Shared Hit Blocks']});
  }
  await admin.query('deallocate old_gate;deallocate new_gate;deallocate hint_gate;commit');
 }
 assert.deepEqual(await rows(admin,histories),oldHistory,'Boolean and plan reads cannot change work, credits or receipts');
 assert.deepEqual(await rows(admin,policies),oldPolicies);assert.deepEqual(await catalog(admin),oldCatalog);

 // A slow shared capacity boundary is irrelevant to an account with no static
 // source. Both plan modes must still encounter it when a source is present.
 for(const mode of ['force_generic_plan','force_custom_plan'])await isolate(admin,async()=>{
  await admin.query(`create or replace function public.icash_research_waiting_on_outreach(uuid) returns boolean language plpgsql stable set search_path='' as $$begin perform pg_sleep(0.2);return false;end$$;
   set local plan_cache_mode=${mode};prepare slow_old(uuid) as ${sqlBody(before)};prepare slow_new(uuid) as ${sqlBody(after)};set local statement_timeout='100ms'`);
  await admin.query('savepoint old_timeout');
  await assert.rejects(execute(admin,'slow_old',empty.account),e=>e.code==='57014');await admin.query('rollback to savepoint old_timeout');
  assert.equal(await execute(admin,'slow_new',empty.account),false);
  await admin.query('savepoint source_timeout');
  await assert.rejects(execute(admin,'slow_new',present.account),e=>e.code==='57014');await admin.query('rollback to savepoint source_timeout');
  await admin.query('deallocate slow_old;deallocate slow_new');
 });
 assert.deepEqual(await catalog(admin),oldCatalog,'Fault injection is rolled back');

 for(const lock of ['select pg_advisory_xact_lock(726341927)','select 1 from icash_work_private.continuation_policy where id=1 for update']){
  await blocker.query('begin;'+lock);await migrator.query('begin');const started=performance.now();
  const pending=migrator.query(migration).then(()=>({ok:true}),error=>({error}));
  try{
   await waitForBlocker(admin,blocker,migrator);
   const result=await pending;assert.equal(result.error?.code,'55P03','Persistent lock must abort the migration');
   assert(performance.now()-started<4000,'Two-second lock bound must be retained');
  }finally{await migrator.query('rollback');await blocker.query('rollback');}
  assert.deepEqual(await catalog(admin),oldCatalog);assert.deepEqual(await rows(admin,policies),oldPolicies);assert.deepEqual(await rows(admin,histories),oldHistory);
 }
 await admin.query('begin;'+migration);await assert.rejects(admin.query('select 1/0 as migration_history_failure'),e=>e.code==='22012');await admin.query('rollback');
 assert.deepEqual(await catalog(admin),oldCatalog);assert.deepEqual(await rows(admin,policies),oldPolicies);assert.deepEqual(await rows(admin,histories),oldHistory);

 await admin.query('begin;'+migration+'commit');assert.equal(await definition(admin),after);
 assert.equal(await value(admin,'select md5(pg_get_functiondef($1::regprocedure))',[signature]),afterHash);
 const expectedCatalog=structuredClone(oldCatalog);expectedCatalog[signature].definition=after;
 assert.deepEqual(await catalog(admin),expectedCatalog,'Only the wait wrapper body changes; metadata and final admission stay exact');
 assert.deepEqual(await rows(admin,policies),expectedPolicies(oldPolicies));assert.deepEqual(await rows(admin,histories),oldHistory);

 // A pre-existing READ COMMITTED reader sees current committed manual/source
 // changes on its next statement. The hint introduces no eligibility cache.
 const call=(db,id)=>value(db,'select icash_work_private.owner_enrichment_wait_candidate($1)',[id]);
 await reader.query('begin');assert.equal(await call(reader,present.account),true);
 await admin.query("insert into public.icash_property_controls(account_id,property_id,manual) select account_id,snapshot->>'propertyId',true from public.icash_screening_jobs where account_id=$1",[present.account]);
 assert.equal(await call(reader,present.account),false);
 await admin.query('delete from public.icash_property_controls where account_id=$1',[present.account]);assert.equal(await call(reader,present.account),true);
 const sourceRows=(await admin.query('select id,completed_at from public.icash_screening_jobs where account_id=$1',[present.account])).rows;
 await admin.query("update public.icash_screening_jobs set completed_at=now()-interval '25 hours' where account_id=$1",[present.account]);
 assert.equal(await call(reader,present.account),false);
 for(const source of sourceRows)await admin.query('update public.icash_screening_jobs set completed_at=$1 where id=$2',[source.completed_at,source.id]);
 assert.equal(await call(reader,present.account),true);await reader.query('rollback');
 assert.deepEqual(await rows(admin,histories),oldHistory);assert.deepEqual(await catalog(admin),expectedCatalog);
 console.log(JSON.stringify({result:'PASS native owner wait local gate',comparisons,unrelatedScreenings:12000,plans,
  faultModes:2,migrationLockCases:2,afterHash,finalAdmissionUnchanged:true}));
}catch(error){console.error(error.stack,error.where??'');process.exitCode=1;}
finally{await Promise.allSettled(clients.map(db=>db.end()));}
