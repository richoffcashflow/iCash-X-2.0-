import assert from 'node:assert/strict';
import {createHeartbeat} from '../worker/heartbeat.mjs';
import {createScheduler} from '../worker/scheduler.mjs';
import {createRpc} from '../worker/runner.mjs';
let time=0,calls=0,status='screening',fail=false;
const beat=createHeartbeat({now:()=>time,health:()=>({body:{status}}),rpc:async(name,args)=>{calls++;assert.equal(name,'icash_record_service_heartbeat');assert.equal(args.p_status,status==='screening'?'ok':status);if(fail)throw Error('Database down');}});
await Promise.all([beat(),beat()]);assert.equal(calls,1);time=59999;await beat();assert.equal(calls,1);
time=60000;fail=true;await beat();assert.equal(calls,2);time=120000;fail=false;status='degraded';await beat();assert.equal(calls,3);
const scheduler=createScheduler({now:()=>time,screening:async()=>false,automation:async()=>false});
await scheduler.run();assert.equal(scheduler.health().code,200);time+=180001;assert.equal(scheduler.health().code,503);assert.equal(scheduler.health().body.automation,'held');
await scheduler.run();assert.equal(scheduler.health().code,200);
// Exercise the actual worker RPC client, including its operation allowlist.
const requests=[];let heartbeatFailures=0;
const client=createRpc('https://fixture.supabase.co','fixture-key',async(url,options)=>{
 requests.push({path:url.pathname,method:options.method,body:JSON.parse(options.body)});
 assert(options.signal instanceof AbortSignal);return new Response('',{status:200});
});
await createHeartbeat({rpc:client,health:()=>scheduler.health(),onFailure:()=>{heartbeatFailures++;}})();
assert.equal(heartbeatFailures,0);
assert.deepEqual(requests,[{path:'/rest/v1/rpc/icash_record_service_heartbeat',method:'POST',body:{p_component:'worker',p_status:'ok'}}]);
await assert.rejects(client('unsupported_operation',{}),/Unsupported worker operation/);assert.equal(requests.length,1);
console.log('PASS worker heartbeat real RPC integration, throttling, overlap, database outage isolation and stalled-loop health recovery.');
