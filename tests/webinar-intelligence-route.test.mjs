import {webinarViewerLocation} from '../lib/webinar-viewer-location.ts';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import * as policy from '../lib/webinar-policy.ts';
import {returnVisit,selectOffer,paidAdArrival,confirmedWatch,bestConvertingWebinar,stableWebinarOrder} from '../packages/webinar-engine/src/index.ts';
import {selectRecording,createNightRecording} from '../lib/webinar-recordings.ts';
import {webinarLink} from '../lib/webinar-links.ts';
import {snapshotChat} from '../lib/webinar-variants.ts';
const one={...policy.newWebinar(randomUUID()),status:'published',videoUrl:'https://example.test/main.mp4',publicCode:'123456'};
const vip={...policy.newVipWebinar(randomUUID(),one),status:'published',videoUrl:'https://example.test/vip-day.mp4',publicCode:'123457',nightEnabled:true};vip.nightVersion={...createNightRecording(vip),videoUrl:'https://example.test/vip-night.mp4'};
const settings=policy.settingsSchema.parse({enabled:false,fromEmail:'',postalAddress:'',subjects:['a','b','c'],messages:['a','b','c'],optimizer:{enabled:true,explorationPercent:20,minVisitors:100}});
const two={...one,id:randomUUID(),publicCode:'123458',title:'Second'},three={...one,id:randomUUID(),publicCode:'123459',title:'Third',nightEnabled:true};three.nightVersion={...createNightRecording(three),videoUrl:'https://example.test/third-night.mp4'};
let pool=[one,vip,two,three],stats=[],failRouting=false;
let now=Date.parse('2026-10-07T18:00:00Z'),history=[],events=[],calls=[],owner=true,account=null,paid=false,vipPaid=false;
class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
class WebinarError extends Error{constructor(status,message){super(message);this.status=status;}}
const visitor={id:randomUUID(),attribution:{ad_id:'77777'}};
const db=async(path,method,body)=>{
 calls.push({path,method,body});
 if(path.startsWith('icash_webinars?')){if(path.includes('limit=1000')&&failRouting)throw Error('Optional routing unavailable');const selected=path.includes('limit=1000')?pool:path.includes('123457')?[vip]:path.includes('123458')?[two]:[one];return selected.map(w=>({config:w,public_code:Number(w.publicCode),parent_webinar_id:w.parentWebinarId}));}
 if(path.startsWith('icash_webinar_sessions?'))return path.includes('&webinar_id=eq.')?history.filter(h=>path.includes('webinar_id=eq.'+h.webinar_id+'&')):history;
 if(path.startsWith('icash_webinar_events?'))return events;
 if(path.startsWith('icash_webinar_settings?'))return [{config:settings}];
 if(path==='rpc/icash_webinar_begin')return {id:body.p_id,config:body.p_config,completed_at:null,progress_seconds:0};
 if(path.startsWith('icash_webinar_messages?'))return [];
 if(path.includes('intelligence'))throw Error('Retired routing was called');
 return {};
};
async function load(path,deps,key){globalThis[key]=deps;const source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');return import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.'+key+';\n'+source).toString('base64'));}
const common={webinarViewerLocation,...policy,z,db,Date:Clock,webinarHeaders:{'Cache-Control':'private, no-store'},WebinarError,webinarBody:req=>req.json(),webinarOrigin:()=>{},webinarLimit:async()=>{},webinarOwner:async()=>{if(!owner)throw new WebinarError(403,'Owner only');},webinarError:e=>Response.json({error:e.message},{status:e.status||503})};
const returns=await load('../lib/webinar-ad-returns.ts',{...common,returnVisit,paidAdArrival,confirmedWatch,bestConvertingWebinar,stableWebinarOrder,selectRecording,availableWebinarRows:rows=>rows.map(policy.webinarFromRow),webinarConversionRecordings:async()=>stats},'__adReturns');
const {POST}=await load('../app/api/webinar/start/route.ts',{...common,...returns,webinarLink,randomUUID,randomBytes,selectRecording:(w,t,_now,...rest)=>selectRecording(w,t,new Date(now),...rest),selectOffer,snapshotChat,returnVisit,approximateRegion:()=>null,webinarSite:{workspacePath:'/',checkoutPath:'/webinar/checkout'},webinarVipAccess:async()=>vipPaid,webinarVisitor:async()=>visitor,webinarCustomerAccount:async()=>account,webinarPaid:async()=>false,webinarCustomerPaid:async()=>paid,validGuest:()=>true,guestHash:()=> 'guest',cookies:async()=>({get:()=>({value:'guest'}),set:()=>{}})},'__fixedRoute');
const post=(body,headers={})=>POST(new Request('https://example.test/api/webinar/start',{method:'POST',headers,body:JSON.stringify({timezone:'America/Chicago',...body})}));
let data=await(await post({attribution:{ad_id:'55555',email:'ignored@example.invalid'}})).json();
assert.equal(data.webinar.id,one.id);assert.ok(calls.some(c=>c.path==='rpc/icash_webinar_begin'));assert.ok(!calls.some(c=>c.path.includes('intelligence')),'Legacy enabled settings never assign experiments');assert.equal(calls.find(c=>c.method==='PATCH').body.attribution.email,undefined);
const saved={...one,title:'Saved main'};
history=[{id:randomUUID(),webinar_id:one.id,revision:1,progress_seconds:100,max_seconds:100,completed_at:null,superseded_at:null,is_preview:false,config:saved,created_at:new Date(now).toISOString(),updated_at:new Date(now).toISOString()}];
data=await(await post({code:'123456',attribution:{ad_id:'55555'}})).json();assert.equal(data.webinar.title,'Saved main');
history[0].completed_at=new Date(now-3600000).toISOString();history[0].max_seconds=1800;data=await(await post({code:'123456',attribution:{ad_id:'55555'}})).json();assert.equal(data.redirect,`/webinar/checkout?webinar_session=${history[0].id}`);
calls=[];data=await(await post({code:'123456',returnToWebinar:true})).json();assert.equal(data.webinar.id,one.id,'A webinar reminder can replay during the checkout window');assert.equal(data.redirect,undefined);assert.equal(calls.find(c=>c.path==='rpc/icash_webinar_begin').body.p_advance_from,history[0].id);
history[0].completed_at=new Date(now-9*3600000).toISOString();calls=[];data=await(await post({code:'123456'})).json();assert.equal(data.webinar.id,one.id,'Unpaid returns stay in the same main webinar');assert.equal(calls.find(c=>c.path==='rpc/icash_webinar_begin').body.p_advance_from,history[0].id);
// Only a fresh tagged ad repeating confirmed viewing can advance. No experiment RPCs.
history[0].watched_seconds=1700;
data=await(await post({code:'123456',attribution:{fbclid:'organic-click'}})).json();assert.equal(data.webinar.id,one.id,'A Meta click alone is not proof of a paid ad');
history[0].watched_seconds=100;data=await(await post({code:'123456',attribution:{ad_id:'55555'}})).json();assert.equal(data.webinar.id,one.id,'Seeking to the end does not qualify');
history[0].watched_seconds=1700;
data=await(await post({code:'123456',attribution:{ad_id:'55555'}})).json();assert.equal(data.webinar.id,two.id,'Limited data uses stable eligible link order');
stats=[{webinarId:two.id,version:'day',viewers:100,cohortBuyers:4},{webinarId:three.id,version:'day',viewers:100,cohortBuyers:15}];
calls=[];data=await(await post({code:'123456',attribution:{ad_id:'55555',utm_source:'facebook'}})).json();assert.equal(data.webinar.id,three.id);assert.equal(data.canonicalPath,'/live/123459');assert.equal(data.webinar.adEntryWebinarId,undefined,'Private source metadata never reaches the room');assert.equal(calls.find(c=>c.path==='rpc/icash_webinar_begin').body.p_config.adEntryWebinarId,one.id);assert.equal(calls.find(c=>c.method==='PATCH').body.attribution.ad_id,'55555');
data=await(await post({code:'123458',attribution:{ad_id:'55555'}})).json();assert.equal(data.webinar.id,two.id,'An unwatched ad destination is respected');
const prior=history[0],savedAlternative={...three,adEntryWebinarId:one.id,title:'Saved alternative',nightVersion:null,nightEnabled:false,recordingVersion:'day'};
history.push({...prior,id:randomUUID(),webinar_id:three.id,config:savedAlternative,completed_at:null,watched_seconds:100,progress_seconds:100,max_seconds:100,created_at:new Date(now-60000).toISOString(),updated_at:new Date(now-60000).toISOString()});
delete history[1].config.adEntryWebinarId;stats[0].cohortBuyers=60;data=await(await post({code:'123456',attribution:{ad_id:'55555'}})).json();assert.equal(data.webinar.title,'Saved alternative','Playback already started from another entry is also preserved');history[1].config.adEntryWebinarId=one.id;data=await(await post({code:'123456',attribution:{ad_id:'55555'}})).json();assert.equal(data.webinar.title,'Saved alternative','A returning ad cannot rerank an active saved alternative');
history[1].completed_at=new Date(now-1000).toISOString();history[1].watched_seconds=1700;history[1].max_seconds=1800;data=await(await post({code:'123456',attribution:{ad_id:'55555'}})).json();assert.equal(data.redirect,`/webinar/checkout?webinar_session=${history[1].id}`,'The alternative owns its checkout and VIP');
history[1].completed_at=new Date(now-9*3600000).toISOString();data=await(await post({code:'123456',attribution:{ad_id:'55555'}})).json();assert.equal(data.webinar.id,two.id,'A completed alternative is excluded after its checkout window');
failRouting=true;data=await(await post({code:'123456',attribution:{ad_id:'55555'}})).json();assert.equal(data.webinar.id,one.id,'Optional selection failure keeps the original video');failRouting=false;
history=[prior];pool=[one,vip,{...two,status:'draft'},{...three,offerEndsAt:new Date(now-1).toISOString()}];data=await(await post({code:'123456',attribution:{ad_id:'55555'}})).json();assert.equal(data.webinar.id,one.id,'VIP, draft and expired alternatives never replace the original');pool=[one,vip,two,three];
now=Date.parse('2026-10-08T03:00:00Z');stats=[{webinarId:two.id,version:'day',viewers:100,cohortBuyers:4},{webinarId:three.id,version:'night',viewers:100,cohortBuyers:12}];data=await(await post({code:'123456',attribution:{ad_id:'55555'}})).json();assert.equal(data.webinar.recordingVersion,'night');assert.equal(data.webinar.videoUrl,three.nightVersion.videoUrl,'Selection retains the correct local recording');now=Date.parse('2026-10-07T18:00:00Z');
history=[];calls=[];data=await(await post({code:'123457'})).json();assert.equal(data.redirect,'/webinar/checkout');assert.ok(!calls.some(c=>c.path.includes('begin')),'A VIP link is not proof of payment');
account={id:randomUUID(),destination:'/',needsBudget:true};data=await(await post({code:'123457'})).json();assert.equal(data.redirect,'/webinar/checkout','A free account alone cannot unlock VIP');
vipPaid=true;data=await(await post({code:'123457'})).json();assert.equal(data.webinar.videoUrl,vip.videoUrl,'Paid buyers with no budget can watch VIP');
now=Date.parse('2026-10-08T03:00:00Z');data=await(await post({code:'123457'})).json();assert.equal(data.webinar.videoUrl,vip.nightVersion.videoUrl);assert.equal(data.webinar.recordingVersion,'night');
vip.nightVersion.videoUrl='';vip.nightEnabled=false;data=await(await post({code:'123457'})).json();assert.equal(data.webinar.videoUrl,vip.videoUrl,'Day safely covers nighttime without a published Night');
const vipSaved={...vip,title:'Saved VIP day',nightVersion:null,nightEnabled:false,recordingVersion:'day'};
history=[{id:randomUUID(),webinar_id:vip.id,revision:1,progress_seconds:1550,max_seconds:1550,completed_at:null,superseded_at:null,is_preview:false,config:vipSaved,created_at:new Date(now-60000).toISOString(),updated_at:new Date(now-60000).toISOString()}];events=[{session_id:history[0].id,kind:'pitch_shown',event_key:'once',created_at:new Date(now-30000).toISOString()}];data=await(await post({code:'123457'})).json();assert.equal(data.webinar.title,'Saved VIP day','VIP never routes back to checkout at its offer');
account=null;vipPaid=false;owner=false;assert.equal((await post({preview:vip.id})).status,403);
const admin=await load('../app/api/webinar/intelligence/route.ts',common,'__retiredAdmin');assert.equal((await admin.GET()).status,403);owner=true;assert.deepEqual(await(await admin.GET()).json(),{enabled:false,retired:true});assert.equal((await admin.POST(new Request('https://example.test/api/webinar/intelligence',{method:'POST',body:'{"enabled":true}'}))).status,410);
// Use the real location adapter through the live entry and ad-return handlers.
const originalVercel=process.env.VERCEL;process.env.VERCEL='1';
try{
 const dallasHeaders={'x-vercel-ip-latitude':'32.7767','x-vercel-ip-longitude':'-96.797','x-vercel-ip-timezone':'America/Chicago'};
 const nyHeaders={'x-vercel-ip-latitude':'40.7128','x-vercel-ip-longitude':'-74.006','x-vercel-ip-timezone':'America/New_York'};
 now=Date.parse('2026-10-08T23:30:00Z');history=[];events=[];account=null;paid=false;
 one.nightEnabled=true;one.nightVersion={...createNightRecording(one),videoUrl:'https://example.test/main-night.mp4'};
 data=await(await post({code:'123456'},dallasHeaders)).json();assert.equal(data.webinar.recordingVersion,'day');
 calls=[];data=await(await post({code:'123456'},nyHeaders)).json();assert.equal(data.webinar.recordingVersion,'night');
 assert.ok(!JSON.stringify(calls).includes('40.7128'),'Coordinates are not saved in sessions or visitor records');
 const frozen={...calls.find(c=>c.path==='rpc/icash_webinar_begin').body.p_config,title:'Night already started'};
 history=[{...prior,id:randomUUID(),config:frozen,webinar_id:one.id,completed_at:null,max_seconds:100,watched_seconds:100,created_at:new Date(now-60000).toISOString(),updated_at:new Date(now-60000).toISOString()}];
 data=await(await post({code:'123456'},dallasHeaders)).json();assert.equal(data.webinar.title,'Night already started');assert.equal(data.webinar.recordingVersion,'night','Resume does not replace an existing recording');
 history=[{...prior,completed_at:new Date(now-9*3600000).toISOString(),watched_seconds:1700}];
 stats=[{webinarId:three.id,version:'day',viewers:100,cohortBuyers:30},{webinarId:three.id,version:'night',viewers:100,cohortBuyers:30}];
 data=await(await post({code:'123456',attribution:{ad_id:'55555'}},dallasHeaders)).json();assert.equal(data.webinar.id,three.id);assert.equal(data.webinar.recordingVersion,'day','Ad alternatives use the same daylight context');
 data=await(await post({code:'123456',attribution:{ad_id:'55555'}},nyHeaders)).json();assert.equal(data.webinar.id,three.id);assert.equal(data.webinar.recordingVersion,'night');
 history=[];vipPaid=true;vip.nightEnabled=true;vip.nightVersion.videoUrl='https://example.test/vip-night.mp4';
 data=await(await post({code:'123457'},dallasHeaders)).json();assert.equal(data.webinar.recordingVersion,'day');
 data=await(await post({code:'123457'},nyHeaders)).json();assert.equal(data.webinar.recordingVersion,'night','Paid VIP playback uses local daylight');
}finally{if(originalVercel===undefined)delete process.env.VERCEL;else process.env.VERCEL=originalVercel;}
console.log('PASS fixed routing: no experiments, stable acquisition attribution, same-webinar returns, paid VIP gate, local Day/Night fallback, saved VIP resume and retired controls.');
