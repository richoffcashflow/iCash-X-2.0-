import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {setup,fixture,migration} from './helpers/seller-call-source-fixture.mjs';
import {sellerCallSource} from '../lib/seller-call-source.ts';
assert.equal(process.env.SELLER_CALL_SOURCE_NATIVE_TEST,'1','Explicit local disposable opt-in required');
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const connection={host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',connectionTimeoutMillis:5000};
const database='seller_raw_source_'+randomBytes(8).toString('hex');
const clients=[];const connect=async name=>{const c=new Client({...connection,database:name});await c.connect();await c.query("set statement_timeout='12s';set lock_timeout='5s'");return c;};
const admin=await connect('postgres');const adapter=c=>({query:(s,p)=>c.query(s,p),exec:s=>c.query(s)});
globalThis.fetch=async()=>{throw Error('NO NETWORK: isolated source receipts');};
try{
 await admin.query('create database '+database);const main=await connect(database),a=await connect(database),b=await connect(database);clients.push(main,a,b);await setup(adapter(main));
 await main.query('create table fixture_ledger(version text primary key)');
 const contextHash=async()=>(await main.query("select md5(pg_get_functiondef('public.icash_seller_memory_context(uuid,uuid,text)'::regprocedure)) h")).rows[0].h;
 await a.query('begin');await a.query(migration);await a.query("insert into fixture_ledger values('raw-v1')");await assert.rejects(a.query("insert into fixture_ledger values('raw-v1')"),/duplicate key/);await a.query('rollback');
 assert.equal(await contextHash(),'7a680dae86359988c3f70c705a3369b0');assert.equal((await main.query("select to_regnamespace('icash_seller_call_source_private') n")).rows[0].n,null);
 for(const sql of ["grant execute on function public.icash_seller_memory_context(uuid,uuid,text) to authenticated","alter function public.icash_seller_memory_context(uuid,uuid,text) security invoker","grant execute on function public.icash_save_live_result(uuid,jsonb) to authenticated","alter function public.icash_save_live_result(uuid,jsonb) security definer"]){
  await a.query('begin');await a.query(sql);await assert.rejects(a.query(migration),/predecessor changed/);await a.query('rollback');
 }
 await a.query('begin');await assert.rejects(a.query(migration.replace("begin raise exception 'Original call source evidence is immutable';","begin raise exception 'Changed fixture immutable guard';")),/Seller call source result changed/);await a.query('rollback');
 assert.equal(await contextHash(),'7a680dae86359988c3f70c705a3369b0');
 await a.query('begin');await a.query(migration);await a.query("insert into fixture_ledger values('raw-v1')");await a.query('commit');
 const f=await fixture(adapter(main));await f.activate();const incoming=await f.inbound([{role:'user',message:'Talk to a person.',time_in_call_secs:1}]);
 const call=(client,id,raw)=>client.query("select public.icash_capture_seller_call_source('inbound',$1,$2::jsonb) value",[id,JSON.stringify(sellerCallSource(raw))]);
 const waitForLock=async c=>{const pid=(await c.query('select pg_backend_pid() id')).rows[0].id;return pid;};
 const bpid=await waitForLock(b);
 const blocked=async pid=>{for(let i=0;i<150;i++){if((await main.query("select exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted) waiting",[pid])).rows[0].waiting)return;await new Promise(r=>setTimeout(r,10));}throw Error('recipient fence was not observed');};
 await a.query('begin');await a.query('select pg_advisory_xact_lock(hashtextextended($1,74))',[f.phone]);
 const pending=call(b,incoming.id,incoming.raw);await blocked(bpid);
 // Binding changes after the preliminary phone read must be re-read once the
 // recipient fence becomes available. No session row lock precedes that fence.
 await a.query("update icash_recorded_reception_private.sessions set from_phone='+12125550124',contact_key=encode(sha256(convert_to('+12125550124','UTF8')),'hex') where id=$1",[incoming.id]);await a.query('commit');
 assert.equal((await pending).rows[0].value,false);assert.equal((await main.query('select count(*)::int n from icash_seller_call_source_private.sources')).rows[0].n,0);
 await main.query('update icash_recorded_reception_private.sessions set from_phone=$1,contact_key=encode(sha256(convert_to($1,\'UTF8\')),\'hex\') where id=$2',[f.phone,incoming.id]);
 const outgoing=await f.outbound([{role:'user',message:'Original result.',time_in_call_secs:1}],{state:'waiting'});
 await a.query('begin');await a.query('select pg_advisory_xact_lock(hashtextextended($1,74))',[f.phone]);
 const outgoingResult={transcript:outgoing.raw.transcript,summary:'Original fictional call',party:'seller'};
 const waitingSave=b.query('select public.icash_save_live_result_with_source($1,$2::jsonb,$3::jsonb)',[outgoing.id,JSON.stringify(outgoingResult),JSON.stringify(sellerCallSource(outgoing.raw))]).then(()=>null,e=>e);
 await blocked(bpid);
 await a.query("update public.icash_call_recordings set conversation_id='conv_changed_while_waiting' where operation_key=(select operation_key from public.icash_live_conversations where id=$1)",[outgoing.id]);await a.query('commit');
 assert.match((await waitingSave)?.message??'',/Original seller recipient changed/);
 assert.equal((await main.query('select state from public.icash_live_conversations where id=$1',[outgoing.id])).rows[0].state,'waiting','binding drift never saves an original result');
 assert.equal((await main.query('select count(*)::int n from icash_seller_call_source_private.sources where source_id=$1',[outgoing.id])).rows[0].n,0);
 await main.query('update public.icash_call_recordings set conversation_id=$1 where operation_key=(select operation_key from public.icash_live_conversations where id=$2)',[outgoing.raw.conversation_id,outgoing.id]);
 await b.query('select public.icash_save_live_result_with_source($1,$2::jsonb,$3::jsonb)',[outgoing.id,JSON.stringify(outgoingResult),JSON.stringify(sellerCallSource(outgoing.raw))]);
 assert.equal((await main.query('select state from public.icash_live_conversations where id=$1',[outgoing.id])).rows[0].state,'complete');
 await a.query('begin');assert.equal((await call(a,incoming.id,incoming.raw)).rows[0].value,true);
 const later=b.query('select pg_advisory_xact_lock(hashtextextended($1,74))',[f.phone]);await blocked(bpid);
 // A different actual recipient can persist its own original while A waits.
 const other=await f.inbound([{role:'user',message:'I need the roof checked.',time_in_call_secs:1}]);
 await main.query("update icash_recorded_reception_private.sessions set from_phone='+12125550125',contact_key=encode(sha256(convert_to('+12125550125','UTF8')),'hex') where id=$1",[other.id]);
 // Separate exact thread for that recipient; original inbound binding changes
 // only in this fictional concurrency fixture, never in production.
 const otherThread=(await main.query("insert into public.icash_text_threads(id,account_id,deal_id,recipient,party) values(gen_random_uuid(),$1,$2,'+12125550125','seller') returning id",[f.account,f.deal])).rows[0].id;
 await main.query('update icash_seller_agreement_private.inbound_bindings set thread_id=$1 where session_id=$2',[otherThread,other.id]);
 assert.equal((await call(main,other.id,other.raw)).rows[0].value,true);
 await a.query('commit');await later;
 const first=(await main.query("select evidence_hash from icash_seller_call_source_private.sources where kind='inbound' and source_id=$1",[incoming.id])).rows[0].evidence_hash;
 const changed=structuredClone(incoming.raw);changed.transcript=[{role:'user',message:'Yes.',time_in_call_secs:1}];
 assert.equal((await call(main,incoming.id,changed)).rows[0].value,true);
 assert.equal((await main.query("select evidence_hash from icash_seller_call_source_private.sources where kind='inbound' and source_id=$1",[incoming.id])).rows[0].evidence_hash,first);
 assert.equal((await f.context()).conversations.find(c=>c.sourceId==='reception:'+incoming.id).sourceCoverage,'conflict');
 await main.query('set role service_role');assert.equal((await call(main,other.id,other.raw)).rows[0].value,true);await main.query('reset role');
 assert.equal((await main.query("select has_function_privilege('anon','public.icash_capture_seller_call_source(text,uuid,jsonb)','execute') allowed")).rows[0].allowed,false);
 console.log('PASS native original seller sources: migration ledger rollback/source+ACL drift, recipient fence in both orders, fresh binding after wait, unrelated recipient progress, immutable conflict evidence and service-role execution.');
}finally{await Promise.allSettled(clients.map(c=>c.end()));await admin.query('drop database if exists '+database+' with (force)');await admin.end();}
