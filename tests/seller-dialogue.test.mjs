import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {planSellerProgress,sellerProgressInstructions} from '../lib/seller-progress-policy.ts';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const fixture=read('./helpers/seller-progress-fixture.sql'),split=fixture.indexOf('create function icash_queue_ai_reply(');
const fn=(file,name)=>{const s=read('../config/'+file+'.sql'),start=s.indexOf('create function public.'+name+'(');assert(start>=0,name);const tag=s.slice(start).match(/\bas (\$[A-Za-z_]*\$)/i)[1],body=s.indexOf(tag,start);return s.slice(start,s.indexOf(tag+';',body+tag.length)+tag.length+1);};
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>(await q(s,a)).rows[0];
const rpc=async(n,args=[])=>Object.values(await one(`select ${n}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args))[0];
await pg.exec(fixture.slice(0,split)+read('./fixtures/seller-progress-original-functions.sql')+fixture.slice(split)+read('./helpers/seller-dialogue-fixture.sql')+read('./fixtures/seller-dialogue-original-functions.sql')+
 fn('seller-response-policy','icash_seller_direct_response_match')+fn('seller-response-policy','icash_seller_response_disposition')+fn('seller-gap-recovery','icash_seller_contact_stop')+
 `create trigger icash_text_ai_incoming after insert on icash_text_messages for each row execute function icash_enqueue_text_ai();`+read('../config/seller-reply-progress.sql')+read('../config/seller-dialogue.sql'));
await pg.exec('update icash_seller_progress_settings set enabled=true,dialogue_enabled=true');
let tick=0;
const at=()=>new Date(Date.now()-3600000+(++tick)*1000).toISOString();
async function seed(){const a=randomUUID(),t=randomUUID(),d=randomUUID(),s=randomUUID(),phone='+1555'+Math.floor(Math.random()*9999999).toString().padStart(7,'0');
 await q('insert into icash_accounts(id) values($1)',[a]);
 await q("insert into icash_screening_jobs(id,account_id,snapshot,result) values($1,$2,$3,$4)",[s,a,{propertyId:s},{financialCheck:{status:'eligible'},preliminarySellerCeilingCents:12938400}]);
 await q("insert into icash_deal_files(id,account_id,screening_id,terms) values($1,$2,$3,$4)",[d,a,s,{address:'Fixture property'}]);
 await q('insert into icash_text_threads(id,account_id,deal_id,recipient) values($1,$2,$3,$4)',[t,a,d,phone]);
 await q("insert into icash_sms_routes(sender,recipient,account_id) values('+15550000001',$1,$2)",[phone,a]);return {a,t,d,s};
}
async function incoming(c,body,extra={}){const event=extra.event??randomUUID();const m=(await one("insert into icash_text_messages(account_id,thread_id,direction,state,body,event_id,created_at,attachments) values($1,$2,'incoming','received',$3,$4,$5,$6) on conflict(event_id) do update set body=icash_text_messages.body returning id",[c.a,c.t,body,event,extra.at??at(),extra.attachments??[]])).id;return {m,j:(await one('select * from icash_text_ai_jobs where message_id=$1',[m]))};}
const context=(c,m)=>rpc('icash_seller_dialogue_context',[c.a,m]);
const progress=(c,m)=>rpc('icash_refresh_seller_reply_progress',[c.a,m]);
async function dispatch(c,j,{delivered=true}={}){const resumed=await rpc('icash_resume_seller_text_ai',[c.a,j.id]);assert.equal(resumed.mode,'dispatch',JSON.stringify(resumed));
 const msg=await one('select * from icash_text_messages where id=$1',[resumed.messageId]);assert(msg.body.length<=160,msg.body);
 assert.ok(await rpc('icash_claim_text',[c.a,msg.id,'+15550000001']),'Actual production campaign/final-message guard admits expected copy');
 assert.equal(await rpc('icash_claim_text',[c.a,msg.id,'+15550000001']),null,'One provider claim only');
 await q("update icash_text_messages set state=$2,provider_id=$3,created_at=$4 where id=$1",[msg.id,delivered?'delivered':'accepted','provider-'+msg.id,at()]);await progress(c,j.message_id);return msg;
}
// Rockport: clarify, explain, understand the actual answer, continue automatically.
const rock=await seed();let turn=await incoming(rock,"Yes, I'm only interested in a cash offer. No 3rd parties");
assert.equal(turn.j.analysis.dialogueAction,'clarify_buyer_condition');assert.equal((await progress(rock,turn.m)).state,'pending');
let sent=await dispatch(rock,turn.j);assert.match(sent.body,/do you mean no agents, or no assigning/);
assert.equal((await progress(rock,turn.m)).reason,'awaiting_seller_reply');
turn=await incoming(rock,'I mean no agents');assert.equal(turn.j.analysis.dialogueAction,'explain_assignment');
sent=await dispatch(rock,turn.j);assert.match(sent.body,/another buyer take over/);
turn=await incoming(rock,'Yes');let ctx=await context(rock,turn.m);assert.equal(ctx.conditionState,'resolved');assert.equal(ctx.conditionAnswer,turn.m);
assert.equal(turn.j.analysis.dialogueAction,'continue_details');sent=await dispatch(rock,turn.j);assert.match(sent.body,/repairs or updates/);
assert.equal((await one('select count(*)::int n from icash_text_attention where account_id=$1 and state=\'open\'',[rock.a])).n,0,'Clarified condition is not a sticky review');
assert.equal((await one('select count(*)::int n from icash_offer_authorities where account_id=$1',[rock.a])).n,0);
// A direct-buyer requirement is meaningful, not permission to pretend to buy directly.
const direct=await seed();turn=await incoming(direct,'No wholesalers. Direct buyers only.');assert.equal((await progress(direct,turn.m)).reason,'direct_purchase_required');assert.notEqual(turn.j?.analysis?.dialoguePolicy,'seller-dialogue-v1');
// A yes to the either/or question is not agreement to assignment.
const yes=await seed();turn=await incoming(yes,'No third parties');await dispatch(yes,turn.j);turn=await incoming(yes,'Yes');assert.equal((await context(yes,turn.m)).conditionState,'explain_assignment');assert.equal(turn.j.analysis.dialogueAction,'explain_assignment');
// Undelivered/unknown prior questions never ground an ambiguous answer or replay.
const missing=await seed();turn=await incoming(missing,'No third parties');const missingReceipt=await dispatch(missing,turn.j,{delivered:false});turn=await incoming(missing,'Yes');assert.notEqual((await context(missing,turn.m)).conditionState,'resolved');assert.equal((await progress(missing,turn.m)).reason,'clarification_receipt_pending');
assert.equal((await rpc('icash_resume_seller_text_ai',[missing.a,turn.j.id])).mode,'held');
assert.equal((await one('select state from icash_text_ai_jobs where id=$1',[turn.j.id])).state,'pending');
await q("update icash_text_messages set state='delivered' where id=$1",[missingReceipt.id]);
assert.equal((await rpc('icash_resume_seller_text_ai',[missing.a,turn.j.id])).mode,'dispatch','Late original receipt resumes the follow-up without another analysis or repeated question');
for(const [state,reason] of [['accepted','clarification_receipt_unresolved'],['failed','clarification_delivery_failed']]){
 const c=await seed();turn=await incoming(c,'No third parties');const original=await dispatch(c,turn.j,{delivered:false});
 await q("update icash_text_messages set state=$2,updated_at=now()-interval '16 minutes' where id=$1",[original.id,state]);
 turn=await incoming(c,'Yes');assert.equal((await progress(c,turn.m)).reason,reason);assert.notEqual((await context(c,turn.m)).conditionState,'resolved');
 assert.equal((await one("select count(*)::int n from icash_text_messages where account_id=$1 and direction='outgoing'",[c.a])).n,1,'No replay of the original uncertain/failed operation');
}
const repeat=await seed();turn=await incoming(repeat,'No 3rd parties');await dispatch(repeat,turn.j);turn=await incoming(repeat,'No 3rd parties');assert.equal(turn.j.analysis.dialogueAction,'explain_assignment');await dispatch(repeat,turn.j);turn=await incoming(repeat,'No 3rd parties');assert.equal((await progress(repeat,turn.m)).reason,'buyer_condition_unresolved');
// Independent exact statements retain negation and later corrections.
const negative=await seed();turn=await incoming(negative,'No third parties');await dispatch(negative,turn.j);turn=await incoming(negative,"Assignment is not fine. No assignments.");assert.equal((await context(negative,turn.m)).conditionState,'direct_only');
const mixed=await seed();turn=await incoming(mixed,'No third parties');await dispatch(mixed,turn.j);turn=await incoming(mixed,'No agents, but assignment is fine.');assert.equal((await context(mixed,turn.m)).conditionState,'resolved');assert.equal(turn.j.analysis.dialogueAction,'continue_details');
for(const body of ['I did not say assignment is fine.','My agent said assignment is fine.','Assignment is fine if you pay $200k.']){
 const c=await seed();turn=await incoming(c,'No third parties');await dispatch(c,turn.j);turn=await incoming(c,body);assert.notEqual((await context(c,turn.m)).conditionState,'resolved',body);
}
const explain=await seed();turn=await incoming(explain,'No third parties');await dispatch(explain,turn.j);turn=await incoming(explain,'What do you mean by assignment?');assert.equal(turn.j.analysis.dialogueAction,'explain_assignment');
// Visit requests collect real availability and access, without booking a person.
const visit=await seed();turn=await incoming(visit,'Text me to set up a visit');assert.equal(turn.j.analysis.dialogueAction,'ask_visit_details');await dispatch(visit,turn.j);
turn=await incoming(visit,'Tuesday after 3 PM');assert.equal(turn.j.analysis.dialogueAction,'ask_visit_access');await dispatch(visit,turn.j);
turn=await incoming(visit,'I will let you in');ctx=await context(visit,turn.m);assert.equal(ctx.visitAvailability,'Tuesday after 3 PM');assert.equal(ctx.visitAccess,'I will let you in');assert.equal((await progress(visit,turn.m)).reason,'visit_attendee_required');
// Routine informational questions need no model call or manual review.
for(const [body,action,expected] of [['Any fees?','explain_fees',/agreed in writing/],['How does this work?','explain_process',/confirm property details/],['How much?','explain_price',/depends on the property/],['Pictures are there','continue_details',/continue without new photos/],['Which part is that?','clarify_question',/Which part/]]){
 const c=await seed();turn=await incoming(c,body);assert.equal(turn.j.analysis.dialogueAction,action,body);assert.equal(turn.j.provider_id,null);assert.equal(turn.j.usage,null);sent=await dispatch(c,turn.j);assert.match(sent.body,expected);
}
// Memphis's original null route: clarify ownership, never infer it from price.
await pg.exec('update fixture_flags set conversation=false');
const owner=await seed(),question=randomUUID();await q("insert into icash_text_messages(id,account_id,thread_id,direction,state,body,provider_id,created_at) values($1,$2,$3,'outgoing','delivered','Is this the owner of Fixture property?','owner-question',$4)",[question,owner.a,owner.t,at()]);
await q('insert into icash_sms_seller_openings(account_id,thread_id,owner_question_id) values($1,$2,$3)',[owner.a,owner.t,question]);
turn=await incoming(owner,'How much');assert.equal(turn.j.analysis.dialogueAction,'clarify_ownership');assert.equal((await one('select owner_reply_id from icash_sms_seller_openings where thread_id=$1',[owner.t])).owner_reply_id,null);await dispatch(owner,turn.j);
turn=await incoming(owner,'Yes');assert.equal((await one('select owner_reply_id from icash_sms_seller_openings where thread_id=$1',[owner.t])).owner_reply_id,turn.m);assert.ok((await one('select interest_message_id from icash_sms_seller_openings where thread_id=$1',[owner.t])).interest_message_id);
await pg.exec('update fixture_flags set conversation=true');
// Same webhook, repeated prepare/resume, changed account/source and final admission.
const dupe=await seed(),ev=randomUUID();turn=await incoming(dupe,'No third parties',{event:ev});const originalId=turn.j.id;await incoming(dupe,'No third parties',{event:ev});await rpc('icash_prepare_seller_dialogue',[dupe.a,turn.m]);
assert.equal((await one('select count(*)::int n from icash_text_ai_jobs where account_id=$1',[dupe.a])).n,1);
const first=await rpc('icash_resume_seller_text_ai',[dupe.a,originalId]),second=await rpc('icash_resume_seller_text_ai',[dupe.a,originalId]);assert.equal(first.messageId,second.messageId);assert.equal((await one("select count(*)::int n from icash_text_messages where account_id=$1 and direction='outgoing'",[dupe.a])).n,1);
assert.equal(await rpc('icash_seller_dialogue_reply',[rock.a,originalId]),null);
await q("update icash_text_messages set body='I am the direct buyer with funds ready' where id=$1",[first.messageId]);assert.equal(await rpc('icash_claim_text',[dupe.a,first.messageId,'+15550000001']),null,'Mutated promise cannot dispatch');
const newer=await seed();turn=await incoming(newer,'No third parties');const stale=await rpc('icash_resume_seller_text_ai',[newer.a,turn.j.id]);await incoming(newer,'No assignments. Direct buyers only.');assert.equal(await rpc('icash_claim_text',[newer.a,stale.messageId,'+15550000001']),null,'Newer seller restriction cancels stale clarification admission');
const human=await seed();turn=await incoming(human,'No third parties');const superseded=await rpc('icash_resume_seller_text_ai',[human.a,turn.j.id]);await q("insert into icash_text_messages(account_id,thread_id,direction,state,body,provider_id,customer_author_id,created_at) values($1,$2,'outgoing','delivered','I will handle this discussion','manual-receipt',$3,$4)",[human.a,human.t,randomUUID(),at()]);assert.equal(await rpc('icash_claim_text',[human.a,superseded.messageId,'+15550000001']),null,'Later customer message keeps control');
for(const [change,label] of [
 ["update icash_accounts set bot_paused=true where id=$1",'Pause'],["update icash_text_threads set manual_only=true where account_id=$1",'takeover'],
 ["update icash_text_threads set permission_until=now()-interval '1 second' where account_id=$1",'expired checks'],
 ["update icash_screening_jobs set completed_at=now()-interval '2 days' where account_id=$1",'stale property'],
 ["update icash_screening_jobs set result='{\"financialCheck\":{\"status\":\"hold\"}}' where account_id=$1",'financial hold'],
 ["update icash_sms_routes set revision=revision+1 where account_id=$1",'changed route']]){
 const c=await seed();turn=await incoming(c,'No third parties');const out=await rpc('icash_resume_seller_text_ai',[c.a,turn.j.id]);await q(change,[c.a]);assert.equal(await rpc('icash_claim_text',[c.a,out.messageId,'+15550000001']),null,label);
}
for(const body of ['STOP','No thanks','No third parties. Do not contact me.','Can I speak to a human?','How do I wire a deposit?']){const c=await seed();turn=await incoming(c,body);assert.notEqual(turn.j?.analysis?.dialoguePolicy,'seller-dialogue-v1',body);}
const historical=await seed();turn=await incoming(historical,'No third parties',{at:new Date(Date.now()-48*3600000).toISOString()});assert.notEqual(turn.j.analysis?.dialoguePolicy,'seller-dialogue-v1');assert.equal((await progress(historical,turn.m)).reason,'historical_reply');
const model={action:'review',facts:[{kind:'condition',quote:'The roof needs work'}],humanRequested:false,callbackRequested:false,optedOut:false,declined:false};
assert.equal(planSellerProgress(model,{dialogue:{sourceBody:'The roof needs work',routineQualification:true}}).action,'ask_price');
assert.equal(planSellerProgress(model,{dialogue:{sourceBody:'I accept $200k',routineQualification:false}}).action,'review');
assert.match(sellerProgressInstructions,/first clarify whether the seller means agents or assignment/);
await pg.close();console.log('Seller dialogue: clarify/explain/continue, routine questions, ownership clarification, visit availability, actual dispatch guards, duplicate webhooks, missing receipts, pauses and no invented authority passed.');
