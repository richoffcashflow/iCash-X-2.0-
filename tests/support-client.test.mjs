import assert from 'node:assert/strict';
import {supportRequest} from '../lib/support-client.ts';

let calls=0,signal;
const stalled=async(_path,init)=>{calls++;signal=init.signal;return new Promise(()=>{});};
await assert.rejects(supportRequest('/api/support',{method:'POST'},stalled,15),/may have been saved/);
assert.equal(calls,1,'An uncertain write is never automatically repeated');assert.equal(signal.aborted,true);
await assert.rejects(supportRequest('/api/support',{},async()=>({ok:true,status:200,json:()=>new Promise(()=>{})}),15),/took too long/,'Body reads have the same deadline');
await assert.rejects(supportRequest('/api/support',{},async()=>new Response('<html>error</html>')),/Could not read/);
assert.deepEqual(await supportRequest('/api/support',{},async()=>Response.json({error:'Sign in'},{status:401})),{ok:false,status:401,data:{error:'Sign in'}});
console.log('Support requests: bounded fetch and body reads, no repeated writes, unreadable-response recovery, and preserved authentication status.');
