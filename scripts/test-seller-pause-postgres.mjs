// Native loopback-only fixture; no provider calls or hosted database access.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
import {sellerResponseDisposition,sellerCallDisposition} from '../lib/seller-response-policy.ts';
import {sellerPauseCases} from '../tests/helpers/seller-pause-cases.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const connection={host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',ssl:false,connectionTimeoutMillis:5000};
const fixtureDatabase='icash_pause_'+randomUUID().replaceAll('-','');
const admin=new Client({...connection,database:'icash_reliability'});
const client=new Client({...connection,database:fixtureDatabase});
let created=false;
const read=name=>readFileSync(new URL('../config/'+name+'.sql',import.meta.url),'utf8');
const signature="'public.icash_seller_response_disposition(text)'::regprocedure";
const metadata=async()=>(await client.query(`select p.oid,md5(pg_get_functiondef(p.oid)) hash,p.proowner,p.prosecdef,p.provolatile,p.proconfig,p.proacl::text from pg_proc p where p.oid=${signature}`)).rows[0];
const scalar=async(sql,values=[])=>(await client.query(sql,values)).rows[0];
try{
 await admin.connect();await assertDisposablePostgresTarget(admin);
 await admin.query('create database '+fixtureDatabase);created=true;
 await client.connect();
 const server=await scalar("select current_database() database,current_user username,current_setting('server_version_num')::int version");
 assert.equal(server.database,fixtureDatabase);assert.equal(server.username,'postgres');assert(server.version>=170000&&server.version<180000);
 assert.deepEqual({host:client.connection.stream.remoteAddress,port:client.connection.stream.remotePort},{host:'127.0.0.1',port:55443});
 await client.query("do $$begin if not exists(select from pg_roles where rolname='anon') then create role anon;end if;if not exists(select from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select from pg_roles where rolname='service_role') then create role service_role;end if;end$$;");
 for(const name of ['seller-response-policy','seller-optout-base-verbs','seller-natural-refusals'])await client.query(read(name));
 await client.query(read('seller-source-dispositions').split('-- A bare no')[0]+'commit;');
 for(const name of ['seller-call-answer-context','seller-call-automated-greetings','seller-specific-price-answers','seller-unmarked-price-answers'])await client.query('begin;'+read(name)+'commit;');
 await client.query(read('seller-soft-withdrawal'));
 await client.query(readFileSync(new URL('../tests/fixtures/seller-pause-hard-stop-predecessor.sql',import.meta.url),'utf8'));
 await client.query('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text);');
 const before=await metadata(),migration=read('seller-pause-response');
 assert.equal(before.hash,'8e47d476f60a9e74fa6f2a6c460efdb8');
 assert.deepEqual(await scalar("select icash_seller_response_disposition('Pause') disposition,icash_seller_contact_stop('Pause') stopped"),{disposition:null,stopped:false});
 // A changed permission blocks the patch without losing the original function.
 await client.query('begin;grant execute on function public.icash_seller_response_disposition(text) to anon');
 await assert.rejects(client.query(migration),/Seller pause source or authority changed/);await client.query('rollback');
 assert.deepEqual(await metadata(),before);
 // Source and migration receipt share the transaction; rollback never half-installs.
 await client.query('begin');await client.query(migration);
 await client.query("insert into supabase_migrations.schema_migrations values('fixture',array[$1],'seller_pause_response')",[migration]);
 await assert.rejects(client.query("select 1/0"));await client.query('rollback');
 assert.deepEqual(await metadata(),before);
 assert.equal((await scalar('select count(*)::int n from supabase_migrations.schema_migrations')).n,0);
 await client.query('begin');await client.query(migration);
 await client.query("insert into supabase_migrations.schema_migrations values('fixture',array[$1],'seller_pause_response')",[migration]);
 await client.query('commit');
 assert.equal((await scalar("select icash_seller_response_disposition('Go to hell') d")).d,'opt_out','installed hard-stop remains authoritative');
 const after=await metadata();assert.notEqual(after.hash,before.hash);
 assert.deepEqual({...after,hash:before.hash},before,'function identity and privileges stay unchanged');
 for(const [body,expected] of [...sellerPauseCases,['STOP','opt_out'],['Not interested','declined'],['Stop. Pause','opt_out']]){
  const transcript=[{role:'agent',message:'Let me know if you would like to continue or pause here.'},{role:'user',message:body}];
  const actual=await scalar('select icash_seller_response_disposition($1) disposition,icash_seller_contact_stop($1) stopped,icash_seller_call_disposition($2) call_disposition',[body,{transcript}]);
  assert.equal(actual.disposition,expected,body);assert.equal(actual.stopped,expected==='opt_out',body);assert.equal(actual.call_disposition,expected,body);
  assert.equal(sellerResponseDisposition(body),expected,body);assert.equal(sellerCallDisposition(transcript),expected,body);
 }
 await client.query('set role service_role');assert.equal((await scalar("select public.icash_seller_response_disposition('Pause') disposition")).disposition,'review');await client.query('reset role');
 for(const role of ['anon','authenticated']){
  await client.query('set role '+role);await assert.rejects(client.query("select public.icash_seller_response_disposition('Pause')"),/permission denied/);await client.query('reset role');
 }
 await client.query('begin');await assert.rejects(client.query(migration),/Seller pause source or authority changed/);await client.query('rollback');assert.deepEqual(await metadata(),after);
 assert.equal((await scalar('select count(*)::int n from supabase_migrations.schema_migrations')).n,1);
 console.log(JSON.stringify({status:'passed',nativeVersion:server.version,before:before.hash,after:after.hash,cases:sellerPauseCases.length+3,checks:['source-bound patch','same function identity and ACL','rollback with receipt','one-time install','native SQL/TS parity','service-only access']}));
}finally{await client.end();if(created)await admin.query('drop database '+fixtureDatabase);await admin.end();}
