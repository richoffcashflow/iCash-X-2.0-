import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {setup} from './helpers/deal-supervisor-setup.mjs';
const pg=await PGlite.create();await pg.exec(setup);
const q=(sql,args=[])=>pg.query(sql,args),one=async(sql,args=[])=>(await q(sql,args)).rows[0];
const run=async()=>(await one('select icash_run_deal_supervisor() r')).r;
const snapshot=async c=>one('select * from icash_deal_supervisor where deal_id=$1',[c.d]);
const force=async c=>{await q("update icash_deal_supervisor set next_check_at=now() where deal_id=$1",[c.d]);return run();};
async function seed({practice=false,paused=false}={}){
 const c={a:randomUUID(),s:randomUUID(),d:randomUUID(),t:randomUUID()};
 await q('insert into icash_accounts values($1,$2)',[c.a,paused]);
 await q('insert into icash_screening_jobs(id,account_id,snapshot) values($1,$2,$3)',[c.s,c.a,{propertyId:c.s,practice}]);
 await q('insert into icash_deal_files(id,account_id,screening_id) values($1,$2,$3)',[c.d,c.a,c.s]);
 await q('insert into icash_text_threads(id,account_id,deal_id,recipient) values($1,$2,$3,$4)',[c.t,c.a,c.d,'+15550001111']);return c;
}
async function message(c,{age=0,body='The roof needs work.',direction='incoming'}={}){
 return (await one("insert into icash_text_messages(account_id,thread_id,direction,state,body,event_id,created_at) values($1,$2,$3,$4,$5,$6,now()-$7*interval '1 hour') returning id",[c.a,c.t,direction,direction==='incoming'?'received':'ready',body,randomUUID(),age])).id;
}
async function signed(c,kind='purchase',{verified=true,test=false}={}){
 const id=randomUUID(),recipients=[{id:'seller',phone:'+15550001111'},{id:'customer',email:'fixture@example.invalid'}];
 const evidence={id:'provider-'+id,test_mode:false,status:'completed',apply_signing_order:true,metadata:{icash_envelope:id,terms_hash:'fixture-hash'},recipients:recipients.map((r,i)=>({...r,status:'signed',signing_order:i+1}))};
 await q("insert into icash_signing_envelopes(id,account_id,deal_id,kind,state,provider_id,terms_hash,recipients,provider_evidence,test_mode) values($1,$2,$3,$4,'completed',$5,'fixture-hash',$6,$7,$8)",[id,c.a,c.d,kind,'provider-'+id,recipients,verified?evidence:{},test]);return id;
}
const disabled=await seed();await message(disabled);assert.equal((await run()).status,'disabled');assert.equal((await one('select count(*)::int n from icash_deal_supervisor_events')).n,0);
await pg.exec("update icash_deal_supervisor_settings set enabled=true,activated_at=now(),release_sha=repeat('a',40);update icash_seller_progress_settings set enabled=true;");
const cold=await seed();await message(cold,{direction:'outgoing'});await run();assert.equal(await snapshot(cold),undefined,'Cold drafts are not engaged deals');
const practice=await seed({practice:true});await message(practice);await run();assert.equal(await snapshot(practice),undefined);

// A fresh inbound whose original routing had no eligible context is repaired once
// when that context exists. Real progress gates decide whether a job can continue.
const c=await seed(),mid=await message(c);let r=await run();assert.equal(r.errors,0);assert.equal(r.repaired,1);
assert.equal((await snapshot(c)).last_action,'queued_missing_seller_reply');
assert.equal((await one('select count(*)::int n from icash_text_ai_jobs where message_id=$1',[mid])).n,1);
const revision=(await snapshot(c)).revision;await force(c);assert.equal((await snapshot(c)).revision,revision,'Unchanged checks do not fabricate progress');
await q("update icash_text_ai_jobs set state='analyzing',provider_id='unknown-original',updated_at=now()-interval '1 hour' where message_id=$1",[mid]);
await force(c);assert.equal((await snapshot(c)).reason,'analysis_receipt_unresolved');
assert.equal((await one('select count(*)::int n from icash_text_ai_jobs where message_id=$1',[mid])).n,1,'Unknown provider work is never replayed');
for(const mode of ['paused','manual','expired','historical','stop','human','missing_receipt']){
 const x=await seed({paused:mode==='paused'}),m=await message(x,{age:mode==='historical'?25:0,body:mode==='stop'?'Stop texting me':undefined});
 if(mode==='manual')await q('update icash_text_threads set manual_only=true where id=$1',[x.t]);
 if(mode==='expired')await q("update icash_text_threads set permission_until=now()-interval '1 hour' where id=$1",[x.t]);
 if(mode==='human')await q('insert into icash_conversations values($1,$2,true)',[x.a,x.d]);
 if(mode==='missing_receipt')await q('update icash_text_messages set event_id=null where id=$1',[m]);
 r=await run();assert.equal(r.errors,0,mode);assert.equal((await one('select count(*)::int n from icash_text_ai_jobs where message_id=$1',[m])).n,0,mode);
}
const predates=await seed();await message(predates,{age:1});await run();assert.equal((await one('select count(*)::int n from icash_text_ai_jobs where account_id=$1',[predates.a])).n,0,'Activation never replays old conversations');
const pending=await seed();await signed(pending,'purchase',{verified:false});await run();assert.equal((await snapshot(pending)).reason,'purchase_receipt_review');
assert.equal((await one('select count(*)::int n from icash_fulfillment_jobs where deal_id=$1',[pending.d])).n,0,'Completed label alone cannot open fulfillment');

// Connected local sequence: exact signatures -> fulfillment -> buyer journey ->
// verified title closing -> separate disbursement and received-proceeds evidence.
const deal=await seed();await q("update icash_deal_files set stage='under_contract' where id=$1",[deal.d]);await signed(deal);await run();
assert.equal((await snapshot(deal)).reason,'fulfillment_queued');assert.equal((await snapshot(deal)).last_action,'queued_missing_fulfillment');
await force(deal);assert.equal((await one('select count(*)::int n from icash_fulfillment_jobs where deal_id=$1',[deal.d])).n,1);
await q("update icash_fulfillment_jobs set state='complete' where deal_id=$1",[deal.d]);
const journey=(await one('insert into icash_deal_journeys(account_id,deal_id) values($1,$2) returning id',[deal.a,deal.d])).id;
await run();assert.equal((await snapshot(deal)).reason,'buyer_next_step');
assert.equal((await one('select count(*)::int n from fixture_journey_actions where journey_id=$1',[journey])).n,1);
await signed(deal,'assignment');await run();assert.equal((await snapshot(deal)).reason,'title_opening_required');
await q("insert into icash_title_requests(account_id,deal_id,state,provider_id) values($1,$2,'sent','original-title')",[deal.a,deal.d]);await run();
assert.equal((await snapshot(deal)).reason,'awaiting_verified_closing','Email sent is not closed');
const reply=(await one('insert into icash_title_replies(account_id,deal_id) values($1,$2) returning id',[deal.a,deal.d])).id;
const close=(await one("insert into icash_closing_updates(account_id,deal_id,reply_id,kind,effective_date,confirmation_source) values($1,$2,$3,'closed',(now() at time zone 'America/Chicago')::date,'verified_title_format') returning id",[deal.a,deal.d,reply])).id;
await run();assert.equal((await snapshot(deal)).reason,'awaiting_verified_closing','Unverified sender cannot close');
await q('update icash_title_replies set sender_verified=true where id=$1',[reply]);await force(deal);
assert.equal((await snapshot(deal)).reason,'awaiting_proceeds_receipt');
const canonical=await one('select * from icash_learning_deal_outcomes($1) where deal_id=$2',[deal.a,deal.d]);assert.ok(canonical.closed_at,'Supervisor agrees with canonical closing evidence');
const funds=(await one("insert into icash_closing_updates(account_id,deal_id,reply_id,kind,effective_date,amount_cents,confirmation_source) values($1,$2,$3,'funds_disbursed',(now() at time zone 'America/Chicago')::date,1000000,'verified_title_format') returning id",[deal.a,deal.d,reply])).id;
await run();assert.equal((await snapshot(deal)).reason,'awaiting_proceeds_receipt','Disbursement is not receipt');
const receipt=(await one("insert into icash_proceeds_receipts(account_id,deal_id,closing_update_id,amount_cents,received_date,confirmed_by) values($1,$2,$3,900000,(now() at time zone 'America/Chicago')::date,$4) returning id",[deal.a,deal.d,funds,randomUUID()])).id;
await run();assert.equal((await snapshot(deal)).reason,'awaiting_proceeds_receipt','Receipt must match confirmed disbursement amount');
await q('update icash_proceeds_receipts set amount_cents=1000000 where id=$1',[receipt]);await force(deal);
assert.equal((await snapshot(deal)).state,'complete');assert.equal((await snapshot(deal)).evidence.receivedCents,1000000);
assert.equal((await snapshot(deal)).evidence.closingUpdateId,close);

// A downstream exception rolls back that deal's repairs, not the other deals.
const broken=await seed();await q("update icash_deal_files set stage='under_contract' where id=$1",[broken.d]);await signed(broken);
await q('insert into icash_deal_journeys(account_id,deal_id) values($1,$2)',[broken.a,broken.d]);await q('update fixture_supervisor_flags set fail_deal=$1',[broken.d]);
const independent=await seed();await message(independent);r=await run();assert.equal(r.errors,1);assert.equal((await snapshot(broken)).last_error,'P0001');assert.equal((await snapshot(independent)).state,'ready');
assert.equal((await one('select count(*)::int n from icash_fulfillment_jobs where deal_id=$1',[broken.d])).n,0,'Failed per-deal transaction rolls back local repair');
const wrong=await one('select icash_supervise_deal($1,$2) r',[independent.a,deal.d]);assert.equal(wrong.r.status,'excluded');
for(let i=0;i<35;i++){const x=await seed();await message(x);}
r=await run();assert(r.processed<=25);assert((await one('select count(*)::int n from icash_deal_supervisor_events')).n>0,'Bounded batches retain unfinished events');
for(const role of ['anon','authenticated']){
 assert.equal((await one("select has_function_privilege($1,'icash_run_deal_supervisor()','EXECUTE') allowed",[role])).allowed,false);
 assert.equal((await one("select has_table_privilege($1,'icash_deal_supervisor','SELECT') allowed",[role])).allowed,false);
}
await pg.close();console.log('PASS deal supervisor: actual SQL, source-bound repair, no unknown retries, controls, canonical signature/closing/proceeds evidence, isolated rollback, tenant isolation, bounded work and private access. All events synthetic.');
