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
 // Optional body disposal cannot retain the shared pending probe after its
 // HTTP result is already known. These are real unfinished streams, not
 // database/auth/provider requests. Eventual failures must stay handled too.
 for(const [target,status] of [['auth',200],['auth',503],['database',503],['workflows',503]])for(const mode of ['pending','rejected','synchronous']){
  let cancelled=0,rejectCancel,calls=0;
  const cleanup=new Promise((_,reject)=>{rejectCancel=reject;});
  const response=new Response(new ReadableStream({
   start(controller){controller.enqueue(new TextEncoder().encode('private ignored health payload'));},
   cancel(){cancelled++;if(mode==='rejected')throw Error('private cleanup failure');return cleanup;},
  }),{status});
  if(mode==='synchronous')Object.defineProperty(response.body,'cancel',{value(){cancelled++;throw Error('private synchronous cleanup failure');}});
  globalThis.fetch=async url=>{
   calls++;
   const kind=url.includes('/auth/')?'auth':url.includes('/rpc/')?'workflows':'database';
   return kind===target?response:Response.json(kind==='workflows'?workflow:kind==='database'?[{id:1}]:{});
  };
  const module=await fresh();let timer;
  try{
   const [first,second]=await Promise.race([
    Promise.all([module.serviceHealth(),module.serviceHealth()]),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Known health result blocked by response cleanup')),250);}),
   ]);
   const expected={database:'ok',authentication:'ok',workflows:'ok'};
   if(status!==200)expected[target==='auth'?'authentication':target]='unavailable';
   assert.deepEqual(first.checks,expected);assert.equal(first.status,status===200?'ok':'degraded');
   assert.deepEqual(second,first,'Concurrent callers share the completed result');
   assert.equal(cancelled,1,'Discard starts once without retrying the probe');
   assert.equal(calls,3);assert(!JSON.stringify(first).includes('private'));
   assert.deepEqual(await module.serviceHealth(),first);assert.equal(calls,3,'Completion still populates the original short cache');
  }finally{
   clearTimeout(timer);
   if(mode==='pending'){rejectCancel(Error('private delayed cleanup failure'));await new Promise(resolve=>setImmediate(resolve));}
  }
 }
 delete process.env.SUPABASE_SECRET_KEY;globalThis.fetch=()=>{throw Error('Must not call provider without configuration');};assert.equal((await (await fresh()).serviceHealth()).status,'degraded');
 console.log('PASS service health: parallel bounded probes, shared cache, database/auth failures, missing configuration and no secret exposure.');
}finally{globalThis.fetch=originalFetch;if(originalUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=originalUrl;if(originalKey===undefined)delete process.env.SUPABASE_SECRET_KEY;else process.env.SUPABASE_SECRET_KEY=originalKey;}
