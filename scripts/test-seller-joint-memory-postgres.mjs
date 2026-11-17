import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
import {setup,cases,directCases,jointScenario} from '../tests/helpers/seller-joint-memory-fixture.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
globalThis.fetch=async()=>{throw Error('NO NETWORK: ordered seller source fixture only');};
const clients=[];let pending;
async function connect(name){const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',application_name:'seller-joint-'+name,connectionTimeoutMillis:5000});clients.push(c);await c.connect();await assertDisposablePostgresTarget(c);await c.query("set statement_timeout='12s';set lock_timeout='10s';set timezone='UTC'");c.exec=sql=>c.query(sql);return c;}
async function blocked(db,pid,holder){for(const deadline=Date.now()+4000;Date.now()<deadline;){const r=(await db.query('select wait_event_type,$2::int=any(pg_blocking_pids(pid)) held from pg_stat_activity where pid=$1',[pid,holder])).rows[0];if(r?.wait_event_type==='Lock'&&r.held)return;await new Promise(r=>setTimeout(r,10));}assert.fail('Original source writer did not visibly wait on exact recipient fence');}
try{
 const db=await connect('admin'),first=await connect('first'),second=await connect('second'),third=await connect('third');
 await db.exec('drop schema if exists icash_seller_call_source_private,icash_seller_agreement_memory_private,icash_seller_memory_private,icash_seller_agreement_private,icash_recorded_reception_private,icash_call_offer_private,icash_callback_private,icash_reception_private,auth cascade;drop schema public cascade;create schema public;');
 await setup(db);await cases(db);await directCases(db);
 const pid1=(await first.query('select pg_backend_pid() pid')).rows[0].pid,pid2=(await second.query('select pg_backend_pid() pid')).rows[0].pid;
 for(const writer of ['sms','raw-completion'])for(const order of ['claim-first','source-first']){
  const s=await jointScenario(db);await s.historical();s.args.p_memory_fingerprint=(await s.context()).fingerprint;
  await first.query('begin');await second.query('begin');
  const write=client=>writer==='sms'?s.incoming(client,'Wait, I have another mortgage.'):s.complete(undefined,x=>x,client);
  if(order==='claim-first'){
   assert((await s.claim(first))?.claimed);pending=write(second);pending.catch(()=>{});await blocked(db,pid2,pid1);
   const other=await jointScenario(db);assert((await other.claim(third))?.claimed,'unrelated phone progresses during actual raw+SMS fence wait');
   await first.query('commit');await pending;pending=null;await second.query('commit');await assert.rejects(s.begin(),/source|memory/i);
  }else{
   await write(first);pending=s.claim(second);pending.catch(()=>{});await blocked(db,pid2,pid1);
   await first.query('commit');assert.equal(await pending,null);pending=null;await second.query('commit');
  }
 }
 console.log('PASS native actual receipt→atomic→raw migrations, TS direct/deferred consumers, final owned-link claim, same-phone races and unrelated progress; financial/provider sentinels only.');
}catch(error){console.error(error.stack,error.where??'');process.exitCode=1;}finally{
 for(const client of clients)await client.query('rollback').catch(()=>{});if(pending)await pending.catch(()=>{});await Promise.allSettled(clients.map(c=>c.end()));
}
