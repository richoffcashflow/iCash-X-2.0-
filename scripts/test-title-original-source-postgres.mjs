import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
import {runOriginalSourceFixture,originalSourceCase,recordOriginalSource,originalSourceMetadata} from '../tests/fixtures/title-original-source-fixture.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const clients=[];let pending;
async function connect(name){
 const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',application_name:'title-original-'+name,connectionTimeoutMillis:5000});
 clients.push(c);await c.connect();await assertDisposablePostgresTarget(c);await c.query("set statement_timeout='10s';set lock_timeout='8s';set timezone='UTC'");c.exec=sql=>c.query(sql);return c;
}
try{
 const db=await connect('admin'),first=await connect('first'),second=await connect('second');
 await db.exec('drop schema if exists icash_title_inbound_private cascade;drop schema public cascade;create schema public');
 await runOriginalSourceFixture(db,{beforeMigration:async(migration,before)=>{
  await first.query('begin;select pg_advisory_xact_lock(726341927)');
  await assert.rejects(db.exec('begin;'+migration+'commit;'),e=>e.code==='55P03');await db.query('rollback');await first.query('rollback');
  assert.deepEqual(await originalSourceMetadata(db),before);assert.equal((await db.query("select to_regnamespace('icash_title_inbound_private') found")).rows[0].found,null);
 }});
 const c=await originalSourceCase(db),email=randomUUID();
 await first.query('begin;set local role service_role');await second.query('begin;set local role service_role');
 const original=await recordOriginalSource(first,c,'First original email',{email});
 const firstPid=(await first.query('select pg_backend_pid() pid')).rows[0].pid;
 const secondPid=(await second.query('select pg_backend_pid() pid')).rows[0].pid;
 pending=recordOriginalSource(second,c,'A changed duplicate must not overwrite source',{email,source:{providerReceivedAt:'2026-11-16T23:59:00Z'}});pending.catch(()=>{});
 let blocked=false;
 for(const end=Date.now()+4000;Date.now()<end;){
  const row=(await db.query('select wait_event_type,$2::int=any(pg_blocking_pids(pid)) held from pg_stat_activity where pid=$1',[secondPid,firstPid])).rows[0];
  if(row?.wait_event_type==='Lock'&&row.held){blocked=true;break;}
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert(blocked,'A duplicate verified insert must visibly contend on the original transaction');
 await first.query('commit');const duplicate=await pending;pending=null;await second.query('commit');
 assert.deepEqual(duplicate,original);assert.equal((await db.query('select count(*)::int n from public.icash_title_replies where provider_email_id=$1',[email])).rows[0].n,1);
 assert.equal((await db.query("select count(*)::int n from public.icash_title_tasks where reply_id=$1 and kind='reply_review'",[original.id])).rows[0].n,1);
 console.log('PASS native original source: bounded migration contention, two authenticated concurrent inserts retain one original source/review task, and no timestamp or body replacement.');
}catch(e){console.error(e.message,e.code,e.where);process.exitCode=1;}finally{
 if(clients[1])await clients[1].query('rollback').catch(()=>{});if(pending)await pending.catch(()=>{});
 await Promise.allSettled(clients.map(async c=>{try{await c.query('rollback');}finally{await c.end();}}));
}
