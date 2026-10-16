import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isIP} from 'node:net';
import ts from 'typescript';
import {z} from 'zod';
import * as policy from '../lib/webinar-policy.ts';
import {browserPurchase,marketingConsentVersion} from '../lib/webinar-meta-policy.ts';
const pixelId='1104248230721457';
let settings=policy.settingsSchema.parse({enabled:false,fromEmail:'',postalAddress:'',subjects:['a','b','c'],messages:['a','b','c'],meta:{enabled:true,pixelId}});
let identity={email:null,marketing_consent_at:null,measurement:{}},writes=[];
class WebinarError extends Error{constructor(status,message){super(message);this.status=status;}}
const deps={...policy,z,isIP,browserPurchase,marketingConsentVersion,WebinarError,webinarHeaders:{},
 webinarLimit:async()=>{},webinarOrigin:()=>{},webinarOwner:async()=>{},webinarVisitor:async()=>({id:'fixture-visitor'}),
 webinarSettings:async()=>settings,webinarBody:r=>r.json(),webinarError:e=>Response.json({error:e.message},{status:e.status??400}),
 metaReady:()=>false,webinarFollowupReadiness:()=>({email:false}),
 db:async(path,method,body)=>{
  if(method==='PATCH'){writes.push({path,body});if(path.startsWith('icash_webinar_visitors?'))identity={...identity,...body};if(path.startsWith('icash_webinar_settings?'))settings=body.config;return [];}
  if(path.startsWith('icash_webinar_visitors?'))return [identity];
  if(path.startsWith('icash_webinar_meta_events?'))return [{event_id:'webinar:purchase:pi_fixture',payment_id:'pi_fixture',value_cents:5000}];
  return [];
 }};
async function load(file,key){globalThis[key]=deps;const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');return import('data:text/javascript;base64,'+Buffer.from(`const {${Object.keys(deps).join(',')}}=globalThis.${key};\n`+code).toString('base64'));}
const measurement=await load('app/api/webinar/measurement/route.ts','__measurementFixture');
const studio=await load('app/api/webinar/studio/route.ts','__measurementStudioFixture');
const get=(headers={})=>measurement.GET(new Request('https://example.test/api/webinar/measurement',{headers}));
const post=(allow,headers={})=>measurement.POST(new Request('https://example.test/api/webinar/measurement',{method:'POST',headers,body:JSON.stringify({allow,version:marketingConsentVersion})}));
const original=process.env.VERCEL_ENV;
try{
 process.env.VERCEL_ENV='production';
 let result=await(await get()).json();assert.equal(result.enabled,true);assert.equal(result.pixelId,pixelId);assert.equal(result.consent,false);assert.deepEqual(result.events,[]);
 assert.equal((await post(true)).status,200,'Browser consent does not require server API credentials');
 result=await(await get()).json();assert.equal(result.consent,true);assert.equal(result.events[0].eventName,'Purchase');assert.equal(result.events[0].data.value,50);
 await post(false);assert.equal(identity.marketing_consent_at,null);assert(writes.some(w=>w.body.state==='canceled'));
 await post(true,{'sec-gpc':'1'});assert.equal(identity.marketing_consent_at,null,'GPC prevents consent');
 await post(true);result=await(await get({'sec-gpc':'1'})).json();assert.equal(result.consent,false);assert.deepEqual(result.events,[]);assert.deepEqual(identity.measurement,{});
 process.env.VERCEL_ENV='preview';assert.equal((await(await get()).json()).enabled,false);assert.equal((await post(true)).status,409);
 process.env.VERCEL_ENV='production';settings.meta.enabled=false;assert.equal((await(await get()).json()).enabled,false);assert.equal((await post(true)).status,409);
 settings.meta={enabled:true,pixelId:''};assert.equal((await(await get()).json()).enabled,false);assert.equal((await post(true)).status,409);
 const save=()=>studio.POST(new Request('https://example.test/api/webinar/studio',{method:'POST',body:JSON.stringify({action:'settings',settings})}));
 assert.equal((await save()).status,400,'An enabled connection still requires a Pixel ID');
 settings.meta.pixelId=pixelId;assert.equal((await save()).status,200,'Owner can save browser-only Meta setup');assert.equal(writes.at(-1).body.config.meta.pixelId,pixelId);
 console.log('PASS browser-only Meta setup: settings save, production admission, consent, GPC, opt-out, verified purchase and preview exclusion.');
}finally{if(original===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=original;delete globalThis.__measurementFixture;delete globalThis.__measurementStudioFixture;}
