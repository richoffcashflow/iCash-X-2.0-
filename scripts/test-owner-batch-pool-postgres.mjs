// Fixed disposable native PostgreSQL only. No external provider or paid tests.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
import {installOwnerPoolFixture,seedMixedPool,candidates,history,value,migration,signature} from '../tests/helpers/owner-batch-pool-fixture.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const clients=[];
async function connect(name){
 const pg=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',application_name:'owner-pool-'+name,connectionTimeoutMillis:5000});
 clients.push(pg);await pg.connect();await assertDisposablePostgresTarget(pg);
 await pg.query("set statement_timeout='8s';set lock_timeout='5s';set timezone='UTC'");
 pg.exec=sql=>pg.query(sql);return pg;
}
try{
 const pg=await connect('admin'),blocker=await connect('blocker');
 await pg.exec('drop schema if exists icash_work_private cascade;drop schema if exists icash_private cascade;drop schema if exists icash_research_private cascade;drop schema if exists icash_owner_review_private cascade;drop schema public cascade;create schema public');
 await installOwnerPoolFixture(pg);
 const c=await seedMixedPool(pg,62001);
 // Larger account history and both pools exercise the actual stable resolver,
 // its production indexes and the existing generic-plan candidate query.
 await pg.query(`insert into public.icash_screening_jobs(id,account_id,event_key,snapshot,state,result,completed_at)
  select ('11111111-1111-4111-8111-'||lpad(i::text,12,'0'))::uuid,s.account_id,'synthetic-pool-history-'||i,
   jsonb_set(s.snapshot,'{propertyId}',to_jsonb('prop_native_'||i)),'complete',s.result,s.completed_at
  from public.icash_screening_jobs s cross join generate_series(1,2000)i where s.id=$1`,[c.screening]);
 await pg.query(`insert into public.icash_discovery_filter_attribution
  select s.id,$2,s.account_id from public.icash_screening_jobs s
  where s.account_id=$1 and s.event_key like 'synthetic-pool-history-%' and (substring(s.event_key from '[0-9]+$')::integer%2)=0`,[c.account,'synthetic-pool-page-62001']);
 await pg.exec('analyze public.icash_screening_jobs;analyze public.icash_discovery_filter_attribution;analyze public.icash_discovery_filter_pages');
 const old=await candidates(pg,c);assert.equal(old.length,5);assert.equal(old.filter(x=>c.opposite.includes(x.screeningId)).length,4);
 const before=await history(pg),hash=await value(pg,'select md5(pg_get_functiondef($1::regprocedure))',[signature]);
 await blocker.exec('begin;select 1 from public.icash_operating_budget where id=1 for update');
 await pg.exec('begin');
 await assert.rejects(pg.exec(migration),error=>error.code==='55P03','Busy migration yields under its real bounded lock timeout');
 await pg.exec('rollback');await blocker.exec('rollback');
 assert.equal(await value(pg,'select md5(pg_get_functiondef($1::regprocedure))',[signature]),hash);
 assert.deepEqual(await history(pg),before);
 await pg.exec('begin;'+migration+'commit;');
 const workers=await Promise.all(Array.from({length:5},(_,i)=>connect(String(i))));
 await blocker.exec('begin;select 1 from public.icash_operating_budget where id=1 for update');
 const began=performance.now();
 const selected=await Promise.all(workers.map(async worker=>{
  await worker.exec("set plan_cache_mode='force_generic_plan';prepare owner_pool(uuid,uuid) as select public.icash_owner_batch_candidates($1,$2)");
  return value(worker,`execute owner_pool('${c.account}','${c.screening}')`);
 }));
 await blocker.exec('rollback');
 for(const result of selected)assert.deepEqual(result.map(x=>x.screeningId),[c.screening,...c.matching.slice(0,4)]);
 assert.deepEqual(await history(pg),before,'Concurrent selection is read-only and does not wait on final financial locks');
 const plan=(await pg.query(`explain(analyze,buffers,format json) select 1 from public.icash_discovery_filter_attribution a
  join public.icash_discovery_filter_pages p using(operation_key,account_id)
  where a.account_id=$1 and a.screening_id=$2 and p.plan->>'version'='seller-targeting-v1' and p.plan->'targeting'->>'segment'='mobile'`,[c.account,c.opposite[0]])).rows[0]['QUERY PLAN'];
 assert.match(JSON.stringify(plan),/icash_discovery_filter_attribution_(pkey|account)/,'The actual resolver source uses its existing identity index');
 console.log('PASS native owner pool selection: bounded migration contention, five concurrent generic-plan selectors on 2,011 properties, indexed targeting, unchanged receipts/money/quota. Selection wall ms:',Math.round(performance.now()-began));
}catch(error){console.error(error.stack,error.where??'');process.exitCode=1;}finally{
 await Promise.allSettled(clients.map(async client=>{try{await client.query('rollback');}finally{await client.end();}}));
}
