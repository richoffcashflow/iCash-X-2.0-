import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {canSaveSharedIntegrationCheck} from '../scripts/integration-check-write-policy.mjs';
const cases=[
 [{},true],
 [{VERCEL:'1',VERCEL_ENV:'production'},true],
 [{VERCEL:'1',VERCEL_ENV:'production',VERCEL_TARGET_ENV:'production'},true],
 [{VERCEL:'1',VERCEL_ENV:'preview'},false],
 [{VERCEL_ENV:'preview'},false],
 [{VERCEL:'1',VERCEL_ENV:'development'},false],
 [{VERCEL:'1'},false],
 [{VERCEL:'1',VERCEL_ENV:'production',VERCEL_TARGET_ENV:'staging'},false],
 [{VERCEL_TARGET_ENV:'preview'},false],
];
for(const [env,expected] of cases)assert.equal(canSaveSharedIntegrationCheck(env),expected,JSON.stringify(env));
// Execute every real writer with synthetic credentials and intercepted fetch.
// Provider credentials are intentionally absent, reproducing preview missing-config rows.
for(const name of ['telephony-connection','text-connection','buyer-search','signing-connection','text-ai-config']){
 for(const [flags,allowed] of cases){
  const script=new URL(`../scripts/check-${name}.mjs`,import.meta.url).href;
  const program=`const writes=[];globalThis.fetch=async(url,init)=>{if(!String(url).includes('/rest/v1/icash_integration_checks?'))throw Error('Unexpected external request');writes.push(JSON.parse(init.body));return new Response('',{status:200});};const module=await import(${JSON.stringify(script)});${name==='telephony-connection'?"await module.saveTelephonyCheck({checkedAt:'2026-10-07T19:00:00.000Z',status:'missing_configuration'});":''}console.log(JSON.stringify({writes}));`;
  const run=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',program],{encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH,SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'synthetic-only-key',...flags}});
  assert.equal(run.status,0,`${name}: ${run.stderr}`);
  const result=JSON.parse(run.stdout.trim().split('\n').at(-1));
  assert.equal(result.writes.length,allowed?(name==='signing-connection'?2:1):0,`${name} ${JSON.stringify(flags)}`);
 }
}
console.log('Integration evidence: all five writers skip preview/development/unknown Vercel targets; production and explicit local checks retain writes. No real network.');
