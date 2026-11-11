import assert from 'node:assert/strict';
import {z} from 'zod';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {eventNames,newWebinar,webinarCompletionDestination} from '../lib/webinar-policy.ts';
import {availableOffers} from '../packages/webinar-engine/src/index.ts';
import {withOfferDeadlines} from '../packages/webinar-engine/src/offer-deadlines.ts';

const id='00000000-0000-4000-8000-000000000001';
const sessionId='00000000-0000-4000-8000-000000000002';
const startedAt=Date.parse('2026-11-11T15:00:00Z');
const originalNow=Date.now;
let clock=startedAt,saveFails=false,owned=true,preview=false,session,offers,deadlines,calls=[];
class WebinarError extends Error{constructor(status,message){super(message);this.status=status;}}
const route=await loadService('app/api/webinar/event/route.ts',{
 z,eventNames,webinarCompletionDestination,availableOffers,WebinarError,
 webinarOrigin:()=>{},webinarBody:req=>req.json(),webinarHeaders:{'Cache-Control':'private, no-store'},webinarLimit:async()=>{},
 webinarError:e=>Response.json({error:e.message},{status:e.status??503}),
 webinarSession:async()=>{if(!owned)throw new WebinarError(404,'Session not found');return {v:{id:'viewer'},s:{...session,is_preview:preview}};},
 sessionWebinarOffers:async()=>withOfferDeadlines(offers,deadlines),
 db:async(path,method,body)=>{calls.push({path,method,body});if(saveFails)throw Error('Save unavailable');},
});
const post=(patch={})=>route.POST(new Request('https://example.invalid/api/webinar/event',{method:'POST',body:JSON.stringify({sessionId,seconds:session.config.durationSeconds,kind:'completed',key:'once',...patch})}));
const makeOffer=(id,at,durationSeconds,extra={})=>({id,at,durationSeconds,expiresAt:null,title:'Offer',description:'',ctaLabel:'Review',action:'checkout',url:'',...extra});
try{
 Date.now=()=>clock;
 for(const c of [{version:'day',duration:1308,first:1023,last:1235,seconds:60},{version:'night',duration:1657,first:1355,last:1595,seconds:59}]){
  session={id:sessionId,config:{...newWebinar(id),durationSeconds:c.duration,recordingVersion:c.version,endOfferId:c.version==='night'?'first':null}};
  offers=[makeOffer('first',c.first,120),makeOffer('last',c.last,c.seconds)];
  deadlines=Object.fromEntries(offers.map(o=>[o.id,new Date(startedAt+(o.at+o.durationSeconds)*1000).toISOString()]));
  clock=startedAt+c.duration*1000;
  const before=JSON.stringify({offers,deadlines});
  assert.equal(availableOffers(withOfferDeadlines(offers,deadlines),c.duration).length,0);
  let response=await post(),data=await response.json();assert.equal(response.status,200);assert.equal(data.saved,true);assert.equal(data.redirect,'/webinar/checkout?webinar_session='+sessionId);
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  assert.equal((await(await post()).json()).redirect,data.redirect,'Completion retry keeps the same checkout session');
  assert.equal(JSON.stringify({offers,deadlines}),before,'Completion must not reset the original deadlines');
  assert.equal((await(await post({seconds:c.duration-6})).json()).redirect,undefined,'Early completion cannot redirect');
  assert.equal((await(await post({kind:'progress'})).json()).redirect,undefined);
  preview=true;assert.equal((await(await post()).json()).redirect,undefined,'Preview requests never open live checkout');preview=false;
  session.config.redirectAtEnd=false;assert.equal((await(await post()).json()).redirect,undefined);session.config.redirectAtEnd=true;
  session.config.parentWebinarId=id;assert.equal((await(await post()).json()).redirect,'/webinar/upgrade');session.config.parentWebinarId=null;
 }
 session.config.endOfferId='external';
 offers=[makeOffer('external',100,30,{action:'link',url:'https://example.invalid/custom-product'})];
 deadlines={external:new Date(clock-1000).toISOString()};
 assert.equal((await(await post()).json()).redirect,undefined,'An expired custom product never becomes a membership sale');
 deadlines={external:new Date(clock+1000).toISOString()};
 assert.equal((await(await post()).json()).redirect,'https://example.invalid/custom-product');
 offers=[makeOffer('future',session.config.durationSeconds+1,30)];deadlines={};session.config.endOfferId=null;
 assert.equal((await(await post()).json()).redirect,undefined,'An unreached offer is not an ending offer');
 offers=[];assert.equal((await(await post()).json()).redirect,undefined);
 owned=false;calls=[];assert.equal((await post()).status,404);assert.equal(calls.length,0);owned=true;
 saveFails=true;assert.equal((await post()).status,503,'No successful handoff before the completion write succeeds');
}finally{Date.now=originalNow;}
console.log('PASS real completion route: expired Day/Night offers reach ordinary checkout, stable retries, saved deadlines, preview, VIP, early-event and custom-product boundaries.');
