import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import * as policy from '../lib/webinar-policy.ts';
import * as engine from '../packages/webinar-engine/src/intelligence.ts';
import {eligibleVariants,isNight,selectOffer} from '../packages/webinar-engine/src/index.ts';
import {selectRecording} from '../lib/webinar-recordings.ts';
import {snapshotChat} from '../lib/webinar-variants.ts';
import {returnVisit} from '../lib/webinar-optimizer.ts';
const settings=policy.settingsSchema.parse({enabled:false,fromEmail:'',postalAddress:'',subjects:['a','b','c'],messages:['a','b','c'],optimizer:{enabled:true,explorationPercent:20,minVisitors:100}});
const one={...policy.newWebinar(randomUUID()),status:'published',videoUrl:'https://example.test/one.mp4',priority:10},two={...one,id:randomUUID(),priority:0,title:'Challenger'};
let history=[],events=[],rows=[one,two],calls=[],owner=true,failReport=false,failStops=false,stopRows=[],metricRows=[],account=null,paid=false,visitor={id:randomUUID(),attribution:{utm_content:'77777'}};
class WebinarError extends Error{constructor(status,message){super(message);this.status=status;}}
const db=async(path,method,body)=>{
 calls.push({path,method,body});
 if(path.startsWith('icash_webinars?'))return rows.filter((w,i)=>!path.includes('public_code=eq.')||i===0).map((config,i)=>({config,public_code:123456+i}));
 if(path.startsWith('icash_webinar_sessions?'))return history;
 if(path.startsWith('icash_webinar_events?'))return events;
 if(path.startsWith('icash_webinar_settings?'))return [{config:settings}];
 if(path.startsWith('rpc/icash_webinar_begin'))return {id:body.p_id,config:body.p_config,completed_at:null,progress_seconds:0};
 if(path.startsWith('icash_webinar_intelligence_stops?')){if(failStops)throw Error('stops unavailable');return stopRows.filter(s=>path.includes('context_key=eq.'+s.context_key+'&'));}
 if(path==='rpc/icash_webinar_intelligence_report'){if(failReport)throw Error('aggregation unavailable');return {rows:metricRows,ads:[],comparisons:[],generatedAt:new Date().toISOString()};}
 if(path.startsWith('icash_webinar_messages?'))return [];
 return {};
};
async function load(path,deps,key){globalThis[key]=deps;const source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');return import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.'+key+';\n'+source).toString('base64'));}
const adapter=await load('../lib/webinar-intelligence.ts',{createHash,unstable_cache:fn=>fn,db,eligibleVariants,isNight,...engine,selectRecording,...policy},'__smartAdapter');
const common={...policy,...engine,...adapter,z,db,webinarHeaders:{'Cache-Control':'private, no-store'},WebinarError,webinarBody:req=>req.json(),webinarOrigin:()=>{},webinarLimit:async()=>{},webinarOwner:async()=>{if(!owner)throw new WebinarError(403,'Owner only');},webinarError:e=>Response.json({error:e.message},{status:e.status||503})};
const {POST}=await load('../app/api/webinar/start/route.ts',{...common,randomUUID,randomBytes,selectRecording,selectOffer,snapshotChat,returnVisit,approximateRegion:()=>null,webinarSite:{workspacePath:'/',checkoutPath:'/join'},webinarVisitor:async()=>visitor,webinarCustomerAccount:async()=>account,webinarCustomerPaid:async()=>paid,validGuest:()=>true,guestHash:()=> 'guest',cookies:async()=>({get:()=>({value:'guest'}),set:()=>{}})},'__smartRoute');
const post=body=>POST(new Request('https://example.test/api/webinar/start',{method:'POST',body:JSON.stringify({timezone:'UTC',...body})}));
let response=await post({attribution:{utm_content:'55555',email:'not-saved@example.test'}});assert.equal(response.status,200);let data=await response.json();
let begin=calls.find(c=>c.path==='rpc/icash_webinar_begin_intelligent');assert.ok(begin);assert.equal(begin.body.p_assignment.ad_key,'ad:55555');assert.equal(begin.body.p_assignment.context_key.startsWith('new:'),true);assert.equal(data.webinar.intelligence,undefined);assert.ok(!JSON.stringify(data).includes('55555'));assert.equal(calls.find(c=>c.method==='PATCH').body.attribution.email,undefined);
calls=[];await post({});assert.equal(calls.find(c=>c.path==='rpc/icash_webinar_begin_intelligent').body.p_assignment.ad_key,'ad:77777','Untagged return preserves known acquisition ad');
calls=[];failReport=true;data=await(await post({})).json();begin=calls.find(c=>c.path==='rpc/icash_webinar_begin_intelligent');assert.equal(data.webinar.id,one.id);assert.equal(begin.body.p_assignment.mode,'fallback','Analytics outage still starts a baseline session');failReport=false;
calls=[];await post({code:'123456'});assert.ok(calls.some(c=>c.path==='rpc/icash_webinar_begin'));assert.ok(!calls.some(c=>c.path.includes('intelligence')),'Permanent links do not enter experiments');
calls=[];await post({preview:one.id});assert.ok(calls.some(c=>c.path==='rpc/icash_webinar_begin'&&c.body.p_preview));assert.ok(!calls.some(c=>c.path.includes('intelligence')));
const now=new Date().toISOString(),saved={...one,recordingVersion:'day',title:'Saved version'};
history=[{id:randomUUID(),webinar_id:one.id,revision:1,progress_seconds:100,max_seconds:100,completed_at:null,superseded_at:null,is_preview:false,config:saved,created_at:now,updated_at:now}];
calls=[];data=await(await post({})).json();assert.equal(data.webinar.title,'Saved version');assert.ok(!calls.some(c=>c.path.includes('intelligence')),'Saved viewing does not reroll');
history[0].max_seconds=1300;events=[{session_id:history[0].id,kind:'pitch_shown',event_key:'once',created_at:now}];calls=[];data=await(await post({})).json();assert.ok(data.redirect);assert.ok(!calls.some(c=>c.path.includes('begin')),'Offer window goes directly to checkout');
events[0].created_at=new Date(Date.now()-4*3600000).toISOString();calls=[];data=await(await post({})).json();begin=calls.find(c=>c.path==='rpc/icash_webinar_begin_intelligent');assert.equal(data.webinar.id,two.id);assert.equal(begin.body.p_advance_from,history[0].id);assert.equal(begin.body.p_assignment.context_key.startsWith('returning:'),true);
history=[];events=[];account={id:randomUUID(),destination:'/?workspace=1'};calls=[];data=await(await post({})).json();assert.equal(data.redirect,account.destination);assert.ok(!calls.some(c=>c.path.includes('begin')));account=null;paid=true;data=await(await post({})).json();assert.equal(data.redirect,'/');paid=false;
const admin=await load('../app/api/webinar/intelligence/route.ts',common,'__smartAdmin');
owner=false;assert.equal((await admin.GET(new Request('https://example.test/api/webinar/intelligence'))).status,403);assert.equal((await admin.POST(new Request('https://example.test/api/webinar/intelligence',{method:'POST',body:'{"enabled":false}'}))).status,403);
owner=true;assert.equal((await admin.GET(new Request('https://example.test/api/webinar/intelligence?ad=human-name'))).status,400);
response=await admin.GET(new Request('https://example.test/api/webinar/intelligence?context=new:night'));data=await response.json();assert.equal(response.status,200);assert.equal(data.arms.length,2);assert.ok(data.arms.every(a=>a.version==='day'),'Admin shows Day fallback without inventing Night');assert.equal(data.comparison,null);
assert.equal((await admin.POST(new Request('https://example.test/api/webinar/intelligence',{method:'POST',body:'{"enabled":false,"pixelId":"123456"}'}))).status,400);
calls=[];response=await admin.POST(new Request('https://example.test/api/webinar/intelligence',{method:'POST',body:'{"enabled":false}'}));assert.equal(response.status,200);assert.deepEqual(calls,[{path:'rpc/icash_webinar_intelligence_settings',method:'POST',body:{p_enabled:false}}]);
// A stopped baseline cannot re-enter through analytics fallback, a single-arm
// pool, or a read failure. Stop scopes remain independent at night.
const context=calls.find(c=>c.path==='rpc/icash_webinar_intelligence_report')?.body.p_context??adapter.intelligenceContext([],'UTC',new Date(),settings.routing);
stopRows=[{context_key:context,ad_key:'*',arm_key:engine.armKey(one),winner_key:engine.armKey(two)}];
failReport=true;calls=[];data=await(await post({})).json();assert.equal(data.webinar.id,two.id,'A metrics outage still honors saved stops');failReport=false;
rows=[one];calls=[];data=await(await post({})).json();assert.equal(data.redirect,'/join');assert.ok(!calls.some(c=>c.path.includes('begin')),'A single stopped candidate is not revived');rows=[one,two];
failStops=true;calls=[];assert.equal((await post({})).status,503);assert.ok(!calls.some(c=>c.path.includes('begin')),'No assignment without checking saved stops');failStops=false;
const otherContext=context==='new:day'?'new:night':'new:day';data=await(await admin.GET(new Request('https://example.test/api/webinar/intelligence?context='+otherContext))).json();assert.deepEqual(data.plan.stoppedKeys,[],'Day and Night stops are independent even with Day fallback');
stopRows=[];
metricRows=[{ad_key:'*',webinar_id:one.id,revision:1,recording_version:'day',learning_visitors:1000,learning_buyers:200,learning_value_cents:2000000,learning_value_squares:20000000000},{ad_key:'*',webinar_id:two.id,revision:1,recording_version:'day',learning_visitors:1000,learning_buyers:10,learning_value_cents:100000,learning_value_squares:1000000000}];
calls=[];data=await(await post({})).json();assert.equal(data.webinar.id,one.id);const stopCall=calls.find(c=>c.path==='rpc/icash_webinar_stop_recordings');assert.ok(stopCall);assert.equal(stopCall.body.p_stops[0].arm_key,engine.armKey(two));assert.ok(calls.indexOf(stopCall)<calls.findIndex(c=>c.path==='rpc/icash_webinar_begin_intelligent'),'Stop decisions are saved before assigning traffic');
console.log('Intelligence routes passed: allocation, saved stops, outage behavior, Day/Night isolation, zero-traffic checkout, pinned links, resume, returns and owner permissions.');
