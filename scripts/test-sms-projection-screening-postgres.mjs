// Exact projection and migration on a fixed disposable localhost database.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
import {install,verify,value,id} from '../tests/helpers/sms-projection-screening-fixture.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const options={host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',connectionTimeoutMillis:5000};
const db=new Client({...options,application_name:'sms-projection-fixture'});
const clients=[];
const connect=async name=>{const c=new Client({...options,application_name:name});clients.push(c);await c.connect();await assertDisposablePostgresTarget(c);await c.query("set statement_timeout='8s';set lock_timeout='6s'");return c;};
try{
 await db.connect();await assertDisposablePostgresTarget(db);
 await db.query("set timezone='UTC';set statement_timeout='8s';drop schema public cascade;create schema public");
 await install(db);const result=await verify(db);
 const a=await connect('sms-projection-contender-a'),b=await connect('sms-projection-contender-b');
 const prepared=await Promise.all([a,b].map(c=>value(c,'select public.icash_project_operational_sms_contacts(null)')));
 assert.deepEqual(prepared.sort(),[0,1],'Concurrent projections create the valid thread once');
 assert.equal(await value(db,'select count(*)::int from public.icash_text_threads'),1);
 // Freeze the original source check after the new screening hint, then mutate
 // current controls. The unchanged final loop must still reject the contact.
 await db.query(`create or replace function public.icash_operational_contact_current(uuid,uuid,text,boolean)
  returns boolean language plpgsql as $$begin perform pg_advisory_xact_lock(198214);
  return (select source_ok from public.fixture_policy);end$$;`);
 for(const [label,change] of [
  ['Pause',"update public.icash_accounts set bot_paused=true where id='"+id(126)+"'"],
  ['manual control',"insert into public.icash_property_controls values('"+id(126)+"','synthetic-126',true)"],
  ['expired screening',"update public.icash_screening_jobs set completed_at=now()-interval '25 hours' where id='"+id(10126)+"'"],
  ['withdrawn source',"update public.fixture_policy set source_ok=false"],
  ['empty wallet',"update public.icash_wallets set balance_cents=0 where account_id='"+id(126)+"'"],
 ]){
  await db.query(`truncate public.icash_text_threads,public.icash_deal_files,public.icash_property_controls;
   update public.icash_accounts set bot_paused=false;
   update public.icash_wallets set balance_cents=10000;
   update public.fixture_policy set source_ok=true;
   update public.icash_screening_jobs set completed_at=now() where id='${id(10126)}';`);
  await b.query('begin;select pg_advisory_xact_lock(198214)');
  const pending=value(a,'select public.icash_project_operational_sms_contacts(null)');
  try{
   let waiting=false;
   for(let n=0;n<100;n++){
    waiting=await value(db,"select exists(select 1 from pg_stat_activity where application_name='sms-projection-contender-a' and wait_event_type='Lock')");
    if(waiting)break;await delay(20);
   }
   assert(waiting,'Projection reached the pre-lock source proof');
   await db.query(change);await b.query('commit');
   assert.equal(await pending,0,label+' is honored after early selection');
   assert.equal(await value(db,'select count(*)::int from public.icash_text_threads'),0);
  }finally{await b.query('rollback');await pending.catch(()=>{});}
 }
 console.log('Native SMS projection screening PASS',result,'Concurrent one-use and five late-control races passed.');
}finally{await Promise.all(clients.map(c=>c.end()));await db.end();}
