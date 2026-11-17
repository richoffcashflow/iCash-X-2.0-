import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
import {setup,baseline,cases,scenario,inbound,rpc,atomicMigration} from '../tests/helpers/seller-atomic-memory-fixture.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const clients=[];let pending;
async function connect(name){const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',application_name:'seller-memory-'+name,connectionTimeoutMillis:5000});clients.push(c);await c.connect();await assertDisposablePostgresTarget(c);await c.query("set statement_timeout='12s';set lock_timeout='10s';set timezone='UTC'");c.exec=sql=>c.query(sql);return c;}
async function blocked(db,pid,holder){for(const deadline=Date.now()+4000;Date.now()<deadline;){const r=(await db.query('select wait_event_type,$2::int=any(pg_blocking_pids(pid)) held from pg_stat_activity where pid=$1',[pid,holder])).rows[0];if(r?.wait_event_type==='Lock'&&r.held)return;await new Promise(r=>setTimeout(r,10));}assert.fail('Actual concurrent operation did not visibly wait on expected source fence');}
try{
 const db=await connect('admin'),first=await connect('first'),second=await connect('second'),third=await connect('third');
 await db.exec('drop schema if exists icash_seller_agreement_memory_private,icash_seller_memory_private,icash_seller_agreement_private,icash_recorded_reception_private,icash_call_offer_private,icash_callback_private,icash_reception_private,auth cascade;drop schema public cascade;create schema public;');
 await setup(db);await baseline(db);
 const migration=atomicMigration(),before=(await db.query("select md5(pg_get_functiondef('public.icash_claim_seller_agreement(text,text,jsonb,jsonb,jsonb)'::regprocedure)) hash")).rows[0].hash;
 await first.query('begin;select pg_advisory_xact_lock(726341927)');
 await assert.rejects(db.exec('begin;'+migration+'commit;'),e=>e.code==='55P03');await db.query('rollback');await first.query('rollback');
 assert.equal((await db.query("select md5(pg_get_functiondef('public.icash_claim_seller_agreement(text,text,jsonb,jsonb,jsonb)'::regprocedure)) hash")).rows[0].hash,before);
 assert.equal((await db.query("select to_regnamespace('icash_seller_agreement_memory_private') namespace")).rows[0].namespace,null);
 await db.exec('begin;'+migration+'commit;');await cases(db);
 const pid1=(await first.query('select pg_backend_pid() pid')).rows[0].pid,pid2=(await second.query('select pg_backend_pid() pid')).rows[0].pid;
 let i=200;
 for(const order of ['claim-first','source-first','source-after-transaction-start']){
  const s=await scenario(db,{phone:'+12125550'+String(++i).padStart(3,'0')});
  await first.query('begin');await second.query('begin');
  if(order==='claim-first'){
   assert((await s.claim(first))?.claimed);pending=s.incoming(second);pending.catch(()=>{});await blocked(db,pid2,pid1);
   const other=await scenario(db,{phone:'+12125550'+String(++i).padStart(3,'0')});assert((await other.claim(third))?.claimed,'independent account claim progresses during another recipient wait');
   await first.query('commit');await pending;pending=null;await second.query('commit');
   await assert.rejects(s.begin(),/memory|source|admission/i);
  }else{
   // In the last case the claim transaction began before the actual writer.
   // Incoming-created-at must not disappear behind transaction_timestamp().
   if(order==='source-after-transaction-start'){await first.query('rollback');await new Promise(r=>setTimeout(r,20));await first.query('begin');}
   await s.incoming(first);pending=s.claim(second);pending.catch(()=>{});await blocked(db,pid2,pid1);
   await first.query('commit');assert.equal(await pending,null);pending=null;await second.query('commit');
  }
 }
 const writers=[
  {name:'delivery-receipt',prepare:async s=>{const id=randomUUID(),provider=randomUUID();await db.query("insert into icash_text_messages(id,account_id,thread_id,direction,state,body,provider_id,created_at) values($1,$2,$3,'outgoing','accepted','Synthetic original question',$4,now()-interval '5 seconds')",[id,s.account,s.thread,provider]);return {write:c=>rpc(c,'icash_ingest_text_event_before_operational',{p_event:{id:randomUUID(),type:'text.delivery.confirmed',timestamp:Date.now()/1000,data:{message_id:provider,from:'+14243948384',to:s.phone}},p_optout:false})};}},
  {name:'outbound-result',prepare:async s=>({write:c=>rpc(c,'icash_save_live_result',{p_call:s.call,p_result:{party:'seller',summary:'Synthetic changed facts',transcript:[{role:'user',message:'There is a mortgage.'}],humanRequested:false,optedOut:false}})})},
  {name:'legacy-inbound',unchanged:true,prepare:async s=>{const x=await inbound(s,{ended:true});assert.equal(await x.history(),true);return {write:x.history};}},
  {name:'full-inbound-source',prepare:async s=>{const x=await inbound(s,{ended:true});assert.equal(await x.history(),true);return {write:c=>rpc(c,'icash_save_seller_memory_inbound_history',{p_session:x.id,p_conversation:x.conversation,p_transcript:x.transcript.map(t=>({...t,at:'2020-01-01T00:00:00Z'}))})};}},
  {name:'source-retention-cache',unchanged:true,prepare:async s=>{const x=await inbound(s,{ended:true});assert.equal(await x.history(),true);const source=await s.context();return {write:c=>rpc(c,'icash_save_seller_memory',{p_account:s.account,p_screening:s.screen,p_phone:s.phone,p_fingerprint:source.fingerprint,p_projection:{version:'seller-memory-v1',facts:{}}})};}},
  {name:'terminal-transition',prepare:async s=>{const x=await inbound(s);return {write:x.terminal};}},
  {name:'terminal-outer-finish',prepare:async s=>{const x=await inbound(s);return {write:x.finish};}},
 ];
 for(const writer of writers)for(const order of ['claim-first','source-first']){
  const s=await scenario(db,{phone:'+12125550'+String(++i).padStart(3,'0')}),w=await writer.prepare(s);s.args.p_memory_fingerprint=(await s.context()).fingerprint;
  await first.query('begin');await second.query('begin');
  if(order==='claim-first'){
   assert((await s.claim(first))?.claimed);pending=w.write(second);pending.catch(()=>{});await blocked(db,pid2,pid1);
   await first.query('commit');await pending;pending=null;await second.query('commit');
   if(writer.unchanged)assert((await s.begin())?.id,writer.name+' exact same source remains admitted');else await assert.rejects(s.begin(),/memory|source|admission/i,writer.name+' source after claim holds creation');
  }else{
   await w.write(first);pending=s.claim(second);pending.catch(()=>{});await blocked(db,pid2,pid1);
   await first.query('commit');const result=await pending;pending=null;if(writer.unchanged)assert(result?.claimed,writer.name+' exact original retains authority');else assert.equal(result,null,writer.name+' source before claim rejects stale source');await second.query('commit');
  }
 }
 console.log('PASS native seller source admission: actual SMS, outbound result, legacy inbound and terminal writers in both orders; late transaction source, independent account progress, exact migration rollback, original document and final text held. No provider operations.');
}catch(e){console.error(e.stack,e.where??'');process.exitCode=1;}finally{
 if(clients[1])await clients[1].query('rollback').catch(()=>{});if(clients[2])await clients[2].query('rollback').catch(()=>{});if(pending)await pending.catch(()=>{});
 await Promise.allSettled(clients.map(async c=>{try{await c.query('rollback');}finally{await c.end();}}));
}
