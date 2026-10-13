import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
let saved,name='Casey';
class WebinarError extends Error{constructor(status,message){super(message);this.status=status;}}
const deps={z,WebinarError,db:async(table,method,rows)=>{assert.equal(table,'icash_webinar_messages');assert.equal(method,'POST');saved=rows;return rows.map((r,i)=>({...r,id:String(i)}));},webinarOrigin(){},webinarBody:r=>r.json(),webinarSession:async()=>({v:{id:'visitor',name},s:{id:'owned-session',config:{aiEnabled:true}}}),webinarLimit:async()=>{},webinarHeaders:{'Cache-Control':'private, no-store'},webinarError:e=>Response.json({error:e.message},{status:e.status||500})};
globalThis.noAssistantDeps=deps;
const source=readFileSync(new URL('../app/api/webinar/chat/route.ts',import.meta.url),'utf8');assert.ok(!source.includes('webinarAI'));
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');
const {POST}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.noAssistantDeps;\n'+code).toString('base64'));
const result=await POST(new Request('https://app.test/api/webinar/chat',{method:'POST',body:JSON.stringify({sessionId:'00000000-0000-4000-8000-000000000123',text:'I am ready'})}));
assert.deepEqual(saved,[{session_id:'owned-session',role:'user',text:'I am ready'}]);assert.equal((await result.json()).ai,false);assert.equal(result.headers.get('Cache-Control'),'private, no-store');console.log('PASS viewer messages save without an AI call or reply, including old AI-enabled sessions.');
for(name of ['', '   ', null]){
 saved=null;const response=await POST(new Request('https://app.test/api/webinar/chat',{method:'POST',body:JSON.stringify({sessionId:'00000000-0000-4000-8000-000000000123',text:'Cannot skip name entry'})}));
 assert.equal(response.status,400);assert.equal(saved,null);assert.match((await response.json()).error,/Add your name/);
}
console.log('PASS unnamed chat submissions are rejected before writing messages.');
