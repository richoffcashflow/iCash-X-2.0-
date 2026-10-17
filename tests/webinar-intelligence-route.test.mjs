import {webinarViewerLocation} from '../lib/webinar-viewer-location.ts';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import * as policy from '../lib/webinar-policy.ts';
import {returnVisit,selectOffer,paidAdArrival,confirmedWatch,bestConvertingWebinar,stableWebinarOrder} from '../packages/webinar-engine/src/index.ts';
import {withOfferDeadlines} from '../packages/webinar-engine/src/offer-deadlines.ts';
import {timerResponseSchema} from '../lib/webinar-timers.ts';
import {selectRecording,createNightRecording} from '../lib/webinar-recordings.ts';
import {webinarLink} from '../lib/webinar-links.ts';
import {snapshotChat} from '../lib/webinar-variants.ts';
const one={...policy.newWebinar(randomUUID()),status:'published',videoUrl:'https://example.test/main.mp4',publicCode:'123456'};
const vip={...policy.newVipWebinar(randomUUID(),one),status:'published',videoUrl:'https://example.test/vip-day.mp4',publicCode:'123457',nightEnabled:true};vip.nightVersion={...createNightRecording(vip),videoUrl:'https://example.test/vip-night.mp4'};
const settings=policy.settingsSchema.parse({enabled:false,fromEmail:'',postalAddress:'',subjects:['a','b','c'],messages:['a','b','c'],optimizer:{enabled:true,explorationPercent:20,minVisitors:100}});
const two={...one,id:randomUUID(),publicCode:'123458',title:'Second'},three={...one,id:randomUUID(),publicCode:'123459',title:'Third',nightEnabled:true};three.nightVersion={...createNightRecording(three),videoUrl:'https://example.test/third-night.mp4'};
let pool=[one,vip,two,three],stats=[],failRouting=false;
let now=Date.parse('2026-10-07T18:00:00Z'),history=[],events=[],calls=[],owner=true,ownerLocked=false,account=null,paid=false,vipPaid=false,hasVip=false,missingVip=false;
class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
class WebinarError extends Error{constructor(status,message){super(message);this.status=status;}}
const visitor={id:randomUUID(),attribution:{ad_id:'77777'}};
const db=async(path,method,body)=>{
 calls.push({path,method,body});
 if(path.startsWith('icash_webinars?')){if(path.includes('limit=1000')&&failRouting)throw Error('Optional routing unavailable');const selected=path.includes('limit=1000')?pool:path.includes('123457')?[vip]:path.includes('123458')?[two]:[one];return selected.map(w=>({config:w,public_code:Number(w.publicCode),parent_webinar_id:w.parentWebinarId}));}
 if(path.startsWith('icash_webinar_sessions?'))return path.includes('&webinar_id=eq.')?history.filter(h=>path.includes('webinar_id=eq.'+h.webinar_id+'&')):history;
 if(path.startsWith('icash_webinar_events?'))return events;
 if(path.startsWith('icash_webinar_settings?'))return [{config:settings}];
 if(path==='rpc/icash_webinar_begin'){const prior=history.find(h=>h.webinar_id===body.p_config.id&&!h.completed_at&&!h.superseded_at&&h.is_preview===body.p_preview&&h.id!==body.p_advance_from&&now-Date.parse(h.updated_at)>=0&&now-Date.parse(h.updated_at)<3600000);const expired=history.find(h=>h.id===body.p_advance_from&&now-Date.parse(h.updated_at)>=3600000);const {_returnStartSeconds,...config}=body.p_config;return prior??{id:body.p_id,config,completed_at:null,progress_seconds:expired&&!body.p_preview&&!config.parentWebinarId?_returnStartSeconds??0:0};}
 if(path.startsWith('icash_webinar_messages?'))return [];
 if(path.includes('intelligence'))throw Error('Retired routing was called');
 return {};
};
async function load(path,deps,key){globalThis[key]=deps;const source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');return import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.'+key+';\n'+source).toString('base64'));}
const common={webinarViewerLocation,...policy,z,db,Date:Clock,webinarHeaders:{'Cache-Control':'private, no-store'},WebinarError,webinarBody:req=>req.json(),webinarOrigin:()=>{},webinarLimit:async()=>{},webinarOwner:async()=>{if(ownerLocked)throw Error('DASHBOARD_PASSWORD_REQUIRED');if(!owner)throw new WebinarError(403,'Owner only');},webinarError:e=>Response.json({error:e.message},{status:e.status||503})};
const returns=await load('../lib/webinar-ad-returns.ts',{...common,returnVisit,paidAdArrival,confirmedWatch,bestConvertingWebinar,stableWebinarOrder,selectRecording,availableWebinarRows:rows=>rows.map(policy.webinarFromRow),webinarConversionRecordings:async()=>stats},'__adReturns');
const offerServer=await load('../lib/webinar-offer-server.ts',{...common,timerResponseSchema,withOfferDeadlines},'__returnOffers');
const {POST}=await load('../app/api/webinar/start/route.ts',{...common,...returns,...offerServer,webinarLink,randomUUID,randomBytes,selectRecording:(w,t,_now,...rest)=>selectRecording(w,t,new Date(now),...rest),selectOffer,snapshotChat,returnVisit,approximateRegion:()=>null,webinarSite:{workspacePath:'/',checkoutPath:'/webinar/checkout'},webinarViewerMembership:async()=>vipPaid?{mode:'live',state:'active',paid_through:new Date(now+86400000).toISOString(),vip_until:hasVip?new Date(now+86400000).toISOString():null}:null,vipActive:m=>!!m?.vip_until,returningBuyerVip:async()=>missingVip?null:vip,webinarVisitor:async()=>visitor,webinarCustomerAccount:async()=>account,webinarPaid:async()=>false,webinarCustomerPaid:async()=>paid,validGuest:()=>true,guestHash:()=> 'guest',cookies:async()=>({get:()=>({value:'guest'}),set:()=>{}})},'__fixedRoute');
const post=(body,headers={})=>POST(new Request('https://example.test/api/webinar/start',{method:'POST',headers,body:JSON.stringify({timezone:'America/Chicago',...body})}));
let data=await(await post({attribution:{ad_id:'55555',email:'ignored@example.invalid'}})).json();
assert.equal(data.webinar.id,one.id);assert.ok(calls.some(c=>c.path==='rpc/icash_webinar_begin'));assert.ok(!calls.some(c=>c.path.includes('intelligence')),'Legacy enabled settings never assign experiments');assert.equal(calls.find(c=>c.method==='PATCH').body.attribution.email,undefined);
const saved={...one,title:'Saved main'};
history=[{id:randomUUID(),webinar_id:one.id,revision:1,progress_seconds:100,max_seconds:100,completed_at:null,superseded_at:null,is_preview:false,config:saved,created_at:new Date(now).toISOString(),updated_at:new Date(now).toISOString()}];
data=await(await post({code:'123456',attribution:{ad_id:'55555'}})).json();assert.equal(data.webinar.title,'Saved main');
const prior=history[0];
assert.equal(data.progress,100);assert.equal(data.sessionId,prior.id);
prior.progress_seconds=1550;prior.max_seconds=1550;events=[{session_id:prior.id,kind:'pitch_shown',event_key:'once',created_at:new Date(now-1800000).toISOString()}];prior.updated_at=new Date(now-3599999).toISOString();
data=await(await post({code:'123456',attribution:{ad_id:'55555'}})).json();assert.equal(data.sessionId,prior.id);assert.equal(data.progress,1550,'An offer already shown does not skip the rest of the video');
prior.updated_at=new Date(now-3600000).toISOString();calls=[];
data=await(await post({code:'123456',attribution:{ad_id:'55555'}})).json();assert.equal(data.webinar.id,one.id);assert.equal(data.progress,policy.webinarReturnPosition(one));assert.notEqual(data.sessionId,prior.id);assert.equal(calls.find(c=>c.path==='rpc/icash_webinar_begin').body.p_advance_from,prior.id);
prior.completed_at=new Date(now-9*3600000).toISOString();prior.watched_seconds=1700;prior.updated_at=prior.completed_at;
stats=[{webinarId:three.id,version:'day',viewers:100,cohortBuyers:40}];
data=await(await post({code:'123456',attribution:{ad_id:'55555'}})).json();assert.equal(data.webinar.id,one.id,'Even a tagged ad replays the same webinar after one hour');assert.equal(data.progress,policy.webinarReturnPosition(one));assert.equal(data.webinar._returnStartSeconds,undefined);
prior.completed_at=new Date(now-1800000).toISOString();prior.updated_at=prior.completed_at;prior.max_seconds=1800;
data=await(await post({code:'123456'})).json();assert.equal(data.redirect,`/webinar/checkout?webinar_session=${prior.id}`,'Recent completion retains the next step');
calls=[];data=await(await post({code:'123456',returnToWebinar:true})).json();assert.equal(data.webinar.id,one.id);assert.equal(data.progress,0);
// A replay invitation does not erase an unfinished session inside the hour.
prior.completed_at=null;prior.progress_seconds=500;prior.max_seconds=500;
data=await(await post({code:'123456',returnToWebinar:true})).json();assert.equal(data.progress,500);
history=[];calls=[];data=await(await post({code:'123457'})).json();assert.equal(data.redirect,'/webinar/checkout');assert.ok(!calls.some(c=>c.path.includes('begin')),'A VIP link is not proof of payment');
account={id:randomUUID(),destination:'/',needsBudget:true};data=await(await post({code:'123457'})).json();assert.equal(data.redirect,'/webinar/checkout','A free account alone cannot unlock VIP');
vipPaid=true;data=await(await post({code:'123457'})).json();assert.equal(data.webinar.videoUrl,vip.videoUrl,'Paid buyers with no budget can watch VIP');
const oldVip={...prior,id:randomUUID(),webinar_id:vip.id,config:vip,progress_seconds:900,max_seconds:900,completed_at:null,updated_at:new Date(now-1000).toISOString()};history=[oldVip];calls=[];
data=await(await post({code:'123456',attribution:{ad_id:'55555'}})).json();assert.equal(data.webinar.id,vip.id);assert.equal(data.progress,0);assert.equal(data.canonicalPath,'/live/123457');assert.notEqual(data.sessionId,oldVip.id);assert.equal(calls.find(c=>c.path==='rpc/icash_webinar_begin').body.p_advance_from,oldVip.id);
data=await(await post({code:'123457'})).json();assert.equal(data.progress,900,'Direct VIP returns retain normal resume behavior');
oldVip.completed_at=new Date(now-1000).toISOString();data=await(await post({code:'123457'})).json();assert.equal(data.redirect,'/webinar/upgrade','Recent VIP completion retains its upgrade next step');oldVip.completed_at=null;

account=null;data=await(await post({code:'123456'})).json();assert.equal(data.webinar.id,vip.id,'Verified guest buyers also start VIP through a main link without ad tags');assert.equal(data.progress,0);
hasVip=true;calls=[];data=await(await post({code:'123456'})).json();assert.equal(data.redirect,'/');data=await(await post({code:'123457'})).json();assert.equal(data.redirect,'/');assert.ok(!calls.some(c=>c.path==='rpc/icash_webinar_begin'));hasVip=false;
missingVip=true;data=await(await post({code:'123456'})).json();assert.equal(data.redirect,'/webinar/upgrade');missingVip=false;history=[];

now=Date.parse('2026-10-08T03:00:00Z');data=await(await post({code:'123457'})).json();assert.equal(data.webinar.videoUrl,vip.nightVersion.videoUrl);assert.equal(data.webinar.recordingVersion,'night');
vip.nightVersion.videoUrl='';vip.nightEnabled=false;data=await(await post({code:'123457'})).json();assert.equal(data.webinar.videoUrl,vip.videoUrl,'Day safely covers nighttime without a published Night');
const vipSaved={...vip,title:'Saved VIP day',nightVersion:null,nightEnabled:false,recordingVersion:'day'};
history=[{id:randomUUID(),webinar_id:vip.id,revision:1,progress_seconds:1550,max_seconds:1550,completed_at:null,superseded_at:null,is_preview:false,config:vipSaved,created_at:new Date(now-60000).toISOString(),updated_at:new Date(now-60000).toISOString()}];events=[{session_id:history[0].id,kind:'pitch_shown',event_key:'once',created_at:new Date(now-30000).toISOString()}];data=await(await post({code:'123457'})).json();assert.equal(data.webinar.title,'Saved VIP day','VIP never routes back to checkout at its offer');
account=null;vipPaid=false;owner=false;calls=[];const locked=await(await post({preview:vip.id})).json();assert.equal(locked.previewLocked,true);assert.equal(locked.webinar,undefined);assert.ok(!calls.some(c=>c.path==='rpc/icash_webinar_begin'),'Locked previews never start a session');
const admin=await load('../app/api/webinar/intelligence/route.ts',common,'__retiredAdmin');assert.equal((await admin.GET()).status,403);owner=true;assert.deepEqual(await(await admin.GET()).json(),{enabled:false,retired:true});assert.equal((await admin.POST(new Request('https://example.test/api/webinar/intelligence',{method:'POST',body:'{"enabled":true}'}))).status,410);
// Use the real location adapter through the live entry and ad-return handlers.
const originalVercel=process.env.VERCEL;process.env.VERCEL='1';
try{
 const dallasHeaders={'x-vercel-ip-latitude':'32.7767','x-vercel-ip-longitude':'-96.797','x-vercel-ip-timezone':'America/Chicago'};
 const nyHeaders={'x-vercel-ip-latitude':'40.7128','x-vercel-ip-longitude':'-74.006','x-vercel-ip-timezone':'America/New_York'};
 now=Date.parse('2026-10-08T23:30:00Z');history=[];events=[];account=null;paid=false;vipPaid=false;
 one.nightEnabled=true;one.nightVersion={...createNightRecording(one),videoUrl:'https://example.test/main-night.mp4',offers:policy.webinarOffers(one).map(o=>({...o,at:o.at+120}))};
 data=await(await post({code:'123456'},dallasHeaders)).json();assert.equal(data.webinar.recordingVersion,'day');
 calls=[];data=await(await post({code:'123456'},nyHeaders)).json();assert.equal(data.webinar.recordingVersion,'night');
 assert.ok(!JSON.stringify(calls).includes('40.7128'),'Coordinates are not saved in sessions or visitor records');
 const frozen={...calls.find(c=>c.path==='rpc/icash_webinar_begin').body.p_config,title:'Night already started'};
 history=[{...prior,id:randomUUID(),config:frozen,webinar_id:one.id,completed_at:null,max_seconds:100,watched_seconds:100,created_at:new Date(now-60000).toISOString(),updated_at:new Date(now-60000).toISOString()}];
 data=await(await post({code:'123456'},dallasHeaders)).json();assert.equal(data.webinar.title,'Night already started');assert.equal(data.webinar.recordingVersion,'night','Resume does not replace an existing recording');
 history=[{...prior,completed_at:new Date(now-9*3600000).toISOString(),watched_seconds:1700}];
 stats=[{webinarId:three.id,version:'day',viewers:100,cohortBuyers:30},{webinarId:three.id,version:'night',viewers:100,cohortBuyers:30}];
 data=await(await post({code:'123456',attribution:{ad_id:'55555'}},dallasHeaders)).json();assert.equal(data.webinar.id,one.id);assert.equal(data.webinar.recordingVersion,'day','A restarted main uses the viewer daylight context');
 data=await(await post({code:'123456',attribution:{ad_id:'55555'}},nyHeaders)).json();assert.equal(data.webinar.id,one.id);assert.equal(data.webinar.recordingVersion,'night');assert.equal(data.progress,policy.webinarReturnPosition(selectRecording(one,'America/New_York',new Date(now),settings.routing)));assert.equal(data.progress,policy.webinarReturnPosition(one)+120,'Return offset follows the selected Night offer timing');
 history=[];vipPaid=true;vip.nightEnabled=true;vip.nightVersion.videoUrl='https://example.test/vip-night.mp4';
 data=await(await post({code:'123457'},dallasHeaders)).json();assert.equal(data.webinar.recordingVersion,'day');
 data=await(await post({code:'123457'},nyHeaders)).json();assert.equal(data.webinar.recordingVersion,'night','Paid VIP playback uses local daylight');
}finally{if(originalVercel===undefined)delete process.env.VERCEL;else process.env.VERCEL=originalVercel;}
console.log('PASS fixed routing: no experiments, stable acquisition attribution, same-webinar returns, paid VIP gate, local Day/Night fallback, saved VIP resume and retired controls.');

// Matching VIP stays attached to the watched main recording across time changes.
vipPaid=true;account=null;events=[];now=Date.parse('2026-10-08T03:00:00Z');
history=[{id:randomUUID(),webinar_id:one.id,is_preview:false,config:{...one,recordingVersion:'day'},created_at:new Date(now-3600000).toISOString()}];
data=await(await post({code:'123457'})).json();assert.equal(data.webinar.recordingVersion,'day');assert.equal(data.webinar.videoUrl,vip.videoUrl);
now=Date.parse('2026-10-08T18:00:00Z');history[0].config.recordingVersion='night';
data=await(await post({code:'123457'})).json();assert.equal(data.webinar.recordingVersion,'night');assert.equal(data.webinar.videoUrl,vip.nightVersion.videoUrl);
const savedNight=vip.nightVersion;vip.nightVersion={...savedNight,videoUrl:''};
data=await(await post({code:'123457'})).json();assert.equal(data.webinar.recordingVersion,'day');assert.equal(data.webinar.videoUrl,vip.videoUrl);vip.nightVersion=savedNight;
console.log('PASS matching VIP follows watched Day/Night through clock changes, with empty Night VIP fallback.');
vip.videoUrl='';history[0].config.recordingVersion='day';
data=await(await post({code:'123457'})).json();assert.equal(data.webinar.recordingVersion,'night');assert.equal(data.webinar.videoUrl,vip.nightVersion.videoUrl,'Nighttime-only VIP also covers a Daytime buyer');

// Only the authenticated owner can stay in the published funnel while already paid.
const savedOwnerVideo=one.videoUrl;vip.videoUrl='https://example.test/vip-day.mp4';
account={id:randomUUID(),destination:'/',needsBudget:false,isOwner:true};paid=true;vipPaid=true;hasVip=true;history=[];calls=[];
for(const [code,expected] of [['123456',one],['123457',vip]]){
 data=await(await post({code})).json();
 assert.equal(data.webinar.id,expected.id);assert.equal(data.ownerWatching,true);assert.equal(data.preview,false);assert.equal(data.redirect,undefined);assert.equal(data.canonicalPath,undefined);
 assert.equal(calls.filter(c=>c.path==='rpc/icash_webinar_begin').at(-1).body.p_preview,false,'Owner public visits remain eligible for consented pixel measurement');
}
history=[{...prior,webinar_id:one.id,config:one,completed_at:new Date(now-1000).toISOString(),updated_at:new Date(now-1000).toISOString()}];
data=await(await post({code:'123456'})).json();assert.equal(data.progress,0);assert.equal(data.redirect,undefined,'A finished owner visit restarts instead of opening checkout');
history[0].updated_at=new Date(now-2*3600000).toISOString();
data=await(await post({code:'123456'})).json();assert.equal(data.progress,0,'Expired owner visits restart from the beginning');
history[0].completed_at=null;history[0].progress_seconds=500;history[0].updated_at=new Date(now-1000).toISOString();
data=await(await post({code:'123456'})).json();assert.equal(data.progress,500,'Recent unfinished owner sessions still resume');
// Owner public tests follow the current recording when Day/Night changes.
const ownerClock=now;
for(const [from,to] of [['day','night'],['night','day']]){
 now=Date.parse(to==='night'?'2026-10-17T01:07:13Z':'2026-10-17T18:00:00Z');
 const frozen=selectRecording(one,'America/Chicago',new Date(now),settings.routing,from);
 const old={...prior,id:randomUUID(),config:frozen,completed_at:null,progress_seconds:39,max_seconds:39,created_at:new Date(now-3*3600000).toISOString(),updated_at:new Date(now-1000).toISOString()};
 history=[old];calls=[];
 data=await(await post({code:'123456'})).json();
 assert.equal(data.webinar.recordingVersion,to);assert.equal(data.progress,0);assert.notEqual(data.sessionId,old.id);
 const begin=calls.find(c=>c.path==='rpc/icash_webinar_begin').body;
 assert.equal(begin.p_advance_from,old.id);assert.equal(begin.p_preview,false);assert.equal(begin.p_config._returnStartSeconds,undefined);
 history=[{...old,id:data.sessionId,config:begin.p_config,progress_seconds:25,max_seconds:25,created_at:new Date(now).toISOString()}];
 data=await(await post({code:'123456'})).json();assert.equal(data.sessionId,history[0].id);assert.equal(data.progress,25,'Refreshing the correct owner recording resumes normally');
 // The same saved customer recording keeps its position across sunset/sunrise.
 account=null;paid=false;vipPaid=false;hasVip=false;history=[old];
 data=await(await post({code:'123456'})).json();assert.equal(data.sessionId,old.id);assert.equal(data.webinar.recordingVersion,from);assert.equal(data.progress,39);
 account={id:randomUUID(),destination:'/',needsBudget:false,isOwner:true};paid=true;vipPaid=true;hasVip=true;
}
now=ownerClock;
console.log('PASS owner Day/Night changes start the current recording at zero; same-period refreshes and customer resumes retain their position.');
one.status='draft';data=await(await post({code:'123456'})).json();assert.equal(data.unavailable,true,'Public owner watching cannot expose drafts');one.status='published';
account.isOwner=false;history=[];
data=await(await post({code:'123456'})).json();assert.equal(data.redirect,'/','A normal VIP member keeps the workspace destination');
assert.equal((await post({code:'123456',ownerWatching:true})).status,400,'Request fields cannot claim owner status');
account=null;paid=false;vipPaid=false;hasVip=false;one.videoUrl=savedOwnerVideo;
console.log('PASS owner public replay: signed identity, pixel-eligible sessions, main/VIP entry, completion/expiry replay, draft protection and unchanged customer routing.');

// Owner preview has no ad/checkout return journey and does not read offer history.
owner=true;history=[];calls=[];
data=await(await post({preview:one.id,variant:'night'})).json();
assert.equal(data.preview,true);assert.equal(data.webinar.recordingVersion,'night');
assert.ok(!calls.some(c=>c.path.startsWith('icash_webinar_events?')));
console.log('PASS fast entry: owner authorization retained and preview skips unused offer history.');

ownerLocked=true;calls=[];data=await(await post({preview:one.id})).json();
assert.equal(data.previewLocked,true);assert.equal(data.webinar,undefined);assert.ok(!calls.some(c=>c.path==='rpc/icash_webinar_begin'));
ownerLocked=false;
console.log('PASS expired owner proof returns a locked preview without creating a session.');
