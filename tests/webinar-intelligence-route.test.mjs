import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import * as policy from '../lib/webinar-policy.ts';
import {returnVisit,selectOffer} from '../packages/webinar-engine/src/index.ts';
import {selectRecording,createNightRecording} from '../lib/webinar-recordings.ts';
import {snapshotChat} from '../lib/webinar-variants.ts';
const one={...policy.newWebinar(randomUUID()),status:'published',videoUrl:'https://example.test/main.mp4',publicCode:'123456'};
const vip={...policy.newVipWebinar(randomUUID(),one),status:'published',videoUrl:'https://example.test/vip-day.mp4',publicCode:'123457',nightEnabled:true};vip.nightVersion={...createNightRecording(vip),videoUrl:'https://example.test/vip-night.mp4'};
const settings=policy.settingsSchema.parse({enabled:false,fromEmail:'',postalAddress:'',subjects:['a','b','c'],messages:['a','b','c'],optimizer:{enabled:true,explorationPercent:20,minVisitors:100}});
let now=Date.parse('2026-10-07T18:00:00Z'),history=[],events=[],calls=[],owner=true,account=null,paid=false,vipPaid=false;
class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
class WebinarError extends Error{constructor(status,message){super(message);this.status=status;}}
const visitor={id:randomUUID(),attribution:{ad_id:'77777'}};
const db=async(path,method,body)=>{
 calls.push({path,method,body});
 if(path.startsWith('icash_webinars?')){const w=path.includes('123457')?vip:one;return [{config:w,public_code:Number(w.publicCode),parent_webinar_id:w.parentWebinarId}];}
 if(path.startsWith('icash_webinar_sessions?'))return history.filter(h=>path.includes('webinar_id=eq.'+h.webinar_id+'&'));
 if(path.startsWith('icash_webinar_events?'))return events;
 if(path.startsWith('icash_webinar_settings?'))return [{config:settings}];
 if(path==='rpc/icash_webinar_begin')return {id:body.p_id,config:body.p_config,completed_at:null,progress_seconds:0};
 if(path.startsWith('icash_webinar_messages?'))return [];
 if(path.includes('intelligence'))throw Error('Retired routing was called');
 return {};
};
async function load(path,deps,key){globalThis[key]=deps;const source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');return import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.'+key+';\n'+source).toString('base64'));}
const common={...policy,z,db,Date:Clock,webinarHeaders:{'Cache-Control':'private, no-store'},WebinarError,webinarBody:req=>req.json(),webinarOrigin:()=>{},webinarLimit:async()=>{},webinarOwner:async()=>{if(!owner)throw new WebinarError(403,'Owner only');},webinarError:e=>Response.json({error:e.message},{status:e.status||503})};
const {POST}=await load('../app/api/webinar/start/route.ts',{...common,randomUUID,randomBytes,selectRecording:(w,t,_now,...rest)=>selectRecording(w,t,new Date(now),...rest),selectOffer,snapshotChat,returnVisit,approximateRegion:()=>null,webinarSite:{workspacePath:'/',checkoutPath:'/webinar/checkout'},webinarVipAccess:async()=>vipPaid,webinarVisitor:async()=>visitor,webinarCustomerAccount:async()=>account,webinarPaid:async()=>false,webinarCustomerPaid:async()=>paid,validGuest:()=>true,guestHash:()=> 'guest',cookies:async()=>({get:()=>({value:'guest'}),set:()=>{}})},'__fixedRoute');
const post=body=>POST(new Request('https://example.test/api/webinar/start',{method:'POST',body:JSON.stringify({timezone:'America/Chicago',...body})}));
let data=await(await post({attribution:{ad_id:'55555',email:'ignored@example.invalid'}})).json();
assert.equal(data.webinar.id,one.id);assert.ok(calls.some(c=>c.path==='rpc/icash_webinar_begin'));assert.ok(!calls.some(c=>c.path.includes('intelligence')),'Legacy enabled settings never assign experiments');assert.equal(calls.find(c=>c.method==='PATCH').body.attribution.email,undefined);
const saved={...one,title:'Saved main'};
history=[{id:randomUUID(),webinar_id:one.id,revision:1,progress_seconds:100,max_seconds:100,completed_at:null,superseded_at:null,is_preview:false,config:saved,created_at:new Date(now).toISOString(),updated_at:new Date(now).toISOString()}];
data=await(await post({code:'123456'})).json();assert.equal(data.webinar.title,'Saved main');
history[0].completed_at=new Date(now-3600000).toISOString();history[0].max_seconds=1800;data=await(await post({code:'123456'})).json();assert.equal(data.redirect,`/webinar/checkout?webinar_session=${history[0].id}`);
history[0].completed_at=new Date(now-9*3600000).toISOString();calls=[];data=await(await post({code:'123456'})).json();assert.equal(data.webinar.id,one.id,'Unpaid returns stay in the same main webinar');assert.equal(calls.find(c=>c.path==='rpc/icash_webinar_begin').body.p_advance_from,history[0].id);
history=[];calls=[];data=await(await post({code:'123457'})).json();assert.equal(data.redirect,'/webinar/checkout');assert.ok(!calls.some(c=>c.path.includes('begin')),'A VIP link is not proof of payment');
account={id:randomUUID(),destination:'/',needsBudget:true};data=await(await post({code:'123457'})).json();assert.equal(data.redirect,'/webinar/checkout','A free account alone cannot unlock VIP');
vipPaid=true;data=await(await post({code:'123457'})).json();assert.equal(data.webinar.videoUrl,vip.videoUrl,'Paid buyers with no budget can watch VIP');
now=Date.parse('2026-10-08T03:00:00Z');data=await(await post({code:'123457'})).json();assert.equal(data.webinar.videoUrl,vip.nightVersion.videoUrl);assert.equal(data.webinar.recordingVersion,'night');
vip.nightVersion.videoUrl='';vip.nightEnabled=false;data=await(await post({code:'123457'})).json();assert.equal(data.webinar.videoUrl,vip.videoUrl,'Day safely covers nighttime without a published Night');
const vipSaved={...vip,title:'Saved VIP day',nightVersion:null,nightEnabled:false,recordingVersion:'day'};
history=[{id:randomUUID(),webinar_id:vip.id,revision:1,progress_seconds:1550,max_seconds:1550,completed_at:null,superseded_at:null,is_preview:false,config:vipSaved,created_at:new Date(now-60000).toISOString(),updated_at:new Date(now-60000).toISOString()}];events=[{session_id:history[0].id,kind:'pitch_shown',event_key:'once',created_at:new Date(now-30000).toISOString()}];data=await(await post({code:'123457'})).json();assert.equal(data.webinar.title,'Saved VIP day','VIP never routes back to checkout at its offer');
account=null;vipPaid=false;owner=false;assert.equal((await post({preview:vip.id})).status,403);
const admin=await load('../app/api/webinar/intelligence/route.ts',common,'__retiredAdmin');assert.equal((await admin.GET()).status,403);owner=true;assert.deepEqual(await(await admin.GET()).json(),{enabled:false,retired:true});assert.equal((await admin.POST(new Request('https://example.test/api/webinar/intelligence',{method:'POST',body:'{"enabled":true}'}))).status,410);
console.log('PASS fixed routing: no experiments, stable acquisition attribution, same-webinar returns, paid VIP gate, local Day/Night fallback, saved VIP resume and retired controls.');
