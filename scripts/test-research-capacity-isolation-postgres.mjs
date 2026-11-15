// Actual captured SQL on the fixed disposable PostgreSQL fixture only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
import {installFixture,verifyIsolation,value,id,resetScans,capacityScans} from '../tests/helpers/research-capacity-isolation-fixture.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const db=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',application_name:'research-capacity-isolation',connectionTimeoutMillis:5000});
try{
 await db.connect();await assertDisposablePostgresTarget(db);
 await db.query("set timezone='UTC';set statement_timeout='8s';set lock_timeout='5s'");
 await db.query('drop schema public cascade;create schema public');
 await installFixture(db);
 const seedHistory=()=>db.query(`insert into public.icash_voice_jobs(id,account_id,state,due_at)
  select ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,'ready',now()-interval '1 hour'
  from generate_series(1,12000) n`,[id(9000)]);
 const plan=()=>value(db,`explain (analyze,buffers,format json) select exists(
  select 1 from public.icash_voice_jobs possible where possible.account_id='${id(8000)}'::uuid
   and (possible.state in ('ready','issued') or (possible.state='held' and possible.outcome='prospecting_budget_held'))
   and possible.callback_id is null and possible.sms_source_message_id is null and possible.cancellation_notice_id is null
   and possible.provider_call_sid is null and possible.conversation_id is null and possible.operation_key is null
   and possible.due_at<=now())`);
 await db.query('begin');await seedHistory();await db.query('analyze public.icash_voice_jobs');
 const oldPlan=JSON.stringify(await plan());await db.query('rollback');
 assert(!oldPlan.includes('icash_voice_jobs_possible_introduction'));
 assert.match(oldPlan,/"Rows Removed by Filter":12000/,'Prior hint examines unrelated synthetic jobs');
 const result=await verifyIsolation(db);
 await seedHistory();await db.query('analyze public.icash_voice_jobs');
 const newPlan=JSON.stringify(await plan());
 assert(newPlan.includes('"Index Name":"icash_voice_jobs_possible_introduction"'),'Account/due partial index supports the hint');
 assert.match(newPlan,/"Index Cond":"[^"]*account_id[^"]*due_at/,'Both account and due time constrain the scan');
 assert(!newPlan.includes('"Rows Removed by Filter":12000'),'Unrelated jobs no longer need filtering');
 // Model a slow independent global capacity projection. The original actual
 // function times out even for an account with no voice jobs. The installed
 // function does not enter that unrelated boundary, under the same timeout.
 await db.query("update public.fixture_policy set slow_capacity=true;set statement_timeout='100ms'");
 await assert.rejects(db.query('select public.fixture_waiting_before($1)',[id(50)]),e=>e.code==='57014');
 await resetScans(db);
 assert.equal(await value(db,'select public.icash_research_waiting_on_outreach($1)',[id(50)]),false);
 assert.equal(await capacityScans(db),0);
 await db.query('update public.icash_voice_jobs set operation_key=null where id=$1',[id(4)]);
 await assert.rejects(db.query('select public.icash_research_waiting_on_outreach($1)',[id(1)]),e=>e.code==='57014','A possible introduction still requires actual global capacity');
 await db.query("set statement_timeout='8s';update public.fixture_policy set slow_capacity=false");
 await db.query('set role service_role');
 assert.equal(await value(db,'select public.icash_research_waiting_on_outreach($1)',[id(1)]),true);
 await db.query('reset role');
 console.log('Native research capacity isolation PASS',result);
}finally{await db.end();}
