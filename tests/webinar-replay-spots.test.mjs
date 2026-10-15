import test from 'node:test';
import assert from 'node:assert/strict';
import {replayOfferSpots,replayOfferActivity} from '../packages/webinar-engine/src/replay-offer-spots.ts';
import {webinarOfferSchema,newWebinar,webinarSchema,publicWebinar} from '../lib/webinar-policy.ts';
import {createNightRecording,editingRecording,patchRecording} from '../lib/webinar-recordings.ts';
import {selectOffer} from '../packages/webinar-engine/src/index.ts';
const first={id:'first',at:10,replaySpots:10};
const second={id:'second',at:30,replaySpots:5};
const cue=(at,name,kind='purchase')=>({at,name,kind});
const cues=[cue(5,'Before'),cue(12,'David','replay'),cue(15,'David'),cue(17,'  DAVID  '),cue(19,'Sarah','ai'),cue(20,'Sarah'),cue(30,'David'),cue(31,'Next buyer')];

test('only a purchase label decrements replay spots, once per buyer within the offer',()=>{
 assert.equal(replayOfferSpots(first,[first,second],cues,9),null);
 assert.deepEqual(replayOfferSpots(first,[first,second],cues,10),{total:10,remaining:10});
 assert.equal(replayOfferSpots(first,[first,second],cues,12).remaining,10,'An I’m in message is not a purchase');
 assert.equal(replayOfferSpots(first,[first,second],cues,15).remaining,9);
 assert.equal(replayOfferSpots(first,[first,second],cues,19).remaining,9,'Duplicate names and assistant cues do not count');
 assert.equal(replayOfferSpots(first,[first,second],cues,31).remaining,8,'Purchases at the next offer belong to its batch');
 assert.equal(replayOfferSpots(second,[first,second],cues,31).remaining,3,'A returning buyer may count once in a new offer');
});

test('seeking, resuming, disabled counters and clearing a CSV have deterministic results',()=>{
 const restored=JSON.parse(JSON.stringify({offer:first,offers:[first,second],cues,seconds:20}));
 assert.equal(replayOfferSpots(restored.offer,restored.offers,restored.cues,restored.seconds).remaining,8);
 assert.equal(replayOfferSpots(first,[first,second],cues,12).remaining,10,'Owner preview can rewind');
 assert.equal(replayOfferSpots(first,[first],[],20).remaining,10,'Clearing chat clears the simulated purchases');
 assert.equal(replayOfferSpots({...first,replaySpots:null},[first],cues,20),null);
 assert.equal(replayOfferSpots({...first,replaySpots:undefined},[first],cues,20),null);
 assert.equal(replayOfferSpots(first,[first],cues,NaN),null);
});

test('pop-ups and the persistent counter share purchase timing across seeks and closed offers',()=>{
 const offers=[{...second,durationSeconds:1,expiresAt:'2020-01-01T00:00:00Z'},first];
 assert.deepEqual(replayOfferActivity(offers,cues,9),{spots:null,purchase:null});
 let activity=replayOfferActivity(offers,[...cues].reverse(),15);
 assert.equal(activity.purchase.name,'David');assert.equal(activity.spots.remaining,9);
 activity=replayOfferActivity(offers,cues,17);
 assert.equal(activity.purchase.at,15,'A duplicate purchase does not restart the pop-up');
 activity=replayOfferActivity(offers,cues,26);
 assert.equal(activity.purchase,null,'Recorded pop-ups end after six seconds');assert.equal(activity.spots.remaining,8);
 activity=replayOfferActivity(offers,cues,31);
 assert.equal(activity.purchase.name,'Next buyer');assert.equal(activity.spots.remaining,3,'The playback batch survives expired checkout timers');
 activity=replayOfferActivity(offers,cues,12);
 assert.equal(activity.purchase,null);assert.equal(activity.spots.remaining,10,'Preview rewind restores the exact counter');
 assert.equal(replayOfferActivity([{...first,replaySpots:null}],cues,15).purchase.name,'David','Purchase pop-ups also work without a spots bar');
});

test('simulated spots clamp at zero but do not change live checkout eligibility',()=>{
 const offer={...first,replaySpots:1,expiresAt:'2030-01-01T00:00:00Z'};
 assert.equal(replayOfferSpots(offer,[offer],cues,50).remaining,0);
 assert.equal(selectOffer([offer],50,Date.parse('2029-01-01T00:00:00Z')).id,offer.id);
 assert.equal(selectOffer([offer],50,Date.parse(offer.expiresAt)),null,'The actual timer still closes the offer');
});

test('offer settings validate and stay isolated by recording through save and public serialization',()=>{
 const offer={...first,title:'Offer',description:'',ctaLabel:'Continue',action:'checkout',url:'',expiresAt:null};
 for(const replaySpots of [0,-1,1.5,100001,'10'])assert.equal(webinarOfferSchema.safeParse({...offer,replaySpots}).success,false);
 for(const replaySpots of [1,10,100000,null,undefined])assert.equal(webinarOfferSchema.safeParse({...offer,replaySpots}).success,true);
 const w={...newWebinar('00000000-0000-4000-8000-000000000123'),offers:[offer]};
 w.nightVersion=createNightRecording(w);
 const saved=webinarSchema.parse(patchRecording(w,'night',{offers:[{...offer,replaySpots:50}]}));
 assert.equal(publicWebinar(saved).offers[0].replaySpots,10);
 assert.equal(publicWebinar(editingRecording(saved,'night')).offers[0].replaySpots,50);
});
