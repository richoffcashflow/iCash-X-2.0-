import assert from 'node:assert/strict';
const saved={document:globalThis.document,fetch:globalThis.fetch};
const documentTarget=new EventTarget();documentTarget.hidden=false;globalThis.document=documentTarget;
let reads=0,emit,aborted=0;
globalThis.fetch=async(url,options)=>{
 assert.equal(url,'/api/work/events');assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');reads++;
 const stream=new ReadableStream({start(c){emit=revision=>c.enqueue(new TextEncoder().encode(`event: revision\ndata: ${JSON.stringify({revision})}\n\n`));options.signal.addEventListener('abort',()=>{aborted++;c.close();},{once:true});}});
 return new Response(stream,{headers:{'Content-Type':'text/event-stream'}});
};
const {subscribeWorkspaceChanges}=await import('../lib/workspace-events-client.ts');
let a=0,b=0;const flush=()=>new Promise(r=>setTimeout(r,5));
try{
 const failing=subscribeWorkspaceChanges(()=>{throw Error('One panel failed');});
 const first=subscribeWorkspaceChanges(()=>a++),second=subscribeWorkspaceChanges(()=>b++);await flush();assert.equal(reads,1,'Panels share a single authenticated stream');
 emit('1');await flush();assert.equal(a,1);assert.equal(b,1);emit('1');await flush();assert.equal(a,1,'Repeated revisions do not refresh');
 first();emit('2');await flush();assert.equal(a,1);assert.equal(b,2);
 documentTarget.hidden=true;documentTarget.dispatchEvent(new Event('visibilitychange'));await flush();assert.equal(aborted,1);
 documentTarget.hidden=false;documentTarget.dispatchEvent(new Event('visibilitychange'));await flush();assert.equal(reads,2);assert.equal(b,3,'Returning to the tab refreshes saved work');
 failing();second();await flush();assert.equal(aborted,2,'Last subscriber closes the stream');
}finally{Object.assign(globalThis,saved);}

// Model a reader settling after its old connection was aborted and replaced.
const timers={setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout},pendingTimers=new Map(),streams=[];
let nextTimer=0,changes=0;
const settle=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
try{
 globalThis.document=documentTarget;documentTarget.hidden=false;
 globalThis.setTimeout=(callback,ms)=>{const id=++nextTimer;pendingTimers.set(id,{callback,ms});return id;};
 globalThis.clearTimeout=id=>pendingTimers.delete(id);
 globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){streams.push(controller);}}),{headers:{'Content-Type':'text/event-stream'}});
 const unsubscribe=subscribeWorkspaceChanges(()=>changes++);await settle();
 documentTarget.hidden=true;documentTarget.dispatchEvent(new Event('visibilitychange'));
 documentTarget.hidden=false;documentTarget.dispatchEvent(new Event('visibilitychange'));await settle();
 assert.equal(streams.length,2);assert.equal(changes,1);
 streams[0].enqueue(new TextEncoder().encode('event: revision\ndata: {"revision":"99"}\n\n'));streams[0].close();await settle();
 assert.equal(changes,1,'A late old-stream frame cannot refresh or replace the current revision');
 assert.equal([...pendingTimers.values()].filter(t=>t.ms<60000).length,0,'An old connection cannot create a ghost reconnect timer');
 streams[1].close();await settle();assert.equal([...pendingTimers.values()].filter(t=>t.ms===2000).length,1,'The current connection still reconnects normally');
 unsubscribe();assert.equal(pendingTimers.size,0,'Unsubscribing cancels the only reconnect');
}finally{Object.assign(globalThis,saved,timers);}
console.log('Workspace update client: shared stream, subscriber isolation, change dedupe, visibility, stale frames, single reconnect and cleanup passed.');
