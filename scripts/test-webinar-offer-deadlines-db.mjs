import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function verifyWebinarOfferDeadlines(q,config){
 const visitor=randomUUID(),other=randomUUID(),session=randomUUID(),preview=randomUUID();
 const offer={id:'pitch',at:30,durationSeconds:120};
 const snapshot={...config,recordingVersion:'day',offers:[offer,{...offer,id:'later',at:80}],timers:[{...offer,mode:'duration',durationSeconds:600}]};
 await q('insert into icash_webinar_visitors(id) values($1),($2)',[visitor,other]);
 await q('insert into icash_webinar_sessions(id,visitor_id,webinar_id,revision,config,is_preview) values($1,$2,$3,1,$4,false),($5,$2,$3,1,$4,true)',[session,visitor,config.id,snapshot,preview]);
 const read=async(id=session,seconds=30,viewer=visitor)=>(await q('select icash_webinar_timers($1,$2,$3) as result',[viewer,id,seconds])).rows[0].result;
 assert.deepEqual((await read(session,29)).offerDeadlines,{});
 assert.deepEqual((await read(preview)).offerDeadlines,{});
 await assert.rejects(()=>read(session,30,other));
 const first=await read(),deadline=Date.parse(first.offerDeadlines.pitch);
 assert.deepEqual(Object.keys(first.offerDeadlines),['pitch']);
 assert.ok(deadline-first.serverNow>119000&&deadline-first.serverNow<=120000);
 assert.ok(Date.parse(first.deadlines.pitch)-deadline>479000,'Display timer with same ID does not close or extend the offer');
 assert.ok((await Promise.all([read(),read()])).every(r=>r.offerDeadlines.pitch===first.offerDeadlines.pitch));
 const returned=randomUUID(),night=randomUUID();
 await q('insert into icash_webinar_sessions(id,visitor_id,webinar_id,revision,config) values($1,$2,$3,2,$4),($5,$2,$3,3,$6)',[returned,visitor,config.id,{...snapshot,offers:[{...offer,durationSeconds:999}]},night,{...snapshot,recordingVersion:'night'}]);
 assert.equal((await read(returned)).offerDeadlines.pitch,first.offerDeadlines.pitch,'Return visits and revised durations cannot extend the deadline');
 await read(night);
 assert.equal((await q('select count(*)::int n from icash_webinar_offer_deadlines where visitor_id=$1',[visitor])).rows[0].n,2,'Day and Night each get a separate first deadline');
 await q("update icash_webinar_offer_deadlines set started_at=now()-interval '3 minutes',ends_at=now()-interval '1 minute' where visitor_id=$1 and recording_version='day'",[visitor]);
 const expired=await read();
 assert.ok(Date.parse(expired.offerDeadlines.pitch)<expired.serverNow);
 assert.equal((await read(returned)).offerDeadlines.pitch,expired.offerDeadlines.pitch);
 const later=await read(session,80);
 assert.ok(Date.parse(later.offerDeadlines.later)>later.serverNow);
 assert.equal(later.offerDeadlines.pitch,expired.offerDeadlines.pitch,'The next offer does not reopen the old offer');
 for(const role of ['anon','authenticated'])assert.equal((await q("select has_table_privilege($1,'icash_webinar_offer_deadlines','select') as ok",[role])).rows[0].ok,false);
 assert.equal((await q("select relrowsecurity ok from pg_class where oid='icash_webinar_offer_deadlines'::regclass")).rows[0].ok,true);
 await q('set role service_role');
 assert.equal((await read()).offerDeadlines.pitch,expired.offerDeadlines.pitch);
 await q('reset role');
 await q('update icash_webinar_sessions set superseded_at=now() where id=$1',[session]);
 assert.deepEqual((await read()).offerDeadlines,{});
 console.log('Offer deadlines passed: first reveal, persisted expiry, tabs, returns, revisions, next offer, Day/Night, previews and access control.');
}
