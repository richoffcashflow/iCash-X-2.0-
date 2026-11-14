// Real timeout/cancellation only against the fixed disposable CI localhost database.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setupSql,seedSql,migration,id,refreshDefinition} from '../tests/helpers/learning-timeout-fixture.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const clients=[],warnings=[];
const connect=async name=>{const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',application_name:'learning-timeout-'+name,connectionTimeoutMillis:5000});clients.push(c);c.on('notice',n=>warnings.push(n.message));await c.connect();await c.query("set statement_timeout='8s';set lock_timeout='1s';");return c;};
const value=async(c,sql,args=[])=>Object.values((await c.query(sql,args)).rows[0]??{})[0];
try{
 const admin=await connect('observer'),runner=await connect('runner');
 assert.equal(await value(admin,'select current_database()'),'icash_reliability');
 await admin.query('drop schema if exists icash_learning_private cascade;drop schema if exists icash_learning_policy_private cascade;drop schema if exists icash_reliability_private cascade;drop schema public cascade;create schema public;');
 await admin.query("do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end$$;");
 await admin.query(setupSql.replace(/create role (anon|authenticated|service_role);/g,'')+seedSql);
 const slow=refreshDefinition(`if p_account='${id(2)}' then perform pg_sleep(2);end if;`);
 await admin.query(slow);await runner.query("set statement_timeout='250ms'");
 await assert.rejects(runner.query('select icash_refresh_shared_learning(3)'),e=>e.code==='57014'&&/statement timeout/.test(e.message));
 assert.equal(await value(admin,'select sum(value)::int from fixture_outcomes'),0,'Baseline really rolls back the first completed account');
 assert.equal(await value(admin,'select count(*)::int from icash_learning_private.refresh_runs'),0);
 await admin.query(migration);
 const started=performance.now();
 assert.deepEqual(await value(runner,'select icash_refresh_shared_learning(3)'),{refreshed:1,failed:1,due:1,canceled:true});
 assert(performance.now()-started<1500,'Cancellation must end the batch, not run another expensive step');
 assert.deepEqual(await value(admin,'select array_agg(value order by account_id) from fixture_outcomes'),[1,0,0]);
 assert.equal(await value(admin,'select last_error_code from icash_learning_queue where account_id=$1',[id(2)]),'57014');
 assert(warnings.some(n=>n.includes('57014')),'Cancellation is visible even to an administrative caller');
 await admin.query(refreshDefinition());
 assert.deepEqual(await value(runner,'select icash_refresh_shared_learning(3)'),{refreshed:1,failed:0,due:0});
 // An operator cancellation has the same SQLSTATE: retain its receipt and stop too.
 await runner.query("set statement_timeout='5s'");
 await admin.query("update fixture_outcomes set value=0;update icash_learning_queue set due_at=now()-interval '1 minute',last_error_code=null,last_error_at=null;"+slow);
 const pid=await value(runner,'select pg_backend_pid()');
 const canceled=value(runner,'select icash_refresh_shared_learning(3)');
 const deadline=Date.now()+3000;
 while(!await value(admin,"select exists(select 1 from pg_stat_activity where pid=$1 and wait_event='PgSleep')",[pid])){assert(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,10));}
 // A concurrent source update must survive the canceled older refresh.
 await admin.query('update icash_learning_queue set generation=generation+1 where account_id=$1',[id(2)]);
 assert.equal(await value(admin,'select pg_cancel_backend($1)',[pid]),true);
 assert.deepEqual(await canceled,{refreshed:1,failed:1,due:2,canceled:true});
 assert.equal(await value(admin,'select generation from icash_learning_queue where account_id=$1',[id(2)]),'2');
 await admin.query(refreshDefinition());
 assert.deepEqual(await value(runner,'select icash_refresh_shared_learning(3)'),{refreshed:1,failed:0,due:1},'Fresh generation remains due while canceled account is backed off');
 // The optional conversion phase also stops on real timeout and permits later independent work.
 await admin.query("update icash_learning_queue set due_at=now()-interval '1 minute',last_error_code=null,last_error_at=null;update icash_learning_conversion_cache set updated_at=now()-interval '1 hour';create or replace function public.icash_usage_loop_report(uuid,boolean) returns jsonb language plpgsql as $$begin perform pg_sleep(2);return '{}'::jsonb;end$$;");
 await runner.query("set statement_timeout='250ms'");
 assert.deepEqual(await value(runner,'select icash_refresh_shared_learning(3)'),{refreshed:0,failed:1,due:3,canceled:true});
 assert.equal(await value(admin,"select last_error_code from icash_learning_private.components where component='conversion'"),'57014');
 assert.deepEqual(await value(runner,'select icash_refresh_shared_learning(3)'),{refreshed:3,failed:0,due:0});
 // A late review timeout must not erase completed account output or mark refresh healthy.
 await admin.query("update icash_learning_queue set due_at=now()-interval '1 minute';create or replace function public.icash_review_learning_operations() returns jsonb language plpgsql as $$begin perform pg_sleep(2);return '{}'::jsonb;end$$;");
 assert.deepEqual(await value(runner,'select icash_refresh_shared_learning(3)'),{refreshed:3,failed:1,due:0,canceled:true});
 assert.equal(await value(admin,"select last_error_code from icash_learning_private.components where component='review'"),'57014');
 assert.equal(await value(admin,"select last_error_code from icash_learning_private.components where component='refresh'"),'57014');
 // If the checkpoint row itself is locked, the existing cron lock budget still
 // bounds failure after the statement timer fires. Never claim an unsaved result.
 const blocker=await connect('checkpoint-holder');
 await admin.query(refreshDefinition()+"create or replace function public.icash_review_learning_operations() returns jsonb language sql as $$select '{}'::jsonb$$;update icash_learning_queue set due_at=now()-interval '1 minute',last_error_code=null,last_error_at=null;");
 await blocker.query('begin');await blocker.query('select 1 from icash_learning_queue where account_id=$1 for update',[id(2)]);
 const lockedAt=performance.now();
 try{await assert.rejects(runner.query('select icash_refresh_shared_learning(3)'),e=>e.code==='55P03');assert(performance.now()-lockedAt<2000,'Checkpoint contention must remain bounded after cancellation');}
 finally{await blocker.query('rollback');}
 console.log('PASS native learning cancellation: actual statement timeouts, earlier progress, operator cancel, concurrent generation, bounded cache backoff and truthful late review.');
}finally{await Promise.allSettled(clients.map(c=>c.end()));}
