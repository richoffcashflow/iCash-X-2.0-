// Test-only facade so the existing isolated schema fixture can run against native PostgreSQL.
// No non-local connection options are accepted.
import {createRequire} from 'node:module';
if(process.env.OPERATIONAL_NATIVE_TEST!=='1')throw Error('Explicit isolated native-test opt-in required');
const require=createRequire(import.meta.url),{Client,types}=require('/tmp/icash-pg-review/root/usr/share/nodejs/pg');
types.setTypeParser(20,value=>{const n=BigInt(value);return n>=BigInt(Number.MIN_SAFE_INTEGER)&&n<=BigInt(Number.MAX_SAFE_INTEGER)?Number(n):n;});
types.setTypeParser(1184,value=>new Date(value).toISOString());
export const connection={host:'127.0.0.1',port:55442,user:'agent',database:'postgres'};
export const PGlite={async create(){const client=new Client(connection);await client.connect();return {exec:async sql=>{const result=await client.query(sql);if(sql.includes('create schema extensions;'))await client.query('grant usage on schema extensions to service_role');return result;},query:(sql,args)=>client.query(sql,args),close:()=>client.end()};}};
export {Client};
