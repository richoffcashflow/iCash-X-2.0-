import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import {z} from 'zod';
const sessionId=randomUUID(),pageId=randomUUID(),visitorId=randomUUID();
let callbacks=[],calls=[],preview=false,superseded=false,vip=false,queued=true,originAllowed=true,owned=true;
const deps={z,after:fn=>callbacks.push(fn),processWebinarFollowups:async()=>{},webinarHeaders:{'Cache-Control':'private, no-store'},webinarOrigin:()=>{if(!originAllowed)throw Error('origin');},webinarLimit:async()=>{},webinarBody:r=>r.json(),webinarSession:async id=>{if(!owned||id!==sessionId)throw Error('session');return {v:{id:visitorId},s:{id:sessionId,is_preview:preview,superseded_at:superseded?'now':null,config:{parentWebinarId:vip?'parent':null}}};},webinarError:()=>Response.json({error:'Rejected'},{status:400}),db:async(...args)=>{calls.push(args);return queued;}};
globalThis.__recoveryRoute=deps;
const code=ts.transpileModule(readFileSync(new URL('../app/api/webinar/recovery/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const {POST}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__recoveryRoute;\n'+code).toString('base64'));
const post=(patch={})=>POST(new Request('https://example.test/api/webinar/recovery',{method:'POST',body:JSON.stringify({sessionId,pageId,sequence:2,state:'left',...patch})}));
test('old departure beacons cannot enqueue or dispatch reminders',async()=>{
 for(const patch of [{},{state:'active'},{state:'checkout'},{recipient:'ignored@example.invalid'}])assert.equal((await post(patch)).status,204);
 assert.equal(calls.length,0);assert.equal(callbacks.length,0);
});
