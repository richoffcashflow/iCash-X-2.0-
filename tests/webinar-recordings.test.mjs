import test from 'node:test';
import assert from 'node:assert/strict';
import {newWebinar,webinarSchema,publicWebinar,chooseWebinar,playableWebinarRecordings} from '../lib/webinar-policy.ts';
import {createNightRecording,editingRecording,patchRecording,selectRecording,recordingRecheckAt} from '../lib/webinar-recordings.ts';
import {webinarLink} from '../lib/webinar-links.ts';
const day={...newWebinar('00000000-0000-4000-8000-000000000123'),publicCode:'129339',status:'published',videoUrl:'https://example.test/day.mp4'};
const night={...day,nightEnabled:true,nightVersion:{...createNightRecording(day),videoUrl:'https://example.test/night.mp4',faq:'PRIVATE NIGHT FAQ',chatStyle:'PRIVATE NIGHT STYLE',nameAt:45}};
test('Nighttime alone publishes and covers every hour, preview and paired VIP fallback',()=>{
 for(const nightEnabled of [true,false]){
  const onlyNight={...night,videoUrl:'',nightEnabled};
  assert.equal(webinarSchema.safeParse(onlyNight).success,true);
  assert.equal(chooseWebinar([onlyNight]).id,onlyNight.id);
  assert.deepEqual(playableWebinarRecordings(onlyNight).map(r=>r.version),['night']);
  for(const time of ['2026-10-06T17:00:00Z','2026-10-07T03:00:00Z'])for(const variant of [undefined,'day','night']){
   const selected=selectRecording(onlyNight,'America/Chicago',new Date(time),undefined,variant);
   assert.equal(selected.videoUrl,night.nightVersion.videoUrl);
   assert.equal(selected.recordingVersion,'night');assert.equal(selected.nameAt,45);
   assert.equal(selected.nightVersion,null);assert.equal(webinarSchema.safeParse(selected).success,true);
  }
 }
 assert.deepEqual(playableWebinarRecordings({...night,nightEnabled:false}).map(r=>r.version),['day']);
});
test('one link stays on Day until its Night recording is ready',()=>{
 assert.equal(webinarLink(day),'/live/129339');
 for(const time of ['2026-10-06T17:00:00Z','2026-10-07T03:00:00Z'])assert.equal(selectRecording(day,'America/Chicago',new Date(time)).videoUrl,day.videoUrl);
 assert.equal(selectRecording({...night,nightEnabled:false},'America/Chicago',new Date('2026-10-07T03:00:00Z')).videoUrl,day.videoUrl);
 assert.equal(selectRecording({...night,nightVersion:{...night.nightVersion,videoUrl:''}},'America/Chicago',new Date('2026-10-07T03:00:00Z')).videoUrl,day.videoUrl);
});
test('Night switches by local time with the same code, and snapshots contain only one recording',()=>{
 const selected=selectRecording(night,'America/Chicago',new Date('2026-10-07T03:00:00Z'));
 assert.equal(selected.videoUrl,night.nightVersion.videoUrl);assert.equal(selected.recordingVersion,'night');assert.equal(webinarLink(selected),webinarLink(day));assert.equal(selected.nightVersion,null);assert.equal(selected.nameAt,45);
 assert.equal(selectRecording(night,'America/Los_Angeles',new Date('2026-10-06T23:00:00Z')).recordingVersion,'day');
 assert.equal(selectRecording(night,'America/New_York',new Date('2026-10-06T23:00:00Z')).recordingVersion,'night');
 assert.equal(selectRecording(night,'America/Chicago',new Date('2026-11-01T08:00:00Z')).recordingVersion,'night');
});
test('Day and Night can be edited independently while identity and audience remain shared',()=>{
 const edited=patchRecording(night,'night',{videoUrl:'https://example.test/new.mp4',nameAt:55,title:'One webinar',showAudienceCount:false});
 assert.equal(edited.videoUrl,day.videoUrl);assert.equal(edited.nameAt,30);assert.equal(edited.nightVersion.nameAt,55);assert.equal(edited.title,'One webinar');assert.equal(edited.showAudienceCount,false);
 assert.equal(editingRecording(edited,'night').videoUrl,'https://example.test/new.mp4');assert.equal(edited.publicCode,'129339');
});
test('published night content must validate without exposing private material',()=>{
 assert.equal(webinarSchema.safeParse(night).success,true);
 assert.equal(webinarSchema.safeParse({...night,nightVersion:{...night.nightVersion,videoUrl:''}}).success,true);
 assert.equal(webinarSchema.safeParse({...night,nightVersion:{...night.nightVersion,chat:[{...day.chat[0],at:1900}]}}).success,false);
 const output=JSON.stringify(publicWebinar(night));assert.ok(!output.includes('PRIVATE NIGHT'));assert.ok(!output.includes('nightVersion'));
 assert.equal(selectRecording(night,'UTC',new Date('2026-10-06T12:00:00Z'),undefined,'night').recordingVersion,'night');
});
test('background returns recheck at local sunset, sunrise and DST-aware fallback hours',()=>{
 const dallas={latitude:32.7767,longitude:-96.797};
 for(const [start,version] of [['2026-10-08T23:30:00Z','day'],['2026-10-08T12:15:00Z','night']]){
  const at=recordingRecheckAt(night,version,'America/Chicago',new Date(start),undefined,dallas);
  assert.ok(at>Date.parse(start)&&at<Date.parse(start)+3600000);
  assert.equal(selectRecording(night,'America/Chicago',new Date(at-1000),undefined,undefined,dallas).recordingVersion,version);
  assert.notEqual(selectRecording(night,'America/Chicago',new Date(at),undefined,undefined,dallas).recordingVersion,version);
 }
 for(const [start,expected] of [['2026-10-16T23:59:30Z','2026-10-17T00:00:00Z'],['2026-11-01T06:30:00Z','2026-11-01T12:00:00Z']]){
  const now=new Date(start),version=selectRecording(night,'America/Chicago',now,{nightStartsAt:19,nightEndsAt:6}).recordingVersion;
  const at=recordingRecheckAt(night,version,'America/Chicago',now,{nightStartsAt:19,nightEndsAt:6});
  assert.ok(at>=Date.parse(expected)&&at<=Date.parse(expected)+1000);
 }
 const now=new Date('2026-10-17T01:00:00Z');
 assert.equal(recordingRecheckAt(night,'day','America/Chicago',now),now.getTime(),'A paired recording from the prior period rechecks on the next return');
 for(const w of [day,{...night,nightEnabled:false},{...night,videoUrl:''}])assert.equal(recordingRecheckAt(w,'day','America/Chicago',now),null);
});
