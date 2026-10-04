import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {newWebinar,publicWebinar,visitorTimezone,sameLocalDay,isNight,settingsSchema} from '../lib/webinar-policy.ts';
import {applyChatVariations,snapshotChat,presetChat} from '../lib/webinar-variants.ts';
import {allocation,eligibleVariants,optimizedWebinar,returnVisit} from '../lib/webinar-optimizer.ts';
import {metaPurchasePayload,browserPurchase} from '../lib/webinar-meta-policy.ts';
import {importWebinarChat} from '../lib/webinar-import.ts';
const webinar=(audience='all')=>({...newWebinar(randomUUID()),status:'published',videoUrl:'https://example.com/video.mp4',audience});
const optimizer={enabled:true,explorationPercent:20,minVisitors:100};
const metric=(w,value,visitors=200)=>({webinar_id:w.id,revision:w.revision,visitors,mature_visitors:visitors,purchases:3,value_cents:value,mature_value_cents:value});
test('AI alternatives preserve cue identity, timestamps and genuine replay comments',()=>{
 const source=[...presetChat('Webinar 7').slice(0,2),{id:'original',at:50,name:'Original participant',text:'An actual past question',kind:'replay'}];
 const bank=source.slice(0,2).map(c=>({id:c.id,variations:['Alternative A','Alternative B','Alternative C']}));
 const result=applyChatVariations(source,bank);
 assert.deepEqual(result.map(c=>[c.id,c.at,c.name]),source.map(c=>[c.id,c.at,c.name]));assert.deepEqual(result[2],source[2]);
 assert.throws(()=>applyChatVariations(source,[{id:'invented',variations:['A','B']}]));
 assert.throws(()=>applyChatVariations(source,[bank[0],bank[0]]));
});
test('a session gets a fixed AI mix and new sessions can differ',()=>{
 const w=webinar();w.variationEnabled=true;w.chat[0].variations=['Welcome A','Welcome B','Welcome C'];
 const first=snapshotChat(w,'session-1');assert.deepEqual(first,snapshotChat(w,'session-1'));assert.equal(first.chat[0].at,w.chat[0].at);assert.equal(first.chat[0].kind,'ai');assert.equal(first.chat[0].name,'iCash X assistant');
 assert.ok(new Set(Array.from({length:20},(_,n)=>snapshotChat(w,`session-${n}`).chat[0].text)).size>1);
 assert.equal(first.chat[0].variations,undefined);assert.equal(snapshotChat({...w,variationEnabled:false},'x').chat[0].text,w.chat[0].text);
});
test('public sessions expose no AI source material or alternative banks',()=>{
 const w=webinar();w.chat[0].variations=['A','B'];const visible=publicWebinar(w);assert.ok(!('faq' in visible));assert.ok(!('chatStyle' in visible));assert.ok(!('variations' in visible.chat[0]));
});
test('spreadsheet imports understand the supplied username/message/minutes/seconds columns',()=>{
 const [cue]=importWebinarChat('username,message,minutes,seconds\nGuest 11,"Ready, let’s go",2,5');assert.equal(cue.at,125);assert.equal(cue.kind,'ai');assert.equal(cue.text,'Ready, let’s go');
});
test('new variants get equal learning traffic; zero value cannot create a false winner',()=>{
 const a=webinar(),b=webinar();for(const stats of [[],[metric(a,50000),metric(b,0,20)],[metric(a,0),metric(b,0)]])assert.deepEqual(allocation([a,b],stats,optimizer).map(r=>r.share),[.5,.5]);
});
test('verified value increases allocation without starving another variant',()=>{
 const a=webinar(),b=webinar();const weights=allocation([a,b],[metric(a,50000),metric(b,10000)],optimizer);assert.ok(weights[0].share>weights[1].share);assert.ok(weights[1].share>=.1);assert.ok(Math.abs(weights.reduce((n,r)=>n+r.share,0)-1)<1e-10);
 assert.equal(weights[0].valuePerVisitor,2.5);assert.equal(weights[0].phase,'optimizing');
});
test('edited revisions learn again instead of inheriting old performance',()=>{
 const a=webinar(),old=metric(a,90000);a.revision=2;assert.equal(allocation([a,webinar()],[old],optimizer)[0].phase,'learning');
});
test('IP timezone takes precedence, with validated browser and default fallback',()=>{
 assert.equal(visitorTimezone('America/Los_Angeles','America/Chicago'),'America/Los_Angeles');assert.equal(visitorTimezone('invalid','America/Chicago'),'America/Chicago');assert.equal(visitorTimezone(null,'invalid'),'America/Chicago');
});
test('resume calendar days follow the visitor timezone, not UTC midnight',()=>{
 const now=new Date('2026-10-05T02:00:00Z');assert.equal(sameLocalDay('2026-10-04T14:00:00Z','America/Chicago',now),true);assert.equal(sameLocalDay('2026-10-04T14:00:00Z','Asia/Tokyo',now),false);
});
test('unpaid later-day returns advance through second and third ranked unseen webinars',()=>{
 const a=webinar(),b=webinar(),c=webinar(),stats=[metric(a,60000),metric(b,40000),metric(c,10000)];
 const history=[{webinar_id:a.id,revision:1,completed_at:null,updated_at:'2026-10-03',progress_seconds:60}];
 assert.equal(optimizedWebinar([a,b,c],history,'UTC',stats,optimizer,.99).id,b.id);
 history.push({webinar_id:b.id,revision:1,completed_at:null,updated_at:'2026-10-04',progress_seconds:60});
 assert.equal(optimizedWebinar([a,b,c],history,'UTC',stats,optimizer,.99).id,c.id);
 assert.equal(optimizedWebinar([a,b,c],history,'UTC',stats,{...optimizer,enabled:false},.99).id,c.id);
});
test('night routing respects local time, custom hours and daylight-saving changes',()=>{
 assert.equal(isNight('America/Chicago',new Date('2026-10-05T01:00:00Z')),true);assert.equal(isNight('America/Chicago',new Date('2026-10-04T17:00:00Z')),false);
 assert.equal(isNight('America/Chicago',new Date('2026-10-05T00:00:00Z'),{nightStartsAt:20,nightEndsAt:5}),false);
 assert.equal(isNight('America/Chicago',new Date('2026-11-01T08:00:00Z')),true);
});
test('dedicated night videos override generic fallback and never select drafts',()=>{
 const day=webinar('day'),night=webinar('night'),fallback=webinar();const now=new Date('2026-10-05T01:00:00Z');
 assert.deepEqual(eligibleVariants([day,night,fallback,{...webinar('night'),status:'draft'}],[],'America/Chicago',now).map(w=>w.id),[night.id]);
 assert.equal(optimizedWebinar([night,fallback],[],'America/Chicago',[],optimizer,.9,now).id,night.id);
});
test('a daytime recording covers both periods until a usable night version is published',()=>{
 const day=webinar('day'),night=webinar('night'),now=new Date('2026-10-05T01:00:00Z');
 for(const pool of [[day],[day,{...night,status:'draft'}],[day,{...night,videoUrl:''}]])assert.deepEqual(eligibleVariants(pool,[],'America/Chicago',now).map(w=>w.id),[day.id]);
 assert.equal(optimizedWebinar([day],[],'America/Chicago',[],optimizer,.9,now).id,day.id);
 assert.deepEqual(eligibleVariants([day,night],[],'America/Chicago',now).map(w=>w.id),[night.id]);
 assert.deepEqual(eligibleVariants([day,night],[],'America/Chicago',new Date('2026-10-04T17:00:00Z')).map(w=>w.id),[day.id]);
});
test('all-time or only-night recordings work around the clock without exposing returning-only content to new visitors',()=>{
 const night=webinar('night'),returning=webinar('returning'),now=new Date('2026-10-04T17:00:00Z');
 assert.deepEqual(eligibleVariants([night,returning],[],'America/Chicago',now).map(w=>w.id),[night.id]);
 assert.equal(eligibleVariants([returning],[],'America/Chicago',now).length,0);
});
test('returning viewers get an unseen version and do not immediately repeat after seeing all',()=>{
 const a=webinar(),b=webinar(),history=[{webinar_id:a.id,revision:1,completed_at:'2026-10-03',updated_at:'2026-10-03',progress_seconds:1800}];
 assert.equal(eligibleVariants([a,b],history,'UTC')[0].id,b.id);
 history.push({webinar_id:b.id,revision:1,completed_at:'2026-10-04',updated_at:'2026-10-04',progress_seconds:1800});assert.equal(eligibleVariants([a,b],history,'UTC')[0].id,a.id);
});
test('browser and server Purchase share a deduplication ID and verified amount',()=>{
 const e={event_id:'webinar:purchase:pi_verified',payment_id:'pi_verified',session_id:randomUUID(),visitor_id:randomUUID(),value_cents:14900,occurred_at:'2026-10-04T18:00:00Z'};
 const v={email:' VIEWER@example.test ',marketing_consent_at:'2026-10-04T17:00:00Z',measurement:{fbc:'fb.1.123.click'}};
 const server=metaPurchasePayload(e,v,'https://www.geticashx.com'),browser=browserPurchase(e);
 assert.equal(server.event_id,browser.eventId);assert.equal(server.event_name,browser.eventName);assert.equal(server.custom_data.value,149);assert.equal(server.custom_data.currency,'USD');assert.equal(server.user_data.em[0].length,64);assert.ok(!JSON.stringify(server).includes('VIEWER@'));assert.equal(server.event_source_url,'https://www.geticashx.com/webinar');
 assert.throws(()=>metaPurchasePayload(e,{...v,marketing_consent_at:null},'https://www.geticashx.com'));
 assert.throws(()=>metaPurchasePayload(e,{...v,marketing_consent_at:'2026-10-04T19:00:00Z'},'https://www.geticashx.com'));
 assert.throws(()=>metaPurchasePayload({...e,value_cents:0},v,'https://www.geticashx.com'));
});
test('legacy settings gain safe defaults and invalid day/night boundaries are rejected',()=>{
 const old={enabled:false,fromEmail:'',postalAddress:'',subjects:['a','b','c'],messages:['a','b','c']};const value=settingsSchema.parse(old);assert.equal(value.meta.enabled,false);assert.equal(value.optimizer.explorationPercent,20);assert.equal(value.routing.nightStartsAt,18);assert.equal(settingsSchema.safeParse({...old,routing:{nightStartsAt:6,nightEndsAt:6}}).success,false);
});

const returnSession=(patch={})=>({id:randomUUID(),webinar_id:randomUUID(),revision:1,created_at:'2026-10-04T15:00:00Z',updated_at:'2026-10-04T16:10:00Z',progress_seconds:1200,max_seconds:1200,completed_at:null,superseded_at:null,is_preview:false,config:{pitchAt:1200},offer_seen_at:'2026-10-04T16:00:00Z',...patch});
test('a warm return goes to checkout for the fixed three-hour window',()=>{
 const s=returnSession();const result=returnVisit([s],'America/Chicago',3,new Date('2026-10-04T18:59:59Z'));
 assert.equal(result.kind,'checkout');assert.equal(result.until,'2026-10-04T19:00:00.000Z');
 assert.equal(returnVisit([{...s,updated_at:'2026-10-04T18:59:00Z'}],'America/Chicago',3,new Date('2026-10-04T18:59:59Z')).until,result.until,'refresh does not extend the offer window');
});
test('expiry advances to another webinar even on the same day',()=>{
 const s=returnSession();assert.deepEqual(returnVisit([s],'America/Chicago',3,new Date('2026-10-04T19:00:00Z')),{kind:'advance',sessionId:s.id});
 assert.equal(returnVisit([s],'America/Chicago',0,new Date('2026-10-04T16:00:00Z')).kind,'advance');
});
test('viewers leaving before the pitch still resume that day and advance another day',()=>{
 const s=returnSession({offer_seen_at:null,progress_seconds:300,max_seconds:300});
 assert.equal(returnVisit([s],'America/Chicago',3,new Date('2026-10-04T19:00:00Z')).kind,'resume');
 assert.equal(returnVisit([s],'America/Chicago',3,new Date('2026-10-05T19:00:00Z')).kind,'advance');
});
test('a completed recording starts the window even when no pitch event was received',()=>{
 const s=returnSession({offer_seen_at:null,completed_at:'2026-10-04T16:30:00Z'});
 assert.equal(returnVisit([s],'America/Chicago',3,new Date('2026-10-04T19:00:00Z')).until,'2026-10-04T19:30:00.000Z');
});
test('an expired older session never skips the new video or uses preview activity',()=>{
 const old=returnSession({superseded_at:'2026-10-04T20:00:00Z',updated_at:'2026-10-04T22:00:00Z'}),fresh=returnSession({created_at:'2026-10-04T20:00:00Z',updated_at:'2026-10-04T20:10:00Z',offer_seen_at:null,progress_seconds:120,max_seconds:120});
 const preview=returnSession({is_preview:true,created_at:'2026-10-04T21:00:00Z',offer_seen_at:'2026-10-04T21:00:00Z'});
 assert.deepEqual(returnVisit([old,fresh,preview],'America/Chicago',3,new Date('2026-10-04T22:00:00Z')),{kind:'resume',sessionId:fresh.id});
});
test('legacy routing gains a three-hour window, without changing existing night hours',()=>{
 const s=settingsSchema.parse({enabled:false,fromEmail:'',postalAddress:'',subjects:['a','b','c'],messages:['a','b','c'],routing:{nightStartsAt:20,nightEndsAt:5}});
 assert.equal(s.routing.checkoutWindowHours,3);assert.equal(s.routing.nightStartsAt,20);
});
