import test from 'node:test';
import assert from 'node:assert/strict';
import {paidAdArrival,confirmedWatch,bestConvertingWebinar} from '../packages/webinar-engine/src/index.ts';
test('ad eligibility requires explicit paid tags on this arrival',()=>{
 for(const tags of [{},{fbclid:'click'},{ad_id:'{{ad.id}}'},{utm_source:'facebook',utm_medium:'organic'},{utm_medium:'cpc'}])assert.equal(paidAdArrival(tags),false);
 for(const tags of [{ad_id:'1234567'},{utm_source:'facebook',utm_medium:'paid_social'},{utm_source:'google',utm_medium:'cpc'}])assert.equal(paidAdArrival(tags),true);
});
test('confirmed viewing fails closed for missing, partial, future and preview telemetry',()=>{
 const now=new Date('2026-10-07T18:00:00Z'),session={is_preview:false,completed_at:'2026-10-07T17:00:00Z',watched_seconds:900,config:{durationSeconds:1000}};
 assert.equal(confirmedWatch(session,now),true);
 for(const patch of [{is_preview:true},{completed_at:null},{completed_at:'2026-10-08T18:00:00Z'},{watched_seconds:undefined},{watched_seconds:899},{watched_seconds:NaN}])assert.equal(confirmedWatch({...session,...patch},now),false);
});
test('conversion selection separates actual recording versions and ignores small or invalid samples',()=>{
 const a={id:'a',publicCode:'100000',recordingVersion:'day'},b={id:'b',publicCode:'100001',recordingVersion:'night'};
 const rows=[{webinarId:'a',version:'day',viewers:100,cohortBuyers:10},{webinarId:'b',version:'day',viewers:100,cohortBuyers:70},{webinarId:'b',version:'night',viewers:10,cohortBuyers:9}];
 assert.equal(bestConvertingWebinar([a,b],rows).id,'a');rows[2].viewers=20;assert.equal(bestConvertingWebinar([a,b],rows).id,'b');
 assert.equal(bestConvertingWebinar([a,b],[]),null);assert.equal(bestConvertingWebinar([a],[{...rows[0],cohortBuyers:101}]),null);assert.equal(bestConvertingWebinar([a],[{...rows[0],cohortBuyers:0}]),null);
});
