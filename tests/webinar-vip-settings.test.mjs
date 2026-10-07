import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import * as policy from '../lib/webinar-policy.ts';
const day=randomUUID(),night=randomUUID(),main=randomUUID();let calls=[],owner=true;
class WebinarError extends Error{constructor(status,message){super(message);this.status=status;}}
const deps={...policy,z,WebinarError,webinarHeaders:{},webinarOrigin:()=>{},webinarOwner:async()=>{if(!owner)throw new WebinarError(403,'Owner only');},webinarBody:req=>req.json(),webinarError:e=>Response.json({error:e.message},{status:e.status??503}),webinarFollowupReadiness:()=>({email:false}),metaReady:()=>false,db:async(path,method,body)=>{calls.push({path,method,body});if(path.startsWith('icash_webinars?'))return [day,night].some(id=>path.includes('id=eq.'+id))?[{id:day}]:[];return [];}};
globalThis.__vipSettings=deps;const source=ts.transpileModule(readFileSync(new URL('../app/api/webinar/studio/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const {POST}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__vipSettings;\n'+source).toString('base64'));
const initial={enabled:false,fromEmail:'',postalAddress:'',subjects:['a','b','c'],messages:['a','b','c'],homepageVipId:day};
assert.equal(policy.settingsSchema.parse(initial).homepageVipMode,'selected');assert.equal(policy.settingsSchema.parse(initial).homepageVipNightId,null,'Existing homepage selection carries forward for both times');
const post=settings=>POST(new Request('https://example.test/api/webinar/studio',{method:'POST',body:JSON.stringify({action:'settings',settings})}));
let response=await post({...initial,homepageVipNightId:night,homepageVipMode:'best-converting',optimizer:{enabled:true,explorationPercent:20,minVisitors:100}});assert.equal(response.status,200);
const saved=calls.find(c=>c.method==='PATCH').body.config;assert.equal(saved.homepageVipId,day);assert.equal(saved.homepageVipNightId,night);assert.equal(saved.homepageVipMode,'best-converting');assert.equal(saved.optimizer.enabled,false);assert.deepEqual(policy.settingsSchema.parse(saved),saved,'New settings survive strict round-trip parsing');
calls=[];response=await post({...initial,homepageVipNightId:main});assert.equal(response.status,400);assert.ok(!calls.some(c=>c.method==='PATCH'),'A main webinar cannot be saved as a VIP destination');
owner=false;calls=[];response=await post(initial);assert.equal(response.status,403);assert.equal(calls.length,0);
console.log('PASS owner VIP settings: legacy fallback, independent Day/Night IDs, automatic mode, retired tests stay off, invalid destinations rejected before writing.');
