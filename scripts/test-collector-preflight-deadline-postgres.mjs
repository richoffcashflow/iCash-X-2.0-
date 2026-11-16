// Offline native fixture only. Never accepts an arbitrary database URL.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {exerciseCollectorSelector} from '../tests/helpers/collector-selector-equivalence.mjs';
import {installCollectorDeadlineFixture,value,catalog,policy,deadlines,migration,original,marker,replacement,signature} from '../tests/helpers/collector-deadline-fixture.mjs';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const clients=[];
const reset=`drop schema if exists icash_reliability_private cascade;drop schema if exists icash_work_private cascade;
 drop schema if exists icash_private cascade;drop schema if exists icash_research_private cascade;
 drop schema if exists icash_owner_review_private cascade;drop schema public cascade;create schema public`;
async function connect(name){
 const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',application_name:'collector-deadline-'+name,connectionTimeoutMillis:5000});
 clients.push(c);await c.connect();await assertDisposablePostgresTarget(c);
 await c.query("set statement_timeout='20s';set lock_timeout='1s';set timezone='UTC'");
 c.exec=sql=>c.query(sql);return c;
}
async function blockedBy(admin,waiter,holder){
 for(let n=0;n<100;n++){
  if(await value(admin,'select $1=any(pg_blocking_pids($2))',[holder.processID,waiter.processID]))return;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.fail('Expected observed migration serialization lock');
}
const body=sql=>sql.split('$function$')[1].replace(/\bp_account\b/g,'$1').replace(/\bp_screening\b/g,'$2').trim();
const nodes=plan=>[plan,...(plan.Plans||[]).flatMap(nodes)];
try{
 const admin=await connect('admin'),holder=await connect('holder'),first=await connect('first'),second=await connect('second');
 await admin.query(reset);
 const vectors=await exerciseCollectorSelector(admin);
 await admin.query(reset);await installCollectorDeadlineFixture(admin);
 // A large same-account historical tail reproduces the generic-plan filter.
 await admin.query(`insert into icash_research_private.owner_export_preflights(id,account_id,items,state,checked_at,created_at,next_check_at,cleanup_attempts)
 select fid(n),fid(100000),jsonb_build_array(jsonb_build_object('screeningId',fid(n)::text)),'ready',now()-interval '1 day',now()-interval '1 day',null,0 from generate_series(121,5000)n;analyze;`);
 await admin.query('begin;set local plan_cache_mode=force_generic_plan');
 const before=await deadlines(admin),beforeCatalog=await catalog(admin),beforePolicy=await policy(admin);
 await admin.query(`prepare predecessor_inner(uuid,uuid) as ${body(original)}`);
 const oldPlan=(await admin.query('explain(analyze,format json,timing off) execute predecessor_inner(fid(100000),fid(2))')).rows[0]['QUERY PLAN'][0];
 await admin.query(migration);
 await admin.query(`prepare candidate_inner(uuid,uuid) as ${body(original.replace(marker,replacement))}`);
 const newPlan=(await admin.query('explain(analyze,format json,timing off) execute candidate_inner(fid(100000),fid(2))')).rows[0]['QUERY PLAN'][0];
 assert.deepEqual(await deadlines(admin),before,'Exact deadlines preserved in the same transaction');
 const indexNodes=nodes(newPlan.Plan).filter(n=>n['Index Name']==='icash_owner_preflight_primary_screening');
 assert(indexNodes.some(n=>/account_id/.test(n['Index Cond']||'')&&/screeningId/.test(n['Index Cond']||'')),'Generic plan must constrain both account and original primary screening');
 assert(nodes(newPlan.Plan).some(n=>n['One-Time Filter']==='($2 IS NULL)'&&n['Actual Rows']===0),'Non-null source skips the null-screening branch');
 await admin.query('rollback');
 assert.deepEqual(await catalog(admin),beforeCatalog);assert.deepEqual(await policy(admin),beforePolicy);
 assert.equal(await value(admin,"select to_regclass('icash_research_private.icash_owner_preflight_primary_screening')"),null,'Migration/index roll back together');
 // Live readers cannot see a new source with the old policy, and concurrent
 // installers serialize. The second refuses its now-stale source, not replay.
 await holder.query('begin;select 1 from public.icash_operating_budget where id=1 for update');
 await first.query('begin');
 const firstRun=first.query(migration).then(()=>({ok:true}),error=>({error}));
 await blockedBy(admin,first,holder);
 assert.deepEqual(await catalog(admin),beforeCatalog);assert.deepEqual(await policy(admin),beforePolicy);
 await holder.query('rollback');assert.equal((await firstRun).ok,true);
 await second.query('begin');
 const secondRun=second.query(migration).then(()=>({unexpected:true}),error=>({error}));
 await blockedBy(admin,second,first);
 assert.deepEqual(await catalog(admin),beforeCatalog);assert.deepEqual(await policy(admin),beforePolicy);
 await first.query('commit');const duplicate=await secondRun;
 assert.match(duplicate.error?.message??'',/Collector deadline source or privileges changed/);await second.query('rollback');
 const finalCatalog=await catalog(admin),finalPolicy=await policy(admin);
 assert.equal(finalCatalog.definition,original.replace(marker,replacement));
 const expectedPolicy=structuredClone(beforePolicy);
 expectedPolicy.continued_original_hashes[signature]=await value(admin,'select md5(pg_get_functiondef($1::regprocedure))',[signature]);
 assert.deepEqual(finalPolicy,expectedPolicy);
 console.log(JSON.stringify({result:'PASS native collector deadline plan and serialized migration',postgres:await value(admin,'show server_version'),...vectors,
  originalInnerMs:oldPlan['Execution Time'],candidateInnerMs:newPlan['Execution Time'],accountAndPrimaryIndex:true,transactionRollback:true,concurrentReplayRejected:true}));
}catch(error){console.error(error.stack,error.where??'');process.exitCode=1;}
finally{await Promise.allSettled(clients.map(c=>c.query('rollback')));await Promise.allSettled(clients.map(c=>c.end()));}
