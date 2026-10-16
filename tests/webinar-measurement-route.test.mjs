import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isIP} from 'node:net';
import ts from 'typescript';
import {z} from 'zod';
import * as policy from '../lib/webinar-policy.ts';
import * as measurementPolicy from '../lib/webinar-measurement-policy.ts';
import {browserPaymentInfo,browserPurchase,marketingConsentVersion} from '../lib/webinar-meta-policy.ts';
const {measurementPolicyVersion}=measurementPolicy,pixelId='1104248230721457';
let settings=policy.settingsSchema.parse({enabled:false,fromEmail:'',postalAddress:'',subjects:['a','b','c'],messages:['a','b','c'],meta:{enabled:true,pixelId}});
let identity={email:null,marketing_consent_at:null,measurement:{}},writes=[];
class WebinarError extends Error{constructor(status,message){super(message);this.status=status;}}
const deps={...policy,...measurementPolicy,z,isIP,browserPaymentInfo,browserPurchase,marketingConsentVersion,WebinarError,webinarHeaders:{},
 webinarLimit:async()=>{},webinarOrigin:()=>{},webinarOwner:async()=>{},webinarVisitor:async()=>({id:'fixture-visitor'}),
 webinarSettings:async()=>settings,webinarBody:r=>r.json(),webinarError:e=>Response.json({error:e.message},{status:e.status??400}),
 metaReady:()=>false,webinarFollowupReadiness:()=>({email:false}),
 db:async(path,method,body)=>{
  if(method==='PATCH'){writes.push({path,body});if(path.startsWith('icash_webinar_settings?'))settings=body.config;return [];}
  if(path==='rpc/icash_webinar_measurement_access'){writes.push({path,body});return identity;}
  if(path==='rpc/icash_webinar_sync_purchases'){writes.push({path,body});return [];}
  if(path.startsWith('icash_webinar_meta_events?'))return [{event_id:'webinar:purchase:pi_fixture',payment_id:'pi_fixture',value_cents:5000}];
  return [];
 }};
async function load(file,key){globalThis[key]=deps;const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');return import('data:text/javascript;base64,'+Buffer.from(`const {${Object.keys(deps).join(',')}}=globalThis.${key};\n`+code).toString('base64'));}
const measurement=await load('app/api/webinar/measurement/route.ts','__measurementFixture');
const studio=await load('app/api/webinar/studio/route.ts','__measurementStudioFixture');
const get=(headers={})=>measurement.GET(new Request('https://example.test/api/webinar/measurement',{headers}));
const postBody=(body,headers={})=>measurement.POST(new Request('https://example.test/api/webinar/measurement',{method:'POST',headers,body:JSON.stringify(body)}));
const post=(allow,headers={})=>postBody({allow,version:marketingConsentVersion},headers);
const automatic=(headers={},extra={})=>postBody({action:'automatic',version:measurementPolicyVersion,...extra},headers);
const lastAccess=()=>writes.filter(w=>w.path==='rpc/icash_webinar_measurement_access').at(-1).body;
const original=process.env.VERCEL_ENV,originalVercel=process.env.VERCEL;
try{
 process.env.VERCEL_ENV='production';process.env.VERCEL='1';
 let result=await(await get()).json();assert.equal(result.enabled,true);assert.equal(result.pixelId,pixelId);assert.equal(result.trackingAllowed,false);assert.deepEqual(result.events,[]);assert.equal(lastAccess().p_action,'read');
 identity={email:null,marketing_consent_at:null,measurement:{basis:'automatic_us',country:'US',policy_version:measurementPolicyVersion,automatic_since:new Date().toISOString()}};
 result=await(await automatic({'x-vercel-ip-country':'US','x-vercel-forwarded-for':'203.0.113.4','user-agent':'fixture'},{fbclid:'click_fixture'})).json();
 assert.equal(result.trackingAllowed,true);assert.equal(result.consent,false,'Automatic measurement is never labeled consent');
 assert.deepEqual(result.events.map(e=>e.eventName),['AddPaymentInfo','Purchase']);assert.equal(result.events[0].data.value,50);
 assert.equal(lastAccess().p_action,'automatic');assert.equal(lastAccess().p_automatic_eligible,true);assert.equal(lastAccess().p_visitor,'fixture-visitor');assert.match(lastAccess().p_metadata.fbc,/click_fixture$/);assert.equal(lastAccess().p_metadata.client_ip_address,'203.0.113.4');
 identity={email:null,marketing_consent_at:null,measurement:{}};
 for(const headers of [{},{'x-vercel-ip-country':'GB'},{'x-vercel-ip-country':'DE'}]){result=await(await automatic(headers)).json();assert.equal(lastAccess().p_automatic_eligible,false);assert.equal(result.trackingAllowed,false);assert.deepEqual(result.events,[]);}
 process.env.VERCEL='';await automatic({'x-vercel-ip-country':'US'});assert.equal(lastAccess().p_automatic_eligible,false,'Untrusted local headers cannot opt into US policy');process.env.VERCEL='1';
 assert.equal((await automatic({'x-vercel-ip-country':'GB'},{country:'US'})).status,400,'Request JSON cannot override the server location');
 identity={email:null,marketing_consent_at:null,measurement:{opt_out_at:new Date().toISOString()}};
 result=await(await automatic({'x-vercel-ip-country':'US'},{optedOut:true})).json();assert.equal(lastAccess().p_action,'deny');assert.equal(result.trackingAllowed,false);assert.equal(result.events.length,0);
 await automatic({'x-vercel-ip-country':'US','sec-gpc':'1'});assert.equal(lastAccess().p_blocked,true);assert.deepEqual(lastAccess().p_metadata,{});
 await post(true,{'sec-gpc':'1'});assert.equal(lastAccess().p_blocked,true,'GPC takes precedence over explicit allow');
 identity={email:null,marketing_consent_at:new Date().toISOString(),measurement:{}};
 assert.equal((await post(true)).status,200,'Explicit privacy choices still work without CAPI credentials');assert.equal(lastAccess().p_action,'allow');
 result=await(await get()).json();assert.equal(result.trackingAllowed,true);assert.equal(result.consent,true);
 await post(false);assert.equal(lastAccess().p_action,'deny');
 process.env.VERCEL_ENV='preview';assert.equal((await(await automatic({'x-vercel-ip-country':'US'})).json()).enabled,false);assert.equal((await post(true)).status,409);
 process.env.VERCEL_ENV='production';settings.meta.enabled=false;assert.equal((await(await automatic()).json()).enabled,false);assert.equal((await post(true)).status,409);assert.equal((await post(false)).status,200,'Opt-outs remain available while tracking is disabled');
 settings.meta={enabled:true,pixelId:''};assert.equal((await(await get()).json()).enabled,false);assert.equal((await post(true)).status,409);
 const save=()=>studio.POST(new Request('https://example.test/api/webinar/studio',{method:'POST',body:JSON.stringify({action:'settings',settings})}));
 assert.equal((await save()).status,400);settings.meta.pixelId=pixelId;assert.equal((await save()).status,200);assert.equal(writes.at(-1).body.config.meta.pixelId,pixelId);
 console.log('PASS automatic Meta route: trusted US eligibility, no false consent, click matching, verified purchase receipts, saved/browser opt-outs, explicit privacy controls and preview exclusion.');
}finally{if(original===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=original;if(originalVercel===undefined)delete process.env.VERCEL;else process.env.VERCEL=originalVercel;delete globalThis.__measurementFixture;delete globalThis.__measurementStudioFixture;}
