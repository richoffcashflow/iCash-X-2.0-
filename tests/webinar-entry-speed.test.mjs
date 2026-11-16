import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {loadService} from './helpers/simulated-journey-services.mjs';
import * as policy from '../lib/webinar-policy.ts';
import {readWebinarToken,signWebinarToken} from '../lib/webinar-token.ts';
import {selectRecording,recordingRecheckAt} from '../lib/webinar-recordings.ts';
import {selectOffer,returnVisit,withinWebinarResumeWindow} from '../packages/webinar-engine/src/index.ts';
import {snapshotChat} from '../lib/webinar-variants.ts';
import {webinarLink} from '../lib/webinar-links.ts';
import {prepareWebinarEntry} from '../lib/webinar-entry.ts';

// Actual entry/visitor service bodies, isolated cookies and database. No providers.
process.env.ICASH_WEBINAR_SECRET='entry-speed-fixture-only';
const id=randomUUID(),config={...policy.newWebinar(id),status:'published',publicCode:'123456',videoUrl:'https://example.invalid/video.mp4'};
const settings=policy.settingsSchema.parse({enabled:false,fromEmail:'',postalAddress:'',subjects:['a','b','c'],messages:['a','b','c']});
const jar=new Map(),visitors=new Map();let calls=[],paidGuest=false,guestChecks=0,membershipFailure=false,reuse=false;
const cookies=async()=>({get:key=>jar.has(key)?{value:jar.get(key)}:undefined,set:(key,value)=>jar.set(key,value)});
const db=async(path,method='GET',body)=>{
 calls.push({path,method,body});
 if(path.startsWith('icash_webinars?'))return [{config,public_code:123456}];
 if(path.startsWith('icash_webinar_settings?'))return [{config:settings}];
 if(path==='icash_webinar_visitors'&&method==='POST'){
  const visitor={name:null,email:null,phone:null,funded_at:null,account_id:null,...body};visitors.set(body.id,visitor);return [{...visitor}];
 }
 if(path.startsWith('icash_webinar_visitors?')){
  const key=new URLSearchParams(path.split('?')[1]).get('id').slice(3),visitor=visitors.get(key);
  if(method==='PATCH'){Object.assign(visitor,body);return [{...visitor}];}
  return visitor?[{...visitor}]:[];
 }
 if(path.startsWith('icash_webinar_sessions?'))return [];
 if(path==='rpc/icash_webinar_begin')return {id:reuse?'reused-session':body.p_id,config:body.p_config,completed_at:null,progress_seconds:0};
 if(path.startsWith('icash_webinar_messages?'))return [{id:'saved-message',role:'user',text:'My earlier question'}];
 if(path.startsWith('icash_funding_orders?')||path.startsWith('icash_memberships?'))return [];
 throw Error('Unexpected entry work: '+path);
};
const visitorService=await loadService('lib/webinar-server.ts',{cookies,db,randomUUID,readWebinarToken,signWebinarToken});
const {POST}=await loadService('app/api/webinar/start/route.ts',{
 ...policy,...visitorService,z,randomBytes,randomUUID,db,cookies,selectRecording,recordingRecheckAt,snapshotChat,webinarLink,withinWebinarResumeWindow,selectOffer,
 webinarSite:{workspacePath:'/',checkoutPath:'/webinar/checkout'},webinarOrigin(){},webinarBody:r=>r.json(),webinarLimit:async()=>{},
 webinarCustomerAccount:async()=>null,webinarViewerMembership:async()=>{if(membershipFailure)throw Error('Access unavailable');return null;},vipActive:()=>false,
 webinarCustomerPaid:async()=>{guestChecks++;return paidGuest;},webinarViewerLocation:()=>null,approximateRegion:()=>null,
 validGuest:value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),guestHash:value=>'hash:'+value,
 webinarReturnJourney:(history,_offers,timezone,hours,now)=>returnVisit(history,timezone,hours,now),
});
const start=async(extra={})=>POST(new Request('https://example.invalid/api/webinar/start',{method:'POST',body:JSON.stringify({timezone:'America/Chicago',code:'123456',attribution:{utm_source:'fixture'},...extra})}));
let response=await start(),result=await response.json();
assert.equal(response.status,200);assert.ok(result.sessionId);assert.deepEqual(result.messages,[]);
assert.equal(guestChecks,0,'A freshly generated token has no prior purchase to fetch');
assert.ok(!calls.some(c=>c.path.startsWith('icash_funding_orders?')||c.path.startsWith('icash_memberships?')),'The newly saved random funding token does not trigger redundant visitor payment lookups');
assert.ok(!calls.some(c=>c.path.startsWith('icash_webinar_sessions?')||c.path.startsWith('icash_webinar_messages?')||c.method==='PATCH'),'Fresh viewers skip empty history/chat and the redundant metadata write');
const insert=calls.find(c=>c.path==='icash_webinar_visitors').body;
assert.equal(insert.timezone,'America/Chicago');assert.equal(insert.funding_guest_hash,'hash:'+jar.get('icash_funding_guest'));assert.deepEqual(insert.attribution,{utm_source:'fixture'});assert.ok(insert.last_seen_at);
assert.equal(readWebinarToken(jar.get('icash_webinar'),'visitor',process.env.ICASH_WEBINAR_SECRET),insert.id);

calls=[];reuse=true;result=await(await start()).json();
assert.equal(result.sessionId,'reused-session');assert.equal(result.messages[0].id,'saved-message');assert.equal(guestChecks,1);
assert.ok(calls.some(c=>c.path.startsWith('icash_webinar_sessions?')));assert.equal(calls.filter(c=>c.method==='PATCH').length,1,'Existing visitors still update current metadata');
assert.ok(!calls.some(c=>c.path==='icash_webinar_visitors'));

jar.delete('icash_webinar');calls=[];paidGuest=true;result=await(await start()).json();
assert.equal(result.redirect,'/');assert.equal(guestChecks,2,'A new visitor with an existing guest cookie still needs its purchase check');
assert.ok(!calls.some(c=>c.path==='rpc/icash_webinar_begin'));
paidGuest=false;jar.clear();calls=[];membershipFailure=true;
assert.equal((await start()).status,503);assert.ok(!calls.some(c=>c.method!=='GET'),'Failed required access checks cannot create a visitor or session');membershipFailure=false;

// A signed resume retains the old identity and checks its original funding link.
jar.clear();calls=[];
const saved={id:randomUUID(),name:'Returning viewer',email:null,phone:null,funding_guest_hash:'original-guest',account_id:null,funded_at:null};visitors.set(saved.id,saved);
const resume=signWebinarToken(saved.id,'resume',600,process.env.ICASH_WEBINAR_SECRET);
result=await(await start({resume})).json();assert.equal(result.name,saved.name);
assert.ok(calls.some(c=>c.path.includes('guest_hash=eq.original-guest')),'A new browser token must not erase earlier visitor payment evidence');
assert.ok(!calls.some(c=>c.path==='icash_webinar_visitors'));

// Entry and room share a pending request, including delayed and failed responses.
globalThis.location={search:'?r=resume-token&watch=1&preview=preview-id&variant=night&utm_source=fixture&fbclid=click'};
let fetches=0,release,requestBody;
globalThis.fetch=async(_url,init)=>{fetches++;requestBody=JSON.parse(init.body);await new Promise(resolve=>{release=resolve;});return Response.json({sessionId:'same-session'});};
const entry=prepareWebinarEntry('123456'),first=entry(),second=entry();assert.equal(first,second);assert.equal(fetches,1);
assert.equal(requestBody.resume,'resume-token');assert.equal(requestBody.returnToWebinar,true);assert.equal(requestBody.preview,'preview-id');assert.equal(requestBody.variant,'night');assert.equal(requestBody.attribution.fbclid,'click');
release();assert.equal((await second).data.sessionId,'same-session');assert.equal((await entry()).data.sessionId,'same-session');assert.equal(fetches,1);
globalThis.fetch=async()=>{fetches++;throw Error('Offline fixture');};
const failed=prepareWebinarEntry('123457');assert.match((await failed()).error.message,/Offline fixture/);await failed();assert.equal(fetches,2,'Failure is displayed once and never automatically replays the startup write');
console.log('PASS faster entry: atomic visitor metadata, empty-work skips, fresh-token boundary, saved/concurrent chat, paid guest and signed-resume checks, required access failure, and one shared pending/failed browser request.');
