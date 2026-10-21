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
 const first=subscribeWorkspaceChanges(()=>a++),second=subscribeWorkspaceChanges(()=>b++);await flush();assert.equal(reads,1,'Panels share a single authenticated stream');
 emit('1');await flush();assert.equal(a,1);assert.equal(b,1);emit('1');await flush();assert.equal(a,1,'Repeated revisions do not refresh');
 first();emit('2');await flush();assert.equal(a,1);assert.equal(b,2);
 documentTarget.hidden=true;documentTarget.dispatchEvent(new Event('visibilitychange'));await flush();assert.equal(aborted,1);
 documentTarget.hidden=false;documentTarget.dispatchEvent(new Event('visibilitychange'));await flush();assert.equal(reads,2);assert.equal(b,3,'Returning to the tab refreshes saved work');
 second();await flush();assert.equal(aborted,2,'Last subscriber closes the stream');
}finally{Object.assign(globalThis,saved);}
console.log('Workspace update client: one stream per tab, change dedupe, hidden-tab pause, resumption and cleanup passed.');
