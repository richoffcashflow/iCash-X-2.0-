import test from 'node:test';
import assert from 'node:assert/strict';
import {newWebinar,webinarSchema,publicWebinar} from '../lib/webinar-policy.ts';
import {createNightRecording,editingRecording,patchRecording,selectRecording} from '../lib/webinar-recordings.ts';
import {webinarLink} from '../lib/webinar-links.ts';
const day={...newWebinar('00000000-0000-4000-8000-000000000123'),publicCode:'129339',status:'published',videoUrl:'https://example.test/day.mp4'};
const night={...day,nightEnabled:true,nightVersion:{...createNightRecording(day),videoUrl:'https://example.test/night.mp4',faq:'PRIVATE NIGHT FAQ',chatStyle:'PRIVATE NIGHT STYLE',nameAt:45}};
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
 assert.equal(webinarSchema.safeParse({...night,nightVersion:{...night.nightVersion,videoUrl:''}}).success,false);
 assert.equal(webinarSchema.safeParse({...night,nightVersion:{...night.nightVersion,chat:[{...day.chat[0],at:1900}]}}).success,false);
 const output=JSON.stringify(publicWebinar(night));assert.ok(!output.includes('PRIVATE NIGHT'));assert.ok(!output.includes('nightVersion'));
 assert.equal(selectRecording(night,'UTC',new Date('2026-10-06T12:00:00Z'),undefined,'night').recordingVersion,'night');
});
