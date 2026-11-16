// Disposable native PostgreSQL only. CI mapping is the repository's localhost
// PostgreSQL service; local opt-in uses a different fixed port. No URLs/secrets.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Client,connection} from '../tests/helpers/discovery-opener-refresh-native-db.mjs';
import {createDiscoveryOpenerRefreshFixture} from '../tests/helpers/discovery-opener-refresh-fixture.mjs';
import {verifyDiscoveryOpenerRefresh} from '../tests/helpers/discovery-opener-refresh-assertions.mjs';
const fixtureRoles=['anon','authenticated','service_role'];
const admin=new Client({...connection,database:'postgres'});let created=false,priorRoles=null,f,a,b,c;
try{
 await admin.connect();
 assert.equal((await admin.query('select current_database() db')).rows[0].db,'postgres');
 assert.equal((await admin.query('select 1 from pg_database where datname=$1',[connection.database])).rowCount,0,'Dedicated fixture database must not preexist');
 // Roles are cluster-global even though all fixture objects use a dedicated DB.
 // This runner is sequential; retain every role that existed before its setup.
 priorRoles=new Set((await admin.query('select rolname from pg_roles where rolname=any($1::text[])',[fixtureRoles])).rows.map(row=>row.rolname));
 await admin.query('create database icash_discovery_refresh_test');created=true;
 f=await createDiscoveryOpenerRefreshFixture(new URL('../tests/helpers/discovery-opener-refresh-native-db.mjs',import.meta.url).pathname,{skipRenewal:true});
 a=new Client({...connection,application_name:'discovery-refresh-holder'});b=new Client({...connection,application_name:'discovery-refresh-contender'});c=new Client({...connection,application_name:'discovery-refresh-conflicting-receipt'});
 await a.connect();await b.connect();await c.connect();
 await a.query("set timezone='UTC';set statement_timeout='10s';set lock_timeout='8s'");await b.query("set timezone='UTC';set statement_timeout='10s';set lock_timeout='8s'");await c.query("set timezone='UTC';set statement_timeout='10s';set lock_timeout='8s'");
 const aid=(await a.query('select pg_backend_pid() pid')).rows[0].pid,bid=(await b.query('select pg_backend_pid() pid')).rows[0].pid,cid=(await c.query('select pg_backend_pid() pid')).rows[0].pid;
 const migration=readFileSync(new URL('../supabase/migrations/20261116183352_discovery_opener_refresh.sql',import.meta.url),'utf8');
 await f.pg.exec('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key);');
 const absent=async()=>assert.equal((await f.one("select to_regnamespace('icash_discovery_refresh_private') present")).present,null);
 const waitBlocked=async(waiter,holder)=>{
  for(let n=0;n<200;n++){
   if((await f.one('select $2::int=any(pg_blocking_pids($1)) blocked',[waiter,holder])).blocked)return;
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.fail('Expected native shared migration lock contention');
 };
 // The shared source lock is taken before any DDL. A bounded wait must leave
 // both schema and migration receipt absent.
 await a.query('begin;select pg_advisory_xact_lock(726341927)');
 const timedOut=b.query('begin;'+migration+'commit;');timedOut.catch(()=>{});
 await waitBlocked(bid,aid);await assert.rejects(timedOut,error=>error.code==='55P03');
 await b.query('rollback');await a.query('rollback');await absent();
 assert.equal((await f.one('select count(*)::int n from supabase_migrations.schema_migrations')).n,0);
 // Real ledger insertion failure rolls every function and table back together.
 await f.q("insert into supabase_migrations.schema_migrations values('duplicate-fixture')");
 await assert.rejects(a.query('begin;'+migration+"insert into supabase_migrations.schema_migrations values('duplicate-fixture');commit;"),error=>error.code==='23505');
 await a.query('rollback');await absent();
 // Two full installers serialize; the second must reject the already installed
 // schema and cannot add another receipt or change the first replacement.
 await a.query('begin;'+migration+"insert into supabase_migrations.schema_migrations values('20261116183352');");
 const second=b.query('begin;'+migration+"insert into supabase_migrations.schema_migrations values('20261116183352');commit;");second.catch(()=>{});
 await waitBlocked(bid,aid);await a.query('commit');
 await assert.rejects(second,error=>error.code==='42P06');await b.query('rollback');
 assert.equal((await f.one("select count(*)::int n from supabase_migrations.schema_migrations where version='20261116183352'")).n,1);
 assert.equal((await f.one('select enabled from icash_discovery_refresh_private.policy')).enabled,false);
 console.log('PASS native installer: bounded shared source lock, actual ledger rollback, and competing full installs with one immutable receipt.');
 await b.query('set role service_role');await c.query('set role service_role');
 console.log('PASS native common assertions',await verifyDiscoveryOpenerRefresh(f,{issuer:false}));
 const original=await f.one('select to_jsonb(t) value from icash_text_threads t where id=$1',[f.thread]);
 const sourceHash=(await f.one("select encode(sha256(convert_to(icash_discovery_refresh_private.snapshot($1)::text,'UTF8')),'hex') h",[f.message])).h;
 const prepare='select icash_prepare_discovery_opener_refresh($1,$2,$3) id',args=[f.message,sourceHash,'SIMULATION concurrent exact original review'];
 await a.query('begin');const id=(await a.query(prepare,args)).rows[0].id;assert(id);
 const competing=b.query(prepare,args);competing.catch(()=>{});
 let observed=false;for(let n=0;n<200;n++){const state=await f.one('select $2::int=any(pg_blocking_pids($1)) blocked',[bid,aid]);if(state.blocked){observed=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
 assert(observed,'second actual backend waits on original scheduler admission lock');
 await a.query('commit');assert.equal((await competing).rows[0].id,null,'only one renewal');
 const r=await f.ready(id,{recordProperty:async(request,raw)=>{
  // Synthetic settled-money fixture; these are real first receipt writes, not
  // concurrent paid acquisition, quota admission or actual-cost settlement.
  const record='select icash_record_discovery_opener_refresh($1,$2,$3,$4) saved';
  const receipt=[request.id,request.quota_request_id,200,raw];
  const before=(await f.one('select to_jsonb(q) value from icash_discovery_refresh_private.requests q where id=$1',[request.id])).value;
  assert.equal(before.response_at,null);
  assert.equal((await b.query(record,[request.id,'00000000-0000-4000-8000-000000000000',200,raw])).rows[0].saved,false,'wrong original quota request cannot persist evidence');
  assert.deepEqual((await f.one('select to_jsonb(q) value from icash_discovery_refresh_private.requests q where id=$1',[request.id])).value,before);
  await a.query('begin');assert.equal((await a.query(record,receipt)).rows[0].saved,true);
  const originalReceipt=(await a.query('select to_jsonb(q) value from icash_discovery_refresh_private.requests q where id=$1',[request.id])).rows[0].value;
  const duplicate=b.query(record,receipt);duplicate.catch(()=>{});
  const conflicting=c.query(record,[request.id,request.quota_request_id,200,{...raw,credits:{...raw.credits,used:0,deduplicated:1}}]);conflicting.catch(()=>{});
  let bothBlocked=false;
  for(let n=0;n<200;n++){
   const state=await f.one('select pg_blocking_pids($2) && array[$1::int,$3::int] and pg_blocking_pids($3) && array[$1::int,$2::int] and ($1::int=any(pg_blocking_pids($2)) or $1::int=any(pg_blocking_pids($3))) blocked',[aid,bid,cid]);
   if(state.blocked){bothBlocked=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert(bothBlocked,'identical and conflicting receipt writers wait on the first original receipt');
  await a.query('commit');
  assert.equal((await duplicate).rows[0].saved,true,'lost acknowledgement can recover by identical persistence');
  assert.equal((await conflicting).rows[0].saved,false,'concurrent conflicting receipt cannot replace the first body');
  assert.equal((await b.query(record,[request.id,request.quota_request_id,500,raw])).rows[0].saved,false,'conflicting status cannot replace the first status');
  assert.deepEqual((await f.one('select to_jsonb(q) value from icash_discovery_refresh_private.requests q where id=$1',[request.id])).value,originalReceipt,'original body, status, timestamp and all request bindings remain exact');
  assert.equal((await f.one('select count(*)::int n from icash_discovery_refresh_private.requests where renewal_id=$1',[id])).n,1);
  console.log('PASS native first receipt persistence: observed identical/conflicting writer locks, same-body acknowledgement recovery and immutable original receipt.');
 }});
 const apply='select icash_apply_discovery_opener_refresh($1) applied';
 // An uncommitted Pause holds the account row, so NOWAIT must yield; the
 // committed Pause must also refuse, rather than using a stale snapshot.
 await a.query('begin');await a.query('update icash_accounts set bot_paused=true where id=$1',[f.account]);
 assert.equal((await b.query(apply,[r.review])).rows[0].applied,false,'late locked Pause yields');
 await a.query('commit');assert.equal((await b.query(apply,[r.review])).rows[0].applied,false,'committed Pause wins');
 await a.query('update icash_accounts set bot_paused=false where id=$1',[f.account]);
 // Same recipient lock as STOP/dispatch: an admitted STOP blocks apply, and
 // the subsequent committed suppression remains authoritative.
 await a.query('begin');await a.query('select pg_advisory_xact_lock(hashtextextended($1,74))',[f.phone]);
 await a.query("insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION concurrent STOP')",[f.phone]);
 assert.equal((await b.query(apply,[r.review])).rows[0].applied,false,'recipient lock yields');
 await a.query('rollback'); // Never erase a committed STOP or its revocations to make apply pass.
 assert.deepEqual(await f.one('select to_jsonb(t) value from icash_text_threads t where id=$1',[f.thread]),original,'failed concurrent applies leave original thread exact');
 // Competing actual apply transactions cannot both consume the review.
 await a.query('begin');assert.equal((await a.query(apply,[r.review])).rows[0].applied,true);
 assert.equal((await b.query(apply,[r.review])).rows[0].applied,false,'concurrent apply yields');
 await a.query('commit');assert.equal((await b.query(apply,[r.review])).rows[0].applied,false,'committed apply is one use');
 assert.equal((await f.one('select count(*)::int n from icash_discovery_refresh_private.applies')).n,1);
 assert.equal((await f.one('select count(*)::int n from icash_text_messages')).n,1);
 assert.equal((await f.one("select count(*)::int n from icash_operation_spend where operation_key like 'text:%'")).n,0);
 const issued=await f.rpc('icash_recover_unstarted_seller_opener',{});assert(issued?.token,'real ordinary issuer admits refreshed draft in following transaction');
 assert.equal((await f.one('select issue_attempts from icash_automation_tickets where token=$1',[issued.token])).issue_attempts,2);
 assert.equal((await f.one("select count(*)::int n from icash_operation_spend where operation_key like 'text:%'")).n,0);
 await a.query("insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION final committed STOP')",[f.phone]);
 const successor=(await f.one('select successor_contact_id id from icash_discovery_refresh_private.renewals where id=$1',[r.id])).id;
 assert.equal((await a.query("select icash_operational_contact_current($1,$2,'sms',false) allowed",[f.account,successor])).rows[0].allowed,false,'committed STOP revokes new contact');
 console.log('PASS native PostgreSQL contention: observed competing-prepare lock, late Pause, late STOP, one-use competing apply, no send/operation.');
}catch(error){console.error(error.stack,error.cause?.where??error.where??'');process.exitCode=1;}
finally{
 try{
  await a?.query('rollback').catch(()=>{});await b?.query('rollback').catch(()=>{});await c?.query('rollback').catch(()=>{});
  await a?.end();await b?.end();await c?.end();await f?.pg.close();
  if(created){
   await admin.query('drop database icash_discovery_refresh_test');
   // Drop only fixed, initially absent roles after their fixture dependencies
   // disappear. Never alter or drop a preexisting shared-cluster role.
   for(const role of fixtureRoles)if(!priorRoles.has(role))await admin.query('drop role if exists '+role);
  }
 }finally{await admin.end();}
}
