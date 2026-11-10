import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {setupSql,queueSql} from './helpers/seller-cash-questions-fixture.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'),pg=new PGlite();
const value=async(sql,args=[])=>Object.values((await pg.query(sql,args)).rows[0]??{})[0];
try{
await pg.exec(setupSql);
const oldId=await value(queueSql),oldMessage=await value('select to_jsonb(m) from icash_text_messages m where id=$1',[oldId]),oldAssignment=await value('select to_jsonb(a) from icash_seller_opener_assignments a where message_id=$1',[oldId]);
assert.equal(read('config/seller-cash-questions.sql'),read('supabase/migrations/20261110000135_seller_cash_questions.sql'));await pg.exec(read('config/seller-cash-questions.sql'));
assert.equal(await value('select icash_seller_cash_questions_enabled()'),false);
assert.deepEqual(await value('select to_jsonb(m) from icash_text_messages m where id=$1',[oldId]),oldMessage);assert.deepEqual(await value('select to_jsonb(a) from icash_seller_opener_assignments a where message_id=$1',[oldId]),oldAssignment);
await pg.exec("update icash_learning_policy_private.cash_question_settings set enabled_at=now()-interval '1 second'");
const variants=['cash_sale_v6','all_cash_v6','cash_offer_v6'];
for(const variant of variants){const body=await value('select icash_seller_cash_question($1,$2)',[variant,'123 Main St #4/2']);assert.match(body,/cash/);assert(!/own|Investor|STOP/.test(body));assert(body.length<160);assert.equal(await value('select icash_seller_cash_question($1,$2)',[variant,'x'.repeat(160)]),null);assert.equal(await value('select icash_seller_cash_question($1,$2)',[variant,'🙂']),null);}
assert.equal(await value("select icash_seller_cash_question('invented','123 Main')"),null);
const allocations=new Set();let test;
for(let n=2;n<20;n++){
 const thread=await value('select fixture_seed_admission($1,$1)',[n]),account=await value('select account_id from icash_text_threads where id=$1',[thread]);
 const plan=await value('select icash_seller_cash_question_plan($1,$2)',[account,thread]);allocations.add(plan.variant);
 assert.equal(await value('select icash_seller_opener_candidate_body($1,$2)',[account,thread]),plan.body);
 const message=await value('select icash_queue_seller_opener($1,$2)',[account,thread]);assert(message);
 assert.equal(await value('select body from icash_text_messages where id=$1',[message]),plan.body);
 assert.equal(await value('select learning_context from icash_seller_opener_assignments where message_id=$1',[message]),'cash-question-v6');
 assert.equal(await value('select icash_queue_seller_opener($1,$2)',[account,thread]),null,'No repeated opener');
 assert.equal(await value('select icash_seller_has_cash_question($1,$2)',[account,thread]),true);
 assert.equal(await value('select icash_seller_has_cash_question($1,$2)',[oldAssignment.account_id,thread]),false);
 await assert.rejects(pg.query("update icash_seller_opener_assignments set body='edited' where message_id=$1",[message]),/immutable/);
 test={thread,account,message};
}
assert.equal(allocations.size,3,'All reviewed questions are allocated');
const {account,thread,message}=test;
await pg.query("update icash_text_messages set state='delivered',provider_id='provider-opener',last_delivery_at=now() where id=$1",[message]);
await pg.query('insert into icash_operation_spend(operation_key,account_id,state,dispatched_at) values($1,$2,\'settled\',now())',['text:'+message,account]);
// The real inbound wrapper must skip ownership confirmation for this new
// question. A later ambiguous response remains a review, with no owner proof.
const incoming=await value("insert into icash_text_messages(account_id,thread_id,direction,state,body,provider_id,route_revision,created_at) values($1,$2,'incoming','received','yes','provider-yes',1,now()+interval '1 millisecond') returning id",[account,thread]);
await value('select icash_prepare_sms_inbound_reply($1,$2,$3)',[account,thread,incoming]);
assert.equal(await value('select owner_reply_id from icash_sms_seller_openings where thread_id=$1',[thread]),null,'A yes to cash interest is never saved as ownership');
assert.equal(await value('select interest_message_id from icash_sms_seller_openings where thread_id=$1',[thread]),null,'No duplicate cash-interest question');
assert.equal(await value("select count(*)::int from icash_text_messages where thread_id=$1 and body='Would you be interested in selling your property for all cash?'",[thread]),0);
for(const [question,expected] of [['Who is this?','I am a cash buyer'],['who are you','I am a cash buyer'],['Are you a bot?','I am an AI assistant'],['Is this a real person?','I am an AI assistant']])assert((await value('select icash_seller_cash_identity_reply($1,$2)',[question,'123 Main St'])).startsWith(expected));
for(const question of ['STOP','Who is this? Stop texting me','What company is this?','How did you get my number?','Are you the end buyer?'])assert.equal(await value('select icash_seller_cash_identity_reply($1,$2)',[question,'123 Main St']),null);
// Exercise the complete existing identity reply, including its source/route/
// latest-message checks and unchanged one-segment alphabet for other actions.
await pg.query("update icash_text_messages set body='Who is this?',created_at=now()-interval '1 millisecond' where id=$1",[incoming]);
const job=await value("insert into icash_text_ai_jobs(id,account_id,thread_id,message_id,state,analysis) values(gen_random_uuid(),$1,$2,$3,'drafted','{\"action\":\"reply_identity\",\"facts\":[]}') on conflict(message_id) do update set state='drafted',analysis=excluded.analysis returning id",[account,thread,incoming]);
const reply=await value('select icash_seller_reply_before_viewings($1,$2)',[account,job]);assert.equal(reply,'I am a cash buyer reaching out about 123 Main St #4/2. Have you considered a cash sale?');
const dialogue=await value('select icash_seller_dialogue_context($1,$2)',[account,incoming]);assert.equal(dialogue.action,'cash_identity_v6');assert.equal(dialogue.ownershipUnconfirmed,true);assert(dialogue.reply.startsWith('I am a cash buyer'));
await pg.query("update icash_text_messages set body='STOP' where id=$1",[incoming]);assert.equal(await value('select icash_seller_reply_before_viewings($1,$2)',[account,job]),null);
const report=await value('select icash_seller_cash_question_report()');assert.equal(report.winner,null);assert.equal(report.windowHours,72);assert.equal(report.variants.length,3);assert(report.variants.every(v=>v.replyRate===null),'Fresh response windows cannot be declared a winner');
// A mature fictional delivery proves that raw replies, positive answers and
// opt-outs are separate, tied to the original dispatch and selected account.
const mt=await value('select fixture_seed_admission(40,40)'),ma=await value('select account_id from icash_text_threads where id=$1',[mt]);
await pg.query("insert into icash_seller_opener_assignments(thread_id,account_id,variant,body,learning_context,created_at) values($1,$2,'cash_sale_v6',icash_seller_cash_question('cash_sale_v6','123 Main St'),'cash-question-v6',now()-interval '4 days')",[mt,ma]);
const mm=await value("insert into icash_text_messages(account_id,thread_id,direction,state,body,provider_id,route_revision,created_at,last_delivery_at) values($1,$2,'outgoing','delivered',icash_seller_cash_question('cash_sale_v6','123 Main St'),'mature-question',1,now()-interval '4 days',now()-interval '4 days'+interval '1 minute') returning id",[ma,mt]);
await pg.query("insert into icash_operation_spend(operation_key,account_id,state,dispatched_at) select $1,$2,'settled',created_at+interval '30 seconds' from icash_text_messages where id=$3",['text:'+mm,ma,mm]);
await pg.query("insert into icash_text_messages(account_id,thread_id,direction,state,body,provider_id,route_revision,created_at) values($1,$2,'incoming','received','yes','mature-yes',1,now()-interval '4 days'+interval '10 minutes')",[ma,mt]);
let mature=(await value('select icash_seller_cash_question_report()')).variants.find(v=>v.variant==='cash_sale_v6');assert.equal(mature.mature,1);assert.equal(mature.replies,1);assert.equal(mature.positive,1);assert.equal(mature.replyRate,1);
await pg.query("insert into icash_text_messages(account_id,thread_id,direction,state,body,provider_id,route_revision,created_at) values($1,$2,'incoming','received','STOP','mature-stop',1,now()-interval '4 days'+interval '15 minutes')",[ma,mt]);
mature=(await value('select icash_seller_cash_question_report()')).variants.find(v=>v.variant==='cash_sale_v6');assert.equal(mature.replies,1);assert.equal(mature.positive,0);assert.equal(mature.opted_out,1);
await pg.exec('update icash_learning_policy_private.cash_question_settings set enabled_at=null');assert.equal(await value('select icash_seller_cash_questions_enabled()'),false);assert.equal(await value('select icash_seller_has_cash_question($1,$2)',[account,thread]),true,'Rollback never changes the meaning of an already sent question');
for(const role of ['anon','authenticated']){await pg.exec('set role '+role);await assert.rejects(value('select icash_seller_cash_question_report()'),/permission denied/);await pg.exec('reset role');}
await assert.rejects(pg.exec(read('config/seller-cash-questions.sql')),/prerequisite changed/);await pg.exec('rollback');
console.log('PASS cash questions: exact predecessors, actual queue/receipt triggers, three stable prospective variants, unchanged historical copy, no ownership inference or duplicate question, truthful identity replies, preserved STOP and immature-report handling.');
}finally{await pg.close();}
