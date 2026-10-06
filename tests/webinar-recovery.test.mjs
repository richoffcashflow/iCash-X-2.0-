import test from 'node:test';
import assert from 'node:assert/strict';
import {webinarPrompt,emptyPromptHistory,readPromptHistory,savePromptHistory} from '../lib/webinar-prompts.ts';
import {restoredPosition,savePosition,clearPosition,seekToPosition} from '../lib/webinar-playback.ts';
import {webinarRequest,webinarBeacon} from '../lib/webinar-client.ts';
const base={name:'',contactSaved:false,seconds:30,nameAt:30,contactAt:30,history:{...emptyPromptHistory}};
test('name first; phone and email become eligible 30 watched seconds later',()=>{
 assert.equal(webinarPrompt({...base,seconds:29}),null);assert.equal(webinarPrompt(base),'name');
 assert.equal(webinarPrompt({...base,name:'Sam',seconds:59,history:{...base.history,nameSavedAt:30}}),null);
 assert.equal(webinarPrompt({...base,name:'Sam',seconds:60,history:{...base.history,nameSavedAt:30}}),'contact');
 assert.equal(webinarPrompt({...base,name:'Sam',contactSaved:true,seconds:60}),null);
 assert.equal(webinarPrompt({...base,name:'Remembered'}),'contact');
});
test('a skipped form reminds once after five more minutes of playback',()=>{
 const h={...base.history,nameDismissedAt:30,nameAttempts:1};
 assert.equal(webinarPrompt({...base,seconds:329,history:h}),null);assert.equal(webinarPrompt({...base,seconds:330,history:h}),'name');
 assert.equal(webinarPrompt({...base,seconds:999,history:{...h,nameAttempts:2}}),null);
 const contact={...base,name:'Sam',history:{...base.history,contactDismissedAt:60,contactAttempts:1}};
 assert.equal(webinarPrompt({...contact,seconds:359}),null);assert.equal(webinarPrompt({...contact,seconds:360}),'contact');
});
test('saved positions and prompts survive refresh, expire and tolerate blocked storage',()=>{
 const data=new Map();const storage={getItem:key=>data.get(key)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 globalThis.localStorage=storage;globalThis.sessionStorage=storage;
 savePosition('one',235);assert.equal(restoredPosition('one',200,1800),235);assert.equal(restoredPosition('other',20,1800),20);
 assert.equal(restoredPosition('one',200,1800,Date.now()+86401000),200);
 clearPosition('one');assert.equal(restoredPosition('one',200,1800),200);
 const h={...base.history,nameSavedAt:35};savePromptHistory('one',h);assert.deepEqual(readPromptHistory('one'),h);
 localStorage.getItem=()=>{throw Error('blocked');};assert.equal(restoredPosition('one',200,1800),200);assert.deepEqual(readPromptHistory('one'),emptyPromptHistory);
 localStorage.setItem=()=>{throw Error('full');};assert.doesNotThrow(()=>savePosition('one',230));
});
test('reload seeks to the supplied latest position, clamped to real duration',()=>{
 const video={currentTime:0,duration:300};assert.equal(seekToPosition(video,235),true);assert.equal(video.currentTime,235);
 assert.equal(seekToPosition(video,700),true);assert.equal(video.currentTime,299);
});
test('hung writes time out and never auto-repeat; HTTP status survives for auth UI',async()=>{
 const old=globalThis.fetch;let calls=0;
 try{
  globalThis.fetch=async(url,init)=>{calls++;return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(Error('aborted'))));};
  await assert.rejects(webinarRequest('/write',{method:'POST'},15),/too long/);assert.equal(calls,1);
  globalThis.fetch=async()=>new Response(JSON.stringify({error:'Owner only'}),{status:403});
  await assert.rejects(webinarRequest('/owner'),e=>e.status===403&&e.message==='Owner only');
 }finally{globalThis.fetch=old;}
});
test('blocked beacons fall back once without surfacing an unhandled error',async()=>{
 const old=globalThis.fetch;let calls=0;
 Object.defineProperty(globalThis,'navigator',{value:{sendBeacon:()=>false},configurable:true});
 try{globalThis.fetch=async()=>{calls++;return new Response('{"saved":true}');};webinarBeacon('/event',{seconds:30});await new Promise(r=>setTimeout(r,5));assert.equal(calls,1);}finally{globalThis.fetch=old;}
});
