import test from 'node:test';
import assert from 'node:assert/strict';
import {isNight,solarNight} from '../packages/webinar-engine/src/index.ts';
import {webinarViewerLocation} from '../lib/webinar-viewer-location.ts';
import {selectRecording,createNightRecording} from '../lib/webinar-recordings.ts';
import {newWebinar} from '../lib/webinar-policy.ts';

const dallas={latitude:32.7767,longitude:-96.797},newYork={latitude:40.7128,longitude:-74.006},losAngeles={latitude:34.0522,longitude:-118.2437};
const date=s=>new Date(s),routing={nightStartsAt:18,nightEndsAt:6};
test('one arrival instant follows daylight in each location',()=>{
 const now=date('2026-10-08T23:30:00Z');
 assert.equal(isNight('America/New_York',now,routing,newYork),true);
 assert.equal(isNight('America/Los_Angeles',now,routing,losAngeles),false);
 assert.equal(isNight('America/Chicago',now,routing,dallas),false,'Dallas is still daylight after the old fixed cutoff');
});
test('seasonal sunrise and sunset replace fixed hours',()=>{
 assert.equal(isNight('America/Chicago',date('2026-07-09T01:00:00Z'),routing,dallas),false,'8 PM in summer is daylight');
 assert.equal(isNight('America/Chicago',date('2026-12-08T23:45:00Z'),routing,dallas),true,'5:45 PM in winter is after sunset');
 assert.equal(solarNight(dallas,date('2026-10-08T12:15:00Z')),true);
 assert.equal(solarNight(dallas,date('2026-10-08T13:00:00Z')),false);
 assert.equal(solarNight(dallas,date('2026-10-08T23:45:00Z')),false);
 assert.equal(solarNight(dallas,date('2026-10-09T00:15:00Z')),true);
});
test('southern seasons, polar daylight, DST and the date line stay valid',()=>{
 const north={latitude:78.22,longitude:15.65},south={latitude:-78.22,longitude:15.65};
 assert.equal(solarNight(north,date('2026-06-21T23:00:00Z')),false);
 assert.equal(solarNight(north,date('2026-12-21T11:00:00Z')),true);
 assert.equal(solarNight(south,date('2026-06-21T11:00:00Z')),true);
 assert.equal(solarNight(south,date('2026-12-21T23:00:00Z')),false);
 const sydney={latitude:-33.8688,longitude:151.2093};
 assert.equal(solarNight(sydney,date('2026-12-21T09:00:00Z')),false,'8 PM in Sydney summer');
 assert.equal(solarNight(sydney,date('2026-06-21T09:00:00Z')),true,'7 PM in Sydney winter');
 for(const longitude of [-179.9,179.9])assert.equal(solarNight({latitude:0,longitude},date('2028-02-29T00:00:00Z')),false);
 for(const time of ['2026-03-08T07:59:00Z','2026-03-08T08:01:00Z','2026-11-01T06:59:00Z','2026-11-01T07:01:00Z'])assert.equal(isNight('America/Chicago',date(time),routing,dallas),true);
});
test('missing or invalid location keeps the configured local-time fallback',()=>{
 const now=date('2026-07-09T01:00:00Z');
 for(const value of [null,undefined,{latitude:NaN,longitude:0},{latitude:91,longitude:0},{latitude:0,longitude:181}]){
  assert.equal(solarNight(value,now),null);assert.equal(isNight('America/Chicago',now,routing,value),true);
 }
 assert.equal(isNight('America/Chicago',now,{nightStartsAt:22,nightEndsAt:6}),false);
 const headers=new Headers({'x-vercel-ip-latitude':'32.7767','x-vercel-ip-longitude':'-96.797'});
 assert.deepEqual(webinarViewerLocation(headers,true),dallas);assert.equal(webinarViewerLocation(headers,false),null);
 for(const value of ['', ' ', 'NaN', 'Infinity', '91', '32.7, 40', '0x20']){
  headers.set('x-vercel-ip-latitude',value);assert.equal(webinarViewerLocation(headers,true),null);
 }
 assert.equal(webinarViewerLocation(new Headers(),true),null);
 assert.deepEqual(webinarViewerLocation(new Headers({'x-vercel-ip-latitude':'0','x-vercel-ip-longitude':'0'}),true),{latitude:0,longitude:0});
});
test('recording selection keeps one link, explicit previews and Day-only coverage',()=>{
 const day={...newWebinar('00000000-0000-4000-8000-000000000123'),publicCode:'129339',status:'published',videoUrl:'https://example.test/day.mp4'};
 const both={...day,nightEnabled:true,nightVersion:{...createNightRecording(day),videoUrl:'https://example.test/night.mp4'}};
 const now=date('2026-10-08T23:30:00Z');
 assert.equal(selectRecording(both,'America/Chicago',now,routing,undefined,dallas).recordingVersion,'day');
 const selected=selectRecording(both,'America/New_York',now,routing,undefined,newYork);
 assert.equal(selected.recordingVersion,'night');assert.equal(selected.publicCode,day.publicCode);
 assert.equal(selected.nightVersion,null);assert.equal('location' in selected,false);
 assert.equal(selectRecording(day,'America/New_York',now,routing,undefined,newYork).recordingVersion,'day');
 assert.equal(selectRecording({...both,nightEnabled:false},'America/New_York',now,routing,undefined,newYork).recordingVersion,'day');
 assert.equal(selectRecording(both,'America/Chicago',now,routing,'night',dallas).recordingVersion,'night');
 assert.equal(selectRecording(both,'America/New_York',now,routing,'day',newYork).recordingVersion,'day');
});
