import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {webinarChatStream} from '../lib/webinar-chat-stream.ts';

const original={document:globalThis.document,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
const listeners=new Map(),intervals=new Map(),requests=[];
let effect,feed,reply,error=null,gate=null;
const position={current:18.9};
const message=(id,seconds)=>({id,role:'user',text:id,playback_seconds:seconds,public_status:'approved'});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
globalThis.document={hidden:false,addEventListener:(n,fn)=>listeners.set(n,fn),removeEventListener:n=>listeners.delete(n)};
globalThis.setInterval=fn=>{const id=intervals.size+1;intervals.set(id,fn);return id;};
globalThis.clearInterval=id=>intervals.delete(id);
try{
 const hook=await loadService('components/use-webinar-shared-chat.ts',{
  useState:initial=>{feed=initial;return [initial,value=>{feed=value;}];},useEffect:fn=>{effect=fn;},
  webinarRequest:async(url,options)=>{requests.push({url,...options,body:JSON.parse(options.body)});if(gate)await gate;if(error)throw error;return reply;},
 });
 reply={messages:[message('early',10),message('future',1200),message('unknown',null),message('fraction',2.5),{...message('pending',2),public_status:'pending'}],statuses:[{id:'mine',public_status:'pending'}]};
 hook.useWebinarSharedChat('session-one',position);const cleanup=effect();await flush();
 assert.deepEqual(requests[0].body,{sessionId:'session-one',seconds:18});
 assert.deepEqual(feed.messages.map(m=>[m.id,m.playback_seconds,m.shared]),[['early',10,true],['future',1200,true]],'Polling retains original positions rather than stamping arrival time');
 assert.deepEqual(webinarChatStream([],feed.messages,18).map(e=>e.key),['message:early']);
 assert.deepEqual(feed.statuses,reply.statuses);
 position.current=5;
 assert.deepEqual(webinarChatStream([],feed.messages,position.current),[],'Rewind hides stale shared messages before another poll');
 let resolve;gate=new Promise(r=>{resolve=r;});
 intervals.values().next().value();await flush();assert.equal(requests.at(-1).body.seconds,5);
 position.current=3;reply={messages:[message('late-response',4)],statuses:[]};resolve();await flush();gate=null;
 assert.equal(feed.messages[0].playback_seconds,4);
 assert.deepEqual(webinarChatStream([],feed.messages,position.current),[],'A response arriving after rewind stays tied to its original position');
 for(const [current,expected] of [[-10,0],[NaN,0],[Infinity,0],[18000,14400]]){
  position.current=current;intervals.values().next().value();await flush();assert.equal(requests.at(-1).body.seconds,expected);
 }
 document.hidden=true;const before=requests.length;intervals.values().next().value();await flush();assert.equal(requests.length,before);
 document.hidden=false;listeners.get('visibilitychange')();await flush();assert.equal(requests.length,before+1);
 error={status:403};intervals.values().next().value();await flush();const denied=requests.length;
 intervals.values().next().value();await flush();assert.equal(requests.length,denied,'Denied sessions stop polling');
 cleanup();assert.equal(requests[0].signal.aborted,true);assert.equal(intervals.size,0);assert.equal(listeners.size,0);
 hook.useWebinarSharedChat(undefined,position);const emptyCleanup=effect();assert.deepEqual(feed,{messages:[],statuses:[]});assert.equal(emptyCleanup,undefined);
}finally{Object.assign(globalThis,original);}
console.log('PASS shared chat client: playback request, original positions, rewind/in-flight response, invalid rows, bounds, moderation, visibility, denial and cleanup.');
