/** Real races against fixed disposable localhost PostgreSQL. No providers. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setupSql,seedSql,patch} from '../tests/helpers/ranker-rotation-fixture.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const connect=async(name)=>{
 const client=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',application_name:name,connectionTimeoutMillis:5000});
 await client.connect();await client.query("set statement_timeout='8s';set timezone='UTC';");return client;
};
const observer=await connect('ranker-rotation-observer');
const sql=async(query,args=[])=>{const result=await observer.query(query,args);return result.rows?.[0]?Object.values(result.rows[0])[0]:null;};
const claim=async()=>{
 const client=await connect('ranker-rotation-contender');
 try{await client.query('set role service_role;');return (await client.query("select public.icash_claim_ranker_training()->'sampling' as result")).rows[0].result;}
 finally{await client.end();}
};
const setup=async()=>{
 assert.equal(await sql('select current_database()'),'icash_reliability');
 await sql('drop schema if exists icash_ranker_private cascade;drop schema if exists icash_learning_private cascade;drop schema public cascade;create schema public;');
 await sql("do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end$$;");
 await sql(setupSql);await sql(seedSql);await sql(patch);
 await sql('alter role service_role bypassrls;grant usage on schema public to service_role;grant select on all tables in schema public to service_role;');
};
const waitForLock=async()=>{
 const deadline=Date.now()+5000;
 while(!await sql("select exists(select 1 from pg_stat_activity where application_name='ranker-rotation-contender' and wait_event_type='Lock')")){
  assert(Date.now()<deadline,'Training claim did not reach expected lock');await new Promise(resolve=>setTimeout(resolve,25));
 }
};
try{
 await setup();
 const results=await Promise.all(Array.from({length:24},()=>claim())),winners=results.filter(Boolean);
 assert.equal(winners.length,1);assert.equal(winners[0].sequence,1);assert.equal(winners[0].selected,5000);assert.equal(winners[0].remainingUnseen,7800);
 assert.equal(await sql('select count(*)::integer from icash_ranker_private.samples where last_export_sequence=1'),5000);
 assert.equal(await sql('select export_sequence::integer from icash_ranker_private.settings'),1);
 let receipt;
 for(const expected of [2,3]){
  await sql('update icash_ranker_private.settings set lease_until=null;');receipt=await claim();
  assert.equal(receipt.sequence,expected);assert.equal(receipt.selected,5000);
 }
 assert.equal(receipt.remainingUnseen,0);assert.equal(await sql('select count(*)::integer from icash_ranker_private.samples where last_export_sequence=0'),0);
 // Disable while a contender waits for the original singleton row: neither
 // admission nor rotation may precede that newly committed control.
 await setup();let blocker=await connect('ranker-disable-holder');
 try{
  await blocker.query('begin;update icash_ranker_private.settings set enabled=false;');
  const pending=claim();await waitForLock();await blocker.query('commit');assert.equal(await pending,null);
  assert.equal(await sql('select export_sequence::integer from icash_ranker_private.settings'),0);
 }finally{await blocker.end();}
 // Rotation marks roll back atomically with admission. A concurrent source
 // refresh is retained: marking updates only the new rotation metadata.
 await setup();await sql('begin;select public.icash_claim_ranker_training();rollback;');
 assert.equal(await sql('select export_sequence::integer from icash_ranker_private.settings'),0);
 assert.equal(await sql('select count(*)::integer from icash_ranker_private.samples where last_export_sequence<>0'),0);
 blocker=await connect('ranker-label-holder');
 try{
  await blocker.query('begin;update icash_ranker_private.samples set interest=1;');
  const pending=claim();await waitForLock();await blocker.query('commit');assert.equal((await pending).sequence,1);
  assert.equal(await sql('select count(*)::integer from icash_ranker_private.samples where interest=1'),12800);
  assert.equal(await sql('select count(*)::integer from icash_ranker_private.samples where last_export_sequence=1'),5000);
 }finally{await blocker.end();}
 console.log('PASS native ranker rotation:24 competing claims, bounded full coverage, late disable, atomic rollback and concurrent labels preserved.');
}finally{await observer.end();}
