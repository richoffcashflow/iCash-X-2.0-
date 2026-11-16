import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {loadService} from './helpers/simulated-journey-services.mjs';
import * as policy from '../lib/webinar-policy.ts';
import {selectRecording,recordingRecheckAt} from '../lib/webinar-recordings.ts';
import {selectOffer,returnVisit,withinWebinarResumeWindow} from '../packages/webinar-engine/src/index.ts';
import {snapshotChat} from '../lib/webinar-variants.ts';
import {webinarLink} from '../lib/webinar-links.ts';

const now=Date.now(),id=randomUUID(),visitor={id:randomUUID(),name:'Viewer'};
const current={...policy.newWebinar(id),status:'published',publicCode:'123456',videoUrl:'https://example.invalid/recording.mp4'};
const settings=policy.settingsSchema.parse({enabled:false,fromEmail:'',postalAddress:'',subjects:['a','b','c'],messages:['a','b','c']});
let rows=[],events=[],calls=[],slowChat=false,authorizationFailure=false,ownerChecks=0,reuseSession=false;
class WebinarError extends Error{constructor(status,message){super(message);this.status=status;}}
const queryRows=(input,query)=>{
 let rows=input.filter(row=>[...query].every(([key,value])=>{
  if(value.startsWith('eq.'))return String(row[key])===value.slice(3);
  if(value==='is.null')return row[key]==null;
  if(value==='like.offer:*')return row[key]?.startsWith('offer:');
  return true;
 }));
 rows.sort((a,b)=>b.created_at.localeCompare(a.created_at)||(b.updated_at??'').localeCompare(a.updated_at??''));
 if(query.has('limit'))rows=rows.slice(0,Number(query.get('limit')));
 return rows;
};
const db=async(path,method='GET',body,signal)=>{
 calls.push({path,method,body,signal});
 if(path.startsWith('icash_webinars?'))return [{config:current,public_code:123456}];
 if(path.startsWith('icash_webinar_settings?'))return [{config:settings}];
 if(path.startsWith('icash_webinar_sessions?'))return queryRows(rows,new URLSearchParams(path.split('?')[1]));
 if(path.startsWith('icash_webinar_events?'))return queryRows(events,new URLSearchParams(path.split('?')[1]));
 if(path==='rpc/icash_webinar_begin')return {id:reuseSession?'concurrent-session':body.p_id,config:body.p_config,completed_at:null,progress_seconds:0};
 if(path.startsWith('icash_webinar_messages?')){
  if(slowChat)await new Promise((_resolve,reject)=>signal?.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  return [];
 }
 return {};
};
const {POST}=await loadService('app/api/webinar/start/route.ts',{
 ...policy,z,randomBytes,randomUUID,db,selectRecording,recordingRecheckAt,snapshotChat,webinarLink,withinWebinarResumeWindow,selectOffer,
 webinarSite:{workspacePath:'/',checkoutPath:'/webinar/checkout'},WebinarError,webinarHeaders:{'Cache-Control':'private, no-store'},
 webinarOrigin(){},webinarBody:r=>r.json(),webinarLimit:async()=>{},webinarOwner:async()=>{ownerChecks++;},
 webinarEntryVisitor:async()=>({visitor,created:false}),webinarCustomerAccount:async()=>null,webinarViewerMembership:async()=>{if(authorizationFailure)throw Error('Membership check unavailable');return null;},
 vipActive:()=>false,webinarPaid:async()=>false,webinarCustomerPaid:async()=>false,
 webinarViewerLocation:()=>null,approximateRegion:()=>null,validGuest:()=>true,guestHash:()=> 'guest',
 cookies:async()=>({get:()=>({value:'guest'}),set(){}}),
 webinarReturnJourney:(history,_offers,timezone,hours,now)=>returnVisit(history,timezone,hours,now),
 sessionWebinarOffers:async session=>policy.webinarOffers(session.config),
 webinarError:e=>Response.json({error:e.message},{status:e.status??503}),
});
const post=async(body={})=>POST(new Request('https://example.invalid/api/webinar/start',{method:'POST',body:JSON.stringify({timezone:'America/Chicago',code:'123456',...body})}));
const session=(patch={})=>({id:randomUUID(),visitor_id:visitor.id,webinar_id:id,is_preview:false,superseded_at:null,created_at:new Date(now-60000).toISOString(),updated_at:new Date(now-1000).toISOString(),completed_at:null,progress_seconds:100,max_seconds:100,config:{...current,title:'Saved recording'},...patch});

const saved=session();
rows=[saved,...Array.from({length:120},(_,i)=>session({superseded_at:new Date(now).toISOString(),created_at:new Date(now-i).toISOString()}))];
let response=await post(),data=await response.json();
assert.equal(response.status,200);assert.equal(data.webinar.title,'Saved recording','Superseded rows must be excluded before pagination can hide the resumable snapshot');
const historyQuery=new URLSearchParams(calls.find(c=>c.path.startsWith('icash_webinar_sessions?')).path.split('?')[1]);
assert.equal(historyQuery.get('limit'),'1','Entry fetches one full snapshot instead of 100 video/chat/transcript snapshots');
assert.equal(historyQuery.get('superseded_at'),'is.null');assert.equal(historyQuery.get('order'),'created_at.desc,updated_at.desc');
assert.ok(!calls.some(c=>c.path.startsWith('icash_webinar_events?')),'Unfinished playback does not fetch offer history');

rows=[];calls=[];data=await(await post()).json();assert.equal(data.webinar.title,current.title);
assert.ok(!calls.some(c=>c.path.startsWith('icash_webinar_events?')),'New viewers do not fetch unrelated offer history');
rows=[session({completed_at:new Date(now-1000).toISOString(),max_seconds:current.durationSeconds,config:{...current,offers:[{id:'expired-checkout',at:100,title:'Get access',description:'',ctaLabel:'Join',action:'checkout',url:'',expiresAt:new Date(now-10000).toISOString()}]}})];
calls=[];data=await(await post()).json();
assert.equal(data.redirect,`/webinar/checkout?webinar_session=${rows[0].id}`,'Completed returning viewers retain checkout after the in-player offer expires');
assert.ok(!calls.some(c=>c.path==='rpc/icash_webinar_begin'),'Checkout does not restart the video or reset its saved deadline');
const eventQuery=new URLSearchParams(calls.find(c=>c.path.startsWith('icash_webinar_events?')).path.split('?')[1]);
assert.equal(eventQuery.get('session_id'),'eq.'+rows[0].id);assert.equal(eventQuery.get('visitor_id'),'eq.'+visitor.id);
assert.equal(eventQuery.get('kind'),'eq.checkout_opened');assert.equal(eventQuery.get('limit'),'1');
rows[0].config.offers[0]={...rows[0].config.offers[0],action:'link',url:'https://example.invalid/custom-product'};
data=await(await post()).json();assert.equal(data.redirect,undefined,'An expired custom product never becomes ordinary membership checkout');

rows=[];calls=[];slowChat=true;reuseSession=true;
let guard;const started=Date.now();
try{response=await Promise.race([post(),new Promise((_resolve,reject)=>{guard=setTimeout(()=>reject(Error('Optional chat blocked startup')),2400);})]);}
finally{clearTimeout(guard);}
data=await response.json();assert.equal(response.status,200);assert.ok(data.sessionId);assert.deepEqual(data.messages,[]);
assert.ok(Date.now()-started<2200,'An unavailable optional chat history does not consume the 15-second database timeout');
assert.equal(calls.find(c=>c.path.startsWith('icash_webinar_messages?')).signal.aborted,true,'The timed-out optional read is canceled');
slowChat=false;authorizationFailure=true;calls=[];response=await post();assert.equal(response.status,503);
assert.ok(!calls.some(c=>c.path==='rpc/icash_webinar_begin'),'Required membership checks still fail closed');
authorizationFailure=false;calls=[];data=await(await post({preview:id})).json();assert.equal(data.preview,true);assert.equal(ownerChecks,1);
assert.ok(!calls.some(c=>c.path.startsWith('icash_webinar_sessions?')||c.path.startsWith('icash_webinar_events?')),'Authorized previews skip unused history');
console.log('PASS bounded webinar startup: latest eligible snapshot, no unrelated offer history, expired checkout continuation, custom links, optional chat cancellation and required access checks.');
