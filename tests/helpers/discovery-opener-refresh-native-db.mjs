// Disposable native PostgreSQL fixture only. Never accepts production connection settings.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {isAbsolute} from 'node:path';
assert(['local','ci'].includes(process.env.DISCOVERY_REFRESH_NATIVE_TEST),'Explicit isolated native fixture local/ci opt-in required');
const modulePath=process.env.DISCOVERY_REFRESH_PG_MODULE??process.env.ICASH_PG_MODULE;
assert(modulePath&&isAbsolute(modulePath),'Supply an absolute path to the isolated pinned pg driver');
const {Client,types}=createRequire(import.meta.url)(modulePath);
types.setTypeParser(20,value=>{const n=BigInt(value);return n>=BigInt(Number.MIN_SAFE_INTEGER)&&n<=BigInt(Number.MAX_SAFE_INTEGER)?Number(n):n;});
types.setTypeParser(1184,value=>new Date(value).toISOString());
export const connection={host:'127.0.0.1',port:process.env.DISCOVERY_REFRESH_NATIVE_TEST==='ci'?55443:55446,user:'postgres',database:'icash_discovery_refresh_test',password:process.env.DISCOVERY_REFRESH_NATIVE_TEST==='ci'?'isolated-fixture-only':undefined,ssl:false,connectionTimeoutMillis:5000};
export const PGlite={async create(){
 const client=new Client({...connection,application_name:'discovery-refresh-fixture'});await client.connect();
 try{
  assert.equal((await client.query('select current_database() name')).rows[0].name,'icash_discovery_refresh_test');
  assert.equal((await client.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'")).rows[0].n,0,'Dedicated fixture database must be empty');
  await client.query("set timezone='UTC';set statement_timeout='30s';set lock_timeout='10s'");
  return {exec:async sql=>{if(sql.startsWith('create role anon;'))for(const role of ['anon','authenticated','service_role'])sql=sql.replace(new RegExp('create role '+role+'(?: bypassrls)?;'),`do $fixture$ begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role}${role==='service_role'?' bypassrls':''};end if;end $fixture$;`);const result=await client.query(sql);if(sql.includes('create schema extensions;'))await client.query('grant usage on schema extensions to service_role');return result;},query:(sql,args)=>client.query(sql,args),close:()=>client.end()};
 }catch(error){await client.end();throw error;}
}};
export {Client};
