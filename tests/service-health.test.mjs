import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {reliabilitySchema} from '../lib/reliability.ts';
globalThis.__healthSchema=reliabilitySchema;
const code='const reliabilitySchema=globalThis.__healthSchema;\n'+ts.transpileModule(readFileSync(new URL('../lib/service-health.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const component={status:'ok',checkedAt:new Date().toISOString()};
const workflow={status:'ok',fresh:true,components:{worker:component,maintenance:component},snapshot:null};
let version=0;
const fresh=()=>import('data:text/javascript;base64,'+Buffer.from(code+`\n// case ${version++}`).toString('base64'));
const originalFetch=globalThis.fetch,originalUrl=process.env.SUPABASE_URL,originalKey=process.env.SUPABASE_SECRET_KEY;
try{
 process.env.SUPABASE_URL='https://fixture.invalid';process.env.SUPABASE_SECRET_KEY='server-only-fixture';
 let calls=0,release;const gate=new Promise(resolve=>{release=resolve});
 globalThis.fetch=async(url,options)=>{calls++;assert.equal(options.cache,'no-store');assert(options.signal instanceof AbortSignal);assert.equal(options.headers.apikey,'server-only-fixture');await gate;return Response.json(url.includes('/rpc/')?workflow:url.includes('/rest/')?[{id:1}]:{});};
 const healthy=await fresh();const a=healthy.serviceHealth(),b=healthy.serviceHealth();release();const [first,second]=await Promise.all([a,b]);
 assert.equal(first.status,'ok');assert.deepEqual(first,second);assert.equal(calls,3);await healthy.serviceHealth();assert.equal(calls,3,'Concurrent and repeated probes must share the short cache');assert(!JSON.stringify(first).includes('server-only'));assert(!JSON.stringify(first).includes('components'));
 globalThis.fetch=async url=>Response.json(url.includes('/rpc/')?{...workflow,fresh:false,status:'degraded'}:url.includes('/rest/')?[{id:1}]:{});
 assert.equal((await (await fresh()).serviceHealth()).checks.workflows,'degraded');
 globalThis.fetch=async url=>Response.json(url.includes('/rpc/')?{status:'ok'}:url.includes('/rest/')?[{id:1}]:{});
 assert.equal((await (await fresh()).serviceHealth()).checks.workflows,'unavailable','Malformed monitoring cannot pass');
 globalThis.fetch=async url=>new Response(url.includes('/rest/')?'[]':'{}',{status:200});
 let result=await (await fresh()).serviceHealth();assert.equal(result.status,'degraded');assert.equal(result.checks.database,'unavailable','Missing required database row is not healthy');
 globalThis.fetch=async url=>{if(url.includes('/auth/'))throw new DOMException('private connection details','TimeoutError');return new Response('[{"id":1}]');};
 result=await (await fresh()).serviceHealth();assert.equal(result.checks.database,'ok');assert.equal(result.checks.authentication,'unavailable');assert(!JSON.stringify(result).includes('private'));
 globalThis.fetch=async()=>new Response('secret upstream error',{status:503});assert.equal((await (await fresh()).serviceHealth()).status,'degraded');
 delete process.env.SUPABASE_SECRET_KEY;globalThis.fetch=()=>{throw Error('Must not call provider without configuration');};assert.equal((await (await fresh()).serviceHealth()).status,'degraded');
 console.log('PASS service health: parallel bounded probes, shared cache, database/auth failures, missing configuration and no secret exposure.');
}finally{globalThis.fetch=originalFetch;if(originalUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=originalUrl;if(originalKey===undefined)delete process.env.SUPABASE_SECRET_KEY;else process.env.SUPABASE_SECRET_KEY=originalKey;}
