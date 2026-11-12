import assert from 'node:assert/strict';
import {createExternalMonitor,monitorDatabase,MONITOR_PROVIDER} from '../monitor/runtime.mjs';
import {externalReliabilityRuntime} from '../lib/reliability-monitor-runtime.ts';
import {dispatchReliabilityAlerts} from '../lib/reliability-alerts-service.ts';
import {externalMonitorFresh} from '../lib/external-monitor-health.ts';
import {ownerInboundTarget} from '../lib/owner-inbound-acceptance.ts';

const env={ICASH_EXTERNAL_MONITOR_ENABLED:'true',RAILWAY_PROJECT_ID:'87d752fb-5988-452f-bf6c-1b92c3d3ff96',RAILWAY_ENVIRONMENT_ID:'e87ae75d-a7e3-4749-9940-75a0e6619809',RAILWAY_ENVIRONMENT_NAME:'production',RAILWAY_SERVICE_NAME:'reliability-monitor',RAILWAY_GIT_BRANCH:'main',RAILWAY_GIT_REPO_OWNER:'richoffcashflow',RAILWAY_GIT_REPO_NAME:'iCash-X-2.0-',RAILWAY_GIT_COMMIT_SHA:'a'.repeat(40),SUPABASE_URL:'https://ofjbbpwugyjfxbhqfguh.supabase.co',SUPABASE_SECRET_KEY:'PRIVATE_DB_KEY',ICASH_RELIABILITY_EMAIL_ENABLED:'true',ICASH_RELIABILITY_FROM_EMAIL:'noreply@geticashx.com',RESEND_API_KEY:'PRIVATE_EMAIL_KEY'};
assert(externalReliabilityRuntime(env));
for(const [key,value] of Object.entries({ICASH_EXTERNAL_MONITOR_ENABLED:'false',VERCEL_ENV:'preview',RAILWAY_PROJECT_ID:'other',RAILWAY_ENVIRONMENT_ID:'other',RAILWAY_ENVIRONMENT_NAME:'preview',RAILWAY_SERVICE_NAME:'worker',RAILWAY_GIT_BRANCH:'feature',RAILWAY_GIT_REPO_OWNER:'other',RAILWAY_GIT_REPO_NAME:'other',RAILWAY_GIT_COMMIT_SHA:'missing',SUPABASE_URL:'https://other.supabase.co'})){
 assert(!externalReliabilityRuntime({...env,[key]:value}),key);
 assert.throws(()=>createExternalMonitor({env:{...env,[key]:value}}));
 assert.equal(await dispatchReliabilityAlerts({env:{...env,[key]:value},db:()=>assert.fail('Unapproved runtime must not touch incidents')}),'skipped');
}
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let clock=Date.parse('2026-11-12T12:05:00Z'),calls=[],saved=[],logs=[],failure='none',sent=[],ownerBanned=false,ownerMissing=false;
const at=()=>new Date(clock).toISOString();
const transport=async(url,options)=>{
 calls.push({url:String(url),method:options.method??'GET'});
 assert.equal(options.redirect,'error');assert(options.signal);
 const u=new URL(url);
 if(u.pathname==='/api/health'){
  assert.equal(u.origin,'https://www.geticashx.com');assert(!options.headers.Authorization);
  if(failure==='web'||failure==='both')throw Error('PRIVATE_ERROR');
  return Response.json({status:'degraded',checkedAt:at(),checks:{database:'ok',authentication:'ok',workflows:'degraded'}},{status:503});
 }
 if(u.pathname.startsWith('/auth/v1/admin/users/')){
  assert.equal(u.pathname,'/auth/v1/admin/users/'+ownerInboundTarget.ownerUserId);
  if(failure==='both')throw Error('PRIVATE_AUTH_ERROR');
  if(ownerMissing)return new Response(null,{status:404});
  return Response.json({id:ownerInboundTarget.ownerUserId,email:'private-owner@example.invalid',email_confirmed_at:new Date(clock-1000).toISOString(),banned_until:ownerBanned?new Date(clock+3600000).toISOString():null});
 }
 if(u.pathname==='/rest/v1/icash_integration_checks'){
  const row=JSON.parse(options.body);assert.equal(row.provider,MONITOR_PROVIDER);saved.push(row);return new Response(null,{status:201});
 }
 if(u.pathname==='/emails'){
  assert.equal(u.origin,'https://api.resend.com');sent.push({key:options.headers['Idempotency-Key'],payload:JSON.parse(options.body)});
  if(failure==='web')throw Error('PRIVATE_AMBIGUOUS_SEND');
  return Response.json({id:id(8)});
 }
 assert.equal(u.origin,env.SUPABASE_URL);
 assert(u.pathname.startsWith('/rest/v1/rpc/'));
 if(failure==='database'||failure==='both')throw Error('PRIVATE_DB_ERROR');
 if(u.pathname.endsWith('icash_refresh_reliability_incident'))return Response.json(false);
 assert.fail('Unexpected RPC '+u.pathname);
};
const monitor=createExternalMonitor({env,transport,now:()=>clock,log:value=>logs.push(value)});
assert.equal(await monitor.tick(),true);assert.equal(await monitor.tick(),false,'No overlapping/tight polls');
assert.equal(saved[0].result.application,'workflows_degraded');assert.equal(saved[0].result.alerts,'idle');assert.equal(sent.length,0,'Historical workflow holds do not create fallback spam');
assert.equal(calls.filter(c=>c.url.endsWith('/api/health')).length,1);
assert.equal(calls.filter(c=>c.url.includes('/icash_refresh_reliability_incident')).length,1,'Real existing dispatcher observes incidents directly without web cron');
failure='both';
for(let i=0;i<3;i++){clock+=60000;await monitor.tick();}
assert.equal(sent.length,1,'Cached verified owner receives a bounded alert when web and incident DB reads fail');
assert.deepEqual(sent[0].payload.to,['private-owner@example.invalid']);assert.match(sent[0].key,/^icash-external-monitor-\d+$/);
clock+=60000;await monitor.tick();assert.equal(sent.length,1,'No resend within the same hour');
assert.equal(saved.at(-1).result.alerts,'unavailable');assert.equal(saved.at(-1).result.application,'unavailable');
assert(!JSON.stringify(logs).includes('PRIVATE'));assert(!JSON.stringify(logs).includes('private-owner'));
for(const c of calls)assert(!/automation|screening|voice|text|repair|recover|refresh_account/.test(new URL(c.url).pathname),'Observer never dispatches customer work');
clock+=7*3600000;await monitor.tick();assert.equal(sent.length,1,'Expired owner evidence never authorizes fallback email');
failure='none';clock+=60000;await monitor.tick();
ownerBanned=true;clock+=300000;await monitor.tick();failure='web';
for(let i=0;i<3;i++){clock+=60000;await monitor.tick();}
assert.equal(sent.length,1,'Explicit revoked identity clears cached recipient');
ownerBanned=false;failure='none';clock+=300000;await monitor.tick();
ownerMissing=true;clock+=300000;await monitor.tick();failure='web';
for(let i=0;i<3;i++){clock+=60000;await monitor.tick();}
assert.equal(sent.length,1,'An explicitly missing owner cannot remain authorized through the temporary-outage cache');

let release;const wait=new Promise(resolve=>release=resolve);let probes=0;
const concurrent=createExternalMonitor({env,now:()=>clock,transport:async(...args)=>{probes++;return transport(...args);},dispatch:async()=>{await wait;return 'idle';}});
const first=concurrent.tick();await Promise.resolve();assert.equal(await concurrent.tick(),false);release();await first;assert.equal(probes,3);
const restricted=monitorDatabase(env,()=>assert.fail('No transport for unsupported operation'));
for(const path of ['rpc/icash_next_automation','rpc/icash_repair_expired_research_configs','icash_voice_jobs','rpc/icash_claim_screening'])await assert.rejects(restricted(path));
const healthy={checked_at:at(),result:{observedAt:at(),releaseSha:'a'.repeat(40),intervalMs:60000,status:'degraded'}};
assert.equal(await externalMonitorFresh(async()=>[],clock),true,'Before companion installation, no missing-service alarm');
assert.equal(await externalMonitorFresh(async()=>[healthy],clock),true,'Observed degradation is distinct from observer freshness');
for(const rows of [null,[{...healthy,checked_at:new Date(clock-180000).toISOString()}],[{...healthy,result:{...healthy.result,releaseSha:'bad'}}],[{...healthy,checked_at:new Date(clock+6000).toISOString(),result:{...healthy.result,observedAt:new Date(clock+6000).toISOString()}}]])assert.equal(await externalMonitorFresh(async()=>rows,clock),false);
console.log('PASS independent observer, production boundaries, real incident dispatch, bounded fallback, owner verification, redaction, no customer operations and reciprocal freshness.');
