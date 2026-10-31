import assert from 'node:assert/strict';
import {supportRequest} from '../lib/support-client.ts';

let calls=0,signal;
const stalled=async(_path,init)=>{calls++;signal=init.signal;return new Promise(()=>{});};
await assert.rejects(supportRequest('/api/support',{method:'POST'},stalled,15),/may have been saved/);
assert.equal(calls,1,'An uncertain write is never automatically repeated');assert.equal(signal.aborted,true);
await assert.rejects(supportRequest('/api/support',{},async()=>({ok:true,status:200,json:()=>new Promise(()=>{})}),15),/took too long/,'Body reads have the same deadline');
await assert.rejects(supportRequest('/api/support',{},async()=>new Response('<html>error</html>')),/Could not read/);
for(const status of [401,403]){
 for(const transport of [async()=>Response.json({error:'Denied'},{status}),async()=>new Response('<html>Denied</html>',{status}),async()=>({ok:false,status,json:()=>new Promise(()=>{})})]){
  const result=await supportRequest('/api/support',{},transport,15);assert.equal(result.status,status);assert.equal(result.ok,false);assert.equal(typeof result.data.error,'string');
 }
}
console.log('Support requests: bounded fetch and body reads, no repeated writes, unreadable-response recovery, and preserved authentication status.');
