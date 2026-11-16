import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {setup,migration,api,oldHash,fixture} from './helpers/seller-memory-receipt-fixture.mjs';
import {cases,oldConsumer} from './helpers/seller-memory-receipt-cases.mjs';
assert.equal(process.env.SELLER_MEMORY_NATIVE_TEST,'1','Explicit local disposable test opt-in required');
const port=Number(process.env.SELLER_MEMORY_NATIVE_PORT||55443);assert(Number.isInteger(port)&&port>1024&&port<=65535&&port!==5432);
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const connection={host:'127.0.0.1',port,user:'postgres',password:'isolated-fixture-only',connectionTimeoutMillis:5000};
const database='seller_memory_receipts_'+randomBytes(8).toString('hex');
const connect=async db=>{const c=new Client({...connection,database:db});await c.connect();await c.query("set statement_timeout='15s';set lock_timeout='5s'");return c;};
const admin=await connect('postgres'),clients=[];
const adapter=c=>({exec:sql=>c.query(sql),query:(sql,args)=>c.query(sql,args)});
globalThis.fetch=async()=>{throw Error('NO NETWORK: fictional fixtures only');};
try{
 await admin.query('create database '+database);const main=await connect(database);clients.push(main);const pg=adapter(main);await setup(pg);
 const {hash}=api(pg),beforeMeta=(await main.query("select to_jsonb(p)-'prosrc' metadata from pg_proc p where oid='icash_seller_memory_context(uuid,uuid,text)'::regprocedure")).rows[0].metadata;
 const f=await fixture(pg);await f.turn('outgoing','Are you the owner?',0,{delivery:10});await f.turn('incoming','Yes.',20,{eventTime:1});assert.equal((await oldConsumer(f.db,f.binding)).state.facts.ownership.value,true);
 const a=await connect(database),b=await connect(database);clients.push(a,b);await main.query('create table fixture_migration_ledger(version text primary key)');
 await a.query('begin');await a.query(migration);await a.query("insert into fixture_migration_ledger values('20261116225713')");await assert.rejects(a.query("insert into fixture_migration_ledger values('20261116225713')"),/duplicate key/);await a.query('rollback');assert.equal(await hash(),oldHash);assert.equal((await main.query('select count(*)::int n from fixture_migration_ledger')).rows[0].n,0);
 // Metadata drift and predecessor replay cannot silently broaden the patch.
 await a.query('begin');await a.query('grant execute on function icash_seller_memory_context(uuid,uuid,text) to authenticated');await assert.rejects(a.query(migration),/prerequisite changed/);await a.query('rollback');assert.equal(await hash(),oldHash);
 await a.query('begin');await a.query(migration);await a.query("insert into fixture_migration_ledger values('20261116225713')");await b.query('begin');const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
 const second=assert.rejects(b.query(migration),/prerequisite changed/);let waiting=false;
 for(let n=0;n<150;n++){waiting=(await main.query("select exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted) waiting",[pid])).rows[0].waiting;if(waiting)break;await new Promise(r=>setTimeout(r,10));}
 assert(waiting,'second source patch must wait on shared advisory lock');assert.equal(await hash(),oldHash);await a.query('commit');await second;await b.query('rollback');
 assert.equal(await hash(),'7a680dae86359988c3f70c705a3369b0');assert.equal((await main.query('select count(*)::int n from fixture_migration_ledger')).rows[0].n,1);
 assert.deepEqual((await main.query("select to_jsonb(p)-'prosrc' metadata from pg_proc p where oid='icash_seller_memory_context(uuid,uuid,text)'::regprocedure")).rows[0].metadata,beforeMeta);
 assert.equal((await oldConsumer(f.db,f.binding)).complete,false,'actual old application rejects uncertain delivery after migration');
 await cases(pg);
 console.log('PASS native shared-memory receipts: actual old/new consumers, chronology/cap fixtures, exact source/ACL metadata, ledger rollback and serialized migrations.');
}finally{await Promise.allSettled(clients.map(c=>c.end()));await admin.query('drop database if exists '+database+' with (force)');await admin.end();}
