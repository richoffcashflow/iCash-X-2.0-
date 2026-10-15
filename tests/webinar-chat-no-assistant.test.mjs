import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
let saved,name='Casey',parentWebinarId=null;
class WebinarError extends Error{constructor(status,message){super(message);this.status=status;}}
const deps={z,WebinarError,db:async(table,method,rows)=>{assert.equal(table,'icash_webinar_messages');assert.equal(method,'POST');saved=rows;return rows.map((r,i)=>({...r,id:String(i)}));},webinarOrigin(){},webinarBody:r=>r.json(),webinarSession:async()=>({v:{id:'visitor',name},s:{id:'owned-session',webinar_id:'webinar-id',revision:7,is_preview:true,progress_seconds:12,config:{parentWebinarId,aiEnabled:true,durationSeconds:1800,recordingVersion:'night'}}}),webinarLimit:async()=>{},webinarHeaders:{'Cache-Control':'private, no-store'},webinarError:e=>Response.json({error:e.message},{status:e.status||500})};
globalThis.noAssistantDeps=deps;
const source=readFileSync(new URL('../app/api/webinar/chat/route.ts',import.meta.url),'utf8');assert.ok(!source.includes('webinarAI'));
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');
const {POST}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.noAssistantDeps;\n'+code).toString('base64'));
const result=await POST(new Request('https://app.test/api/webinar/chat',{method:'POST',body:JSON.stringify({sessionId:'00000000-0000-4000-8000-000000000123',text:'I am ready'})}));
assert.deepEqual(saved,[{session_id:'owned-session',role:'user',text:'I am ready',playback_seconds:12}]);assert.equal((await result.json()).ai,false);assert.equal(result.headers.get('Cache-Control'),'private, no-store');console.log('PASS viewer messages save without an AI call or reply, including old AI-enabled sessions.');
for(name of ['', '   ', null]){
 saved=null;const response=await POST(new Request('https://app.test/api/webinar/chat',{method:'POST',body:JSON.stringify({sessionId:'00000000-0000-4000-8000-000000000123',text:'Cannot skip name entry'})}));
 assert.equal(response.status,400);assert.equal(saved,null);assert.match((await response.json()).error,/Add your name/);
}
console.log('PASS unnamed chat submissions are rejected before writing messages.');

name='Casey';
for(const [seconds,expected] of [[123,123],[14000,1800]]){
 const response=await POST(new Request('https://app.test/api/webinar/chat',{method:'POST',body:JSON.stringify({sessionId:'00000000-0000-4000-8000-000000000123',text:'Timeline check',seconds})}));
 assert.equal(response.status,200);assert.equal(saved[0].playback_seconds,expected);
 assert.equal((await response.json()).messages[0].playback_seconds,expected);
}
for(const seconds of [-1,0.5,14401,'12']){
 saved=null;await POST(new Request('https://app.test/api/webinar/chat',{method:'POST',body:JSON.stringify({sessionId:'00000000-0000-4000-8000-000000000123',text:'Invalid position',seconds})}));assert.equal(saved,null);
}
console.log('PASS chat positions persist, clamp to the recording, and reject invalid input.');

const sharedResponse=await POST(new Request('https://app.test/api/webinar/chat',{method:'POST',body:JSON.stringify({sessionId:'00000000-0000-4000-8000-000000000123',text:'Review me',seconds:14,share:true})}));
assert.equal(sharedResponse.status,200);assert.equal(saved[0].public_status,'pending');assert.equal(saved[0].display_name,'Casey');assert.equal(saved[0].webinar_id,'webinar-id');assert.equal(saved[0].recording_version,'night');assert.equal(saved[0].webinar_revision,7);assert.equal(saved[0].is_preview,true);
console.log('PASS only explicit shared submissions enter review with server-bound name, webinar, recording, revision and preview scope.');

// A server-owned VIP session already passed the paid entry check.
parentWebinarId='paid-main-webinar';
for(const storedName of ['Casey','',null,'   ']){
 name=storedName;saved=null;
 const response=await POST(new Request('https://app.test/api/webinar/chat',{method:'POST',body:JSON.stringify({sessionId:'00000000-0000-4000-8000-000000000123',text:"I'm in",share:true})}));
 assert.equal(response.status,200);assert.equal(saved[0].display_name,storedName?.trim()||'Member');
 assert.equal(saved[0].public_status,'pending','VIP chat keeps the same moderation');
}
console.log('PASS VIP chat uses the saved name or Member without another contact request.');
