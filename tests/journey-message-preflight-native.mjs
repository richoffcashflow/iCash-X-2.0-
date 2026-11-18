// Explicit disposable PostgreSQL only. The supplied pg module is local; no
// remote URL, production database, transport or real billing is accepted.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {api,setup,reset,migration,ids,functionSql} from './helpers/journey-message-preflight-fixture.mjs';
assert.equal(process.env.JOURNEY_NATIVE_TEST,'1','Explicit local native test opt-in required');
const port=Number(process.env.JOURNEY_NATIVE_PORT||55443);assert(Number.isInteger(port)&&port>1024&&port<=65535&&port!==5432);
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||process.argv[2]||'pg');
const connection={host:'127.0.0.1',port,user:'postgres',password:'isolated-fixture-only',connectionTimeoutMillis:5000},database='journey_retry_'+randomBytes(8).toString('hex');
const connect=async(db)=>{const c=new Client({...connection,database:db});await c.connect();await c.query("set statement_timeout='8s';set lock_timeout='5s'");return c;};
const admin=await connect('postgres'),clients=[];
const adapter=c=>({exec:sql=>c.query(sql),query:(sql,args)=>c.query(sql,args)});
const pause=()=>new Promise(resolve=>setTimeout(resolve,10));
try{
 await admin.query('create database '+database);
 const main=await connect(database);clients.push(main);const pg=adapter(main),{claim,due,state}=api(pg);
 await setup(pg);
 const a=await connect(database),b=await connect(database);clients.push(a,b);
 const aa=api(adapter(a)),bb=api(adapter(b));
 const blocked=async(pid)=>{
  for(let n=0;n<200;n++){
   if((await main.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1",[pid])).rows[0]?.blocked)return;
   await pause();
  }
  assert.fail('Expected fixture lock contention did not occur');
 };
 const pidA=(await a.query('select pg_backend_pid() pid')).rows[0].pid;
 const pidB=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
 const definition=async()=>(await main.query("select md5(pg_get_functiondef('icash_claim_journey_message()'::regprocedure)) hash")).rows[0].hash;
 await main.query('create table fixture_migration_ledger(version text primary key)');
 // No embedded commit: a ledger failure rolls back the replacement too.
 await a.query('begin');await a.query(migration);
 await a.query("insert into fixture_migration_ledger values('20261116224226')");
 await assert.rejects(a.query("insert into fixture_migration_ledger values('20261116224226')"),/duplicate key/);await a.query('rollback');
 assert.equal(await definition(),'a7dddbab7991f436420991832688f09a');
 assert.equal((await main.query('select count(*)::int n from fixture_migration_ledger')).rows[0].n,0);
 // The shared source-patch advisory lock serializes migrations before their
 // predecessor check. Only the first runner commits its function plus ledger.
 await a.query('begin');await a.query(migration);await a.query("insert into fixture_migration_ledger values('20261116224226')");
 await b.query('begin');const secondPatch=assert.rejects(b.query(migration),/prerequisite changed/);
 await blocked(pidB);
 assert((await main.query("select exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted) waiting",[pidB])).rows[0].waiting);
 assert.equal(await definition(),'a7dddbab7991f436420991832688f09a');
 await a.query('commit');await secondPatch;await b.query('rollback');
 assert.equal(await definition(),'20ccd9d013a36491533cb033e218067c');
 assert.equal((await main.query('select count(*)::int n from fixture_migration_ledger')).rows[0].n,1);
 // Use the repository's actual original base claim for its unchanged budget,
 // recipient advisory and text-row locking + ready->dispatching primitive.
 // This is intentionally not a reconstruction of every later policy wrapper.
 await pg.exec(`
 create table icash_operating_budget(id integer primary key);insert into icash_operating_budget values(1);
 alter table icash_text_threads add column sender text default '+12145550102',add column permission_until timestamptz default now()+interval '1 day',add column permission_evidence text default 'Fixture permission only',add column dnc_clear boolean default true,add column dnc_checked_at timestamptz default now(),add column timezone text default 'UTC',add column sms_rate_id uuid default '${ids.other}',add column mms_rate_id uuid;
 alter table icash_text_messages add column direction text default 'outgoing',add column asset_ids uuid[] default '{}',add column attachments jsonb default '[]',add column updated_at timestamptz default now();
 create table icash_text_senders(phone text,enabled boolean);insert into icash_text_senders values('+12145550102',true);
 create table icash_text_assets(id uuid,account_id uuid,deal_id uuid,verified_until timestamptz,url text);
 create table icash_operation_rates(id uuid,operation text,enabled boolean,expires_at timestamptz);insert into icash_operation_rates values('${ids.other}','sms_send',true,now()+interval '1 day');
 create table fixture_operations(key text primary key,claimed boolean default false);
 create function icash_reserve_operation(uuid,text,uuid,timestamptz) returns void language sql as $$insert into public.fixture_operations(key) values($2) on conflict do nothing$$;
 create function icash_claim_operation(text) returns boolean language plpgsql as $$begin update public.fixture_operations set claimed=true where key=$1 and not claimed;return found;end$$;
 drop function icash_claim_text_before_journey(uuid,uuid,text);
 `);
 await pg.exec(functionSql('config/text-messaging.sql','icash_claim_text').replace('public.icash_claim_text(','public.icash_claim_text_before_journey('));
 const resetFixture=async()=>{
  // Explicit columns allow the shared fixture to coexist with real base fields.
  await pg.exec(reset.replace('insert into icash_text_threads values','insert into icash_text_threads(id,account_id,deal_id,paused,manual_only,retired_at,recipient) values'));
  await pg.exec("truncate fixture_operations;update icash_text_threads set timezone=(select name from pg_timezone_names where extract(hour from now() at time zone name)=12 order by name limit 1)");
 };

 // The existing SKIP LOCKED + 30-minute lease admits one selector only.
 await resetFixture();await a.query('begin');const selected=await aa.claim();assert(selected);
 assert.equal(await bb.claim(),null);await a.query('commit');assert.equal(await bb.claim(),null);
 assert.equal((await state()).attempts,1);assert.equal((await main.query('select count(*)::int n from icash_text_messages')).rows[0].n,1);

 // Two recovered dispatches serialize on the real original base locks; only
 // one reserves/claims the original operation and changes its text state.
 await due();await a.query('begin');assert(await aa.final());
 const concurrent=bb.final();await blocked(pidB);await a.query('commit');assert.equal(await concurrent,null);
 assert.equal((await main.query('select count(*)::int n from fixture_operations where claimed')).rows[0].n,1);
 assert.equal((await state()).text_state,'dispatching');await due();assert.equal(await claim(),null);assert.equal((await state()).state,'needs_review');

 // Receipt wins the text-row lock after the journey selector but before the
 // atomic final claim. Its newer accepted state suppresses the send.
 await resetFixture();assert(await claim());await a.query('begin');
 await a.query("update icash_text_messages set state='accepted',provider_id='fixture-receipt'");
 const afterReceipt=bb.final();await blocked(pidB);await a.query('commit');assert.equal(await afterReceipt,null);
 assert.equal((await main.query('select count(*)::int n from fixture_operations')).rows[0].n,0);
 await due();assert.equal(await claim(),null);assert.equal((await state()).state,'sent');

 // A receipt can commit while a selector owns the journey row: no new text
 // lock was added and the final claim sees the original receipt, not a resend.
 await resetFixture();assert(await claim());await due();await a.query('begin');assert(await aa.claim());
 await b.query("update icash_text_messages set state='delivered',provider_id='fixture-receipt'");
 await a.query('commit');assert.equal(await bb.final(),null);await due();assert.equal(await claim(),null);assert.equal((await state()).state,'sent');

 // The dispatch claims first, then a receipt waits for that same text row.
 // Commit-response uncertainty leaves dispatching; no later selector replays.
 await resetFixture();assert(await claim());await a.query('begin');assert(await aa.final());
 const receipt=b.query("update icash_text_messages set state='delivered',provider_id='fixture-receipt' where id=$1",[ids.message]);
 await blocked(pidB);await a.query('commit');await receipt;
 assert.equal(await bb.final(),null);await due();assert.equal(await claim(),null);assert.equal((await state()).state,'sent');

 // A newly committed STOP wins its original recipient advisory lock. The
 // final claim blocks and rechecks suppression before any operation exists.
 await resetFixture();assert(await claim());await b.query('begin');
 await b.query("select pg_advisory_xact_lock(hashtextextended('+12145550101',74))");
 await b.query("insert into icash_text_suppressions values('+12145550101')");
 const afterStop=aa.final();await blocked(pidA);await b.query('commit');assert.equal(await afterStop,null);
 assert.equal((await main.query('select count(*)::int n from fixture_operations')).rows[0].n,0);
 console.log('PASS native PostgreSQL: atomic migration/ledger rollback, serialized source patches, concurrent selection, one-use base dispatch, receipt races and STOP race.');
}finally{
 await Promise.allSettled(clients.map(c=>c.end()));
 await admin.query('drop database if exists '+database+' with (force)');await admin.end();
}
