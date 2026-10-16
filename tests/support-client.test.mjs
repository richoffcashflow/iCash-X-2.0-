import assert from 'node:assert/strict';
import {supportReplyWaitMs,supportRequest} from '../lib/support-client.ts';
import {createSupportPreview} from '../app/preview/support/preview-transport.ts';

assert.equal(supportReplyWaitMs('Hi',0),1816);
assert.equal(supportReplyWaitMs('x'.repeat(2000),0),3600);
assert.equal(supportReplyWaitMs('Hi',9000),0,'A slow network response gets no extra delay');
assert.equal(supportReplyWaitMs('x'.repeat(2000),1000),2600);
let calls=0,signal;
const stalled=async(_path,init)=>{calls++;signal=init.signal;return new Promise(()=>{});};
await assert.rejects(supportRequest('/api/support',{method:'POST'},stalled,15),/may have been saved/);
assert.equal(calls,1,'An uncertain write is never automatically repeated');assert.equal(signal.aborted,true);
await assert.rejects(supportRequest('/api/support',{},async()=>({ok:true,status:200,json:()=>new Promise(()=>{})}),15),/took too long/,'Body reads have the same deadline');
await assert.rejects(supportRequest('/api/support',{},async()=>new Response('<html>error</html>')),/Could not read/);
assert.deepEqual(await supportRequest('/api/support',{},async()=>Response.json({error:'Sign in'},{status:401})),{ok:false,status:401,data:{error:'Sign in'}});

const preview=createSupportPreview('recovery'),message={requestId:'test-request',message:'Why is my bot paused?'};
const post=body=>preview('/api/support',{method:'POST',body:JSON.stringify(body)});
await assert.rejects(post(message),/interrupted/);
await post(message);
let history=await (await preview('/api/support')).json();
assert.equal(history.messages.length,2,'Retry recovers the saved reply without duplicate messages');
await post({action:'escalate'});await post({action:'escalate'});
history=await (await preview('/api/support')).json();assert.equal(history.messages.length,3);assert.equal(history.threads[0].status,'escalated');
assert.equal((await preview('/api/support/cancel',{method:'POST'})).status,400);
assert.equal((await preview('/api/billing')).status,400);
assert.deepEqual((await (await createSupportPreview('bot')('/api/support')).json()).messages,[],'Preview state is isolated per instance');
console.log('Support client: bounded fetch and body reads, no repeated writes, paced replies, isolated preview and replay recovery passed.');
