import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {newWebinar,chooseWebinar,webinarSchema,offerOpen,localHour} from '../lib/webinar-policy.ts';
import {signWebinarToken,readWebinarToken} from '../lib/webinar-token.ts';
import {importWebinarChat} from '../lib/webinar-import.ts';
const video=(audience='all')=>({...newWebinar(randomUUID()),status:'published',videoUrl:'https://example.com/webinar.mp4',audience});
test('day and night selection uses visitor timezone and rotates unseen sessions',()=>{
 const day=video('day'),night=video('night'),second=video('night');
 assert.equal(chooseWebinar([day,night],[],'America/Chicago',new Date('2026-10-04T18:00:00Z')).id,day.id);
 assert.equal(chooseWebinar([day,night],[],'America/Chicago',new Date('2026-10-05T01:00:00Z')).id,night.id);
 const seen=[{webinar_id:night.id,revision:1,progress_seconds:1800,completed_at:'2026-10-04',updated_at:'2026-10-04'}];
 assert.equal(chooseWebinar([night,second],seen,'America/Chicago',new Date('2026-10-05T01:00:00Z')).id,second.id);
});
test('unfinished video resumes before time-of-day selection',()=>{
 const day=video('day'),night=video('night');assert.equal(chooseWebinar([day,night],[{webinar_id:day.id,revision:1,progress_seconds:250,completed_at:null,updated_at:'2026-10-04'}],'America/Chicago',new Date('2026-10-05T01:00:00Z')).id,day.id);
});
test('after every version is seen, the oldest completed version rotates back in',()=>{
 const first=video(),second=video();const history=[{webinar_id:first.id,revision:1,progress_seconds:1800,completed_at:'2026-10-03',updated_at:'2026-10-03'},{webinar_id:second.id,revision:1,progress_seconds:1800,completed_at:'2026-10-04',updated_at:'2026-10-04'}];
 assert.equal(chooseWebinar([first,second],history,'America/Chicago').id,first.id);
});
test('drafts and wrong audience are not publicly selected',()=>{
 assert.equal(chooseWebinar([{...video(),status:'draft'},video('returning')],[],'America/Chicago'),null);
});
test('visitor tokens cannot substitute for login or unsubscribe and expire',()=>{
 const id=randomUUID(),now=1700000000000,key='test-only-secret',token=signWebinarToken(id,'visitor',60,key,now);
 assert.equal(readWebinarToken(token,'visitor',key,now),id);
 assert.equal(readWebinarToken(token,'resume',key,now),null);
 assert.equal(readWebinarToken(token,'visitor','other',now),null);
 assert.equal(readWebinarToken(token,'visitor',key,now+61000),null);
 assert.equal(readWebinarToken(token+'x','visitor',key,now),null);
});
test('CSV imports real quoted messages and preserves newlines',()=>{
 const cues=importWebinarChat('time,name,message,kind\r\n00:35,Kesean,"Welcome, everyone",host\r\n01:20,Host,"Line one\nLine two",host');
 assert.equal(cues[0].at,35);assert.equal(cues[0].text,'Welcome, everyone');assert.equal(cues[1].at,80);assert.equal(cues[1].text,'Line one\nLine two');
 assert.throws(()=>importWebinarChat('name,message\nKesean,Welcome'));
});
test('publishing rejects missing media, bad links, duplicate chat IDs and late cues',()=>{
 const w=video();assert.equal(webinarSchema.safeParse(w).success,true);
 for(const update of [{videoUrl:''},{videoUrl:'javascript:alert(1)'},{pitchAt:9999},{chat:[w.chat[0],w.chat[0]]}])assert.equal(webinarSchema.safeParse({...w,...update}).success,false);
});
test('offer deadline is an absolute time and never resets',()=>{
 const w={offerEndsAt:'2026-10-04T20:00:00Z'};assert.equal(offerOpen(w,Date.parse('2026-10-04T19:59:00Z')),true);assert.equal(offerOpen(w,Date.parse('2026-10-04T20:00:00Z')),false);assert.equal(localHour('America/Chicago',new Date('2026-11-01T08:00:00Z')),2);
});
