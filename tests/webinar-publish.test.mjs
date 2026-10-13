import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {renderToStaticMarkup} from 'react-dom/server';
import {jsx as _jsx,jsxs as _jsxs} from 'react/jsx-runtime';
import {ArrowRight,Play,CheckCircle2} from 'lucide-react';
import ts from 'typescript';
import {z} from 'zod';
import * as policy from '../lib/webinar-policy.ts';
import {createNightRecording} from '../lib/webinar-recordings.ts';

async function load(path,deps,key){
 globalThis[key]=deps;
 const source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/^import .* from .*;$/gm,'');
 return import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.'+key+';\n'+source).toString('base64'));
}
class WebinarError extends Error{constructor(status,message){super(message);this.status=status;}}
let writes=[],owner=true,conflict=false;
const deps={...policy,z,randomUUID,WebinarError,webinarHeaders:{'Cache-Control':'private, no-store'},webinarOrigin:()=>{},webinarBody:req=>req.json(),webinarOwner:async()=>{if(!owner)throw new WebinarError(403,'Owner only');},webinarError:e=>Response.json({error:e.message},{status:e.status||503}),db:async(path,method,body)=>{
 assert.equal(method,'PATCH');writes.push({path,body});
 return conflict?[]:[{config:body.config,public_code:100000,parent_webinar_id:null}];
}};
const {POST}=await load('../app/api/webinar/studio/route.ts',deps,'__publishRoute');
const {WebinarReview}=await load('../components/webinar-dashboard.tsx',{...policy,_jsx,_jsxs,ArrowRight,Play,CheckCircle2},'__publishReview');
const base={...policy.newWebinar(randomUUID()),publicCode:'100000'};
const night={...createNightRecording(base),videoUrl:'https://example.test/night.mp4',durationSeconds:1657,pitchAt:1355,chat:[{id:'night-chat',at:30,name:'Casey',text:'Ready!',kind:'replay'}]};
const onlyNight={...base,nightVersion:night,nightEnabled:true};
const post=(w,status='published')=>POST(new Request('https://example.test/api/webinar/studio',{method:'POST',body:JSON.stringify({action:'save',isNew:false,webinar:{...w,status}})}));
const render=w=>renderToStaticMarkup(WebinarReview({webinar:w,version:'night',isNew:false,busy:false,onPublish:()=>{}}));

let response=await post(onlyNight),data=await response.json();
assert.equal(response.status,200);assert.equal(data.webinar.status,'published');assert.equal(data.webinar.videoUrl,'');
assert.equal(data.webinar.nightVersion.videoUrl,night.videoUrl);assert.deepEqual(data.webinar.nightVersion.chat,night.chat);
assert.equal(data.webinar.revision,base.revision+1);assert.match(writes.at(-1).path,/revision=eq\.1/);
let html=render(onlyNight);
assert.ok(html.includes('Nighttime video'));assert.ok(html.includes('27:37 · video added'));assert.ok(html.includes('1 timed message'));assert.ok(html.includes('1 timed offer'));
assert.ok(html.includes('Nighttime · runs around the clock'));assert.ok(html.includes('variant=night'));assert.ok(!html.includes('disabled=""'));

writes=[];response=await post(base);assert.equal(response.status,400);assert.match((await response.json()).error,/Daytime or Nighttime video/);assert.equal(writes.length,0);assert.ok(render(base).includes('disabled=""'));
assert.equal((await post(base,'draft')).status,200,'Empty draft can still save');
const expired={...night,offerEndsAt:'2000-01-01T00:00:00Z'};
for(const w of [{...onlyNight,nightEnabled:false,nightVersion:expired},{...onlyNight,videoUrl:'https://example.test/day.mp4',nightVersion:expired}]){
 writes=[];response=await post(w);assert.equal(response.status,400);assert.match((await response.json()).error,/Nighttime.*available offer/);assert.equal(writes.length,0);
 assert.ok(render(w).includes('disabled=""'));
}
assert.equal((await post({...onlyNight,offerEndsAt:'2000-01-01T00:00:00Z'})).status,200,'Unused Daytime offer cannot block Nighttime');
assert.equal((await post({...onlyNight,videoUrl:'https://example.test/day.mp4',nightEnabled:false,nightVersion:expired})).status,200,'Paused second video does not block Daytime');
owner=false;assert.equal((await post(onlyNight)).status,403);owner=true;
conflict=true;assert.equal((await post(onlyNight)).status,409);
console.log('PASS publishing: Nighttime-only video, review/preview, recording-specific offers, preserved chat, draft save, owner authorization and revision conflicts.');
