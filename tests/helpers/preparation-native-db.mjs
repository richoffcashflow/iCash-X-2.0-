// Isolated disposable PostgreSQL only. Never read DATABASE_URL, PGHOST or secrets.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {isAbsolute} from 'node:path';
assert.equal(process.env.PREPARATION_NATIVE_TEST,'1','Explicit native fixture opt-in required');
const modulePath=process.env.PREPARATION_PG_MODULE;
assert(modulePath&&isAbsolute(modulePath),'Supply the absolute path to an isolated pinned pg installation');
const {Client,types}=createRequire(import.meta.url)(modulePath);
types.setTypeParser(20,value=>{const n=BigInt(value);return n>=BigInt(Number.MIN_SAFE_INTEGER)&&n<=BigInt(Number.MAX_SAFE_INTEGER)?Number(n):n;});
types.setTypeParser(1184,value=>new Date(value).toISOString());
// Intentionally fixed: no URL, host, database or credential environment override.
export const connection={host:'127.0.0.1',port:55444,user:'postgres',database:'icash_preparation_test',password:'isolated-preparation-only',ssl:false,connectionTimeoutMillis:5000};
export const PGlite={async create(){
 const client=new Client({...connection,application_name:'preparation-fixture'});await client.connect();
 assert.equal((await client.query('select current_database() name')).rows[0].name,'icash_preparation_test');
 assert.equal((await client.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'")).rows[0].n,0,'Dedicated fixture database must be empty');
 await client.query("set statement_timeout='30s';set lock_timeout='10s'");
 return {exec:async sql=>{const result=await client.query(sql);if(sql.includes('create schema extensions;'))await client.query('grant usage on schema extensions to service_role');return result;},query:(sql,args)=>client.query(sql,args),nativeSelect:async(sql,args)=>{
  // Named statements actually exercise both plan_cache_mode paths, including
  // all hostile cases run by the shared equivalence suite.
  const name='preparation_'+(await import('node:crypto')).createHash('sha256').update(sql).digest('hex').slice(0,40);
  const rows=[];
  for(const mode of ['force_generic_plan','force_custom_plan']){
   await client.query('set plan_cache_mode='+mode);
   rows.push(await client.query({name,text:sql,values:args}));
  }
  await client.query('set plan_cache_mode=auto');
  // EXPLAIN timings/plans intentionally differ; result rows are checked by caller.
  if(!/^explain\b/i.test(sql))assert.deepEqual(rows[0].rows,rows[1].rows,'Generic/custom prepared-statement results agree');
  return rows[1];
 },close:()=>client.end()};
}};
export {Client};
