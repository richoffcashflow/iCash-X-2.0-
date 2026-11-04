import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {ownerInboundTarget} from '../lib/owner-inbound-acceptance.ts';
import {smsLength} from '../lib/sms-length.ts';
import {setupSql,migration,seedSql,queueSql,legacyBody} from './helpers/seller-sms-learning-v5-fixture.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
assert.equal(migration,read('supabase/migrations/20261104052834_seller_sms_learning_v5.sql'));
assert.ok(migration.includes(ownerInboundTarget.ownerUserId),'Owner exclusion follows the canonical configured identity');
const pg=new PGlite();
const one=async(sql,args=[])=>(await pg.query(sql,args)).rows[0];
const value=async(sql,args=[])=>{const row=await one(sql,args);return row&&Object.values(row)[0];};
let count=0;
let next=2;
const scope=async fn=>{
 await pg.exec('begin');
 try{
  const n=next++;
  const thread=await value('select fixture_seed_admission($1,$1)',[n]);
  const account=await value('select account_id from icash_text_threads where id=$1',[thread]);
  await pg.query('select icash_set_seller_sms_learning_enabled(true)');
  await fn({thread,account});count++;
 }finally{await pg.exec('rollback');}
};
const preview=async c=>value('select icash_seller_opener_candidate_body($1,$2)',[c.account,c.thread]);
const queue=async c=>value('select icash_queue_seller_opener($1,$2)',[c.account,c.thread]);
const plan=async c=>value('select icash_seller_sms_learning_plan($1,$2)',[c.account,c.thread]);
const assignment=async c=>value('select to_jsonb(a) from icash_seller_opener_assignments a where thread_id=$1',[c.thread]);
try{
 await pg.exec(setupSql+seedSql);
 const historical=await value(queueSql);
 const originalMessage=await value('select to_jsonb(m) from icash_text_messages m where id=$1',[historical]);
 const originalAssignment=await value('select to_jsonb(a) from icash_seller_opener_assignments a where message_id=$1',[historical]);
 const originalTemplates=await value('select jsonb_agg(to_jsonb(v) order by key) from icash_seller_opener_variants v');
 const originalAssign=await one("select pg_get_functiondef(oid) definition,proacl::text acl from pg_proc where oid='icash_assign_seller_opener(uuid,uuid)'::regprocedure");
 await pg.exec(migration);
 assert.deepEqual(await one("select pg_get_functiondef(oid) definition,proacl::text acl from pg_proc where oid='icash_assign_seller_opener(uuid,uuid)'::regprocedure"),originalAssign,'Old compiled queue invocations retain their exact legacy assignment helper and grants');
 assert.match(await value("select pg_get_functiondef('icash_queue_seller_opener(uuid,uuid)'::regprocedure)"),/choice:=public\.icash_assign_seller_opener_v5\(p_account,t\.id\);/);
 assert.equal(await value('select enabled from icash_learning_policy_private.sms_settings'),false);
 assert.deepEqual(await value('select to_jsonb(m) from icash_text_messages m where id=$1',[historical]),originalMessage);
 assert.deepEqual(await value("select to_jsonb(a)-array['learning_decision_id','learning_policy_version','learning_selection_mode'] from icash_seller_opener_assignments a where message_id=$1",[historical]),originalAssignment);
 assert.deepEqual(await value("select jsonb_agg(to_jsonb(v) order by key) from icash_seller_opener_variants v where key not like 'identity%v5'"),originalTemplates);

 const variants=['identity_cash_v5','identity_as_is_v5','identity_timing_v5'];
 for(const variant of variants){
  const body=await value('select icash_seller_identity_opener_v5($1,$2,$3)',[variant,'A & B Homes','123 Main St #4/2']);
  assert.match(body,/^Hi, contacting you for A & B Homes about .+\. Do you own 123 Main St #4\/2\?$/);
  assert.equal(body.includes('STOP'),false);assert.deepEqual(smsLength(body),{units:body.length,limit:160,fits:true});
  const base=await value('select icash_seller_identity_opener_v5($1,$2,$3)',[variant,'A','123 Main St']);
  assert.equal((await value('select icash_seller_identity_opener_v5($1,$2,$3)',[variant,'A'.repeat(161-base.length),'123 Main St'])).length,160);
  assert.equal(await value('select icash_seller_identity_opener_v5($1,$2,$3)',[variant,'A'.repeat(162-base.length),'123 Main St']),null);
 }
 for(const name of ['','A🙂B','A—B'])assert.equal(await value('select icash_seller_identity_opener_v5($1,$2,$3)',[variants[0],name,'123 Main St']),null);
 assert.equal(await value('select icash_seller_identity_opener_v5($1,$2,$3)',['unreviewed','A','123 Main St']),null);

 await scope(async c=>{
  const candidate=await preview(c),p=await plan(c);
  assert.equal(candidate,p.body);assert.equal(await value('select count(*)::int from icash_learning_policy_private.decisions'),0,'Previews do not write decisions');
  assert.equal(await assignment(c),undefined);
  const wallet=await value('select to_jsonb(w) from icash_wallets w where account_id=$1',[c.account]);
  const id=await queue(c),a=await assignment(c);
  assert.ok(id);assert.equal(a.body,candidate);assert.equal(a.variant,p.variant);assert.equal(a.learning_context,'identity-v5');
  assert.equal(a.learning_policy_version,'evidence-v2');assert.ok(a.learning_decision_id);
  const m=await one('select body,state,provider_id,route_revision,customer_price_micros from icash_text_messages where id=$1',[id]);
  assert.deepEqual(m,{body:candidate,state:'ready',provider_id:null,route_revision:1,customer_price_micros:20800});
  assert.equal(await value('select count(*)::int from icash_operation_spend'),0);assert.deepEqual(await value('select to_jsonb(w) from icash_wallets w where account_id=$1',[c.account]),wallet);
  assert.equal(await queue(c),null);assert.equal(await value('select count(*)::int from icash_learning_policy_private.decisions'),1);
  await pg.exec("update fixture_sms_policy set decision=jsonb_set(decision,'{allowedChoices}','[]');select icash_set_seller_sms_learning_enabled(false);");
  assert.deepEqual(await value('select icash_assign_seller_opener_v5($1,$2)',[c.account,c.thread]),{variant:a.variant,body:a.body,context:'identity-v5'});
  assert.deepEqual(await assignment(c),a,'Existing assignment survives changed policy and deactivation');
 });
 await scope(async c=>{
  const a=await value('select icash_assign_seller_opener($1,$2)',[c.account,c.thread]);
  assert.equal(a.context,'identity-v4','The unchanged helper keeps old compiled queues on their matching copy version even after activation');
  assert.equal(await value('select count(*)::int from icash_learning_policy_private.decisions'),0);
  assert.deepEqual(await value('select icash_assign_seller_opener_v5($1,$2)',[c.account,c.thread]),a,'New entry point preserves an existing legacy assignment');
 });
 await scope(async c=>{
  await pg.exec('select icash_set_seller_sms_learning_enabled(false)');
  await queue(c);assert.equal((await assignment(c)).learning_context,'identity-v4');assert.equal(await value('select count(*)::int from icash_learning_policy_private.decisions'),0);
 });
 for(const mutation of [
  "update icash_accounts set owner_user_id='"+ownerInboundTarget.ownerUserId+"' where id=$1",
  "update icash_text_threads set seller_intake_id=gen_random_uuid() where account_id=$1",
  "update icash_deal_files set terms=terms||'{\"practice\":true}' where account_id=$1",
  "update icash_screening_jobs set snapshot=snapshot||'{\"test\":true}' where account_id=$1",
  "update icash_screening_jobs set snapshot=snapshot||'{\"sellerRequest\":{}}' where account_id=$1",
  "update icash_screening_jobs set event_key='manual:fixture' where account_id=$1",
  "insert into icash_funding_orders values($1,'test','paid')",
 ])await scope(async c=>{
  await pg.query(mutation,[c.account]);assert.equal(await value('select icash_seller_sms_learning_eligible($1,$2)',[c.account,c.thread]),false);assert.equal(await plan(c),null);
 });
 await scope(async c=>{
  await pg.query("insert into icash_funding_orders values($1,'test','paid'),($1,'live','paid')",[c.account]);assert.equal(await value('select icash_seller_sms_learning_eligible($1,$2)',[c.account,c.thread]),true);
 });
 for(const mutation of [
  'update icash_text_threads set paused=true where account_id=$1',
  'update icash_text_threads set review_allowed=false where account_id=$1',
  "update icash_customer_identities set company_name='Unsupported🙂' where account_id=$1",
 ])await scope(async c=>{
  await pg.query(mutation,[c.account]);assert.equal(await preview(c),null);assert.equal(await queue(c),null);assert.equal(await value('select count(*)::int from icash_learning_policy_private.decisions'),0);
 });
 await scope(async c=>{
  const id=await queue(c);await pg.query('update icash_accounts set bot_paused=true where id=$1',[c.account]);
  assert.equal(await value("select icash_claim_text_before_owner_question($1,$2,'+17205550100')",[c.account,id]),null,'Original final claim preserves account Pause');
  assert.equal(await value('select count(*)::int from icash_operation_spend'),0);
 });
 await scope(async c=>{
  await pg.exec("update fixture_sms_policy set decision=decision||'{\"status\":\"safety_hold\",\"allowedChoices\":[\"identity_timing_v5\"]}';");
  assert.equal((await plan(c)).variant,'identity_timing_v5');await queue(c);assert.equal((await assignment(c)).variant,'identity_timing_v5');
 });
 await scope(async c=>{
  await pg.exec("update fixture_sms_policy set decision=jsonb_set(decision,'{allowedChoices}','[]');");
  assert.equal(await preview(c),null);assert.equal(await queue(c),null);assert.equal(await assignment(c),undefined);
 });
 await scope(async c=>{
  await pg.exec("update icash_seller_opener_variants set body='Unreviewed copy' where key like 'identity%v5';");
  assert.equal(await preview(c),null);assert.equal(await queue(c),null);
 });
 for(const field of ['body','variant','learning_context','learning_policy_version'])await scope(async c=>{
  await queue(c);await assert.rejects(pg.query(`update icash_seller_opener_assignments set ${field}='changed' where thread_id=$1`,[c.thread]),/immutable/);
 });
 await scope(async c=>{
  await pg.exec("update fixture_sms_policy set decision=decision||'{\"status\":\"shared\",\"winner\":\"identity_cash_v5\"}';");
  await pg.query('select fixture_seed_admission(n,$1) from generate_series(100,399) n',[next++]);
  const rows=(await pg.query("select p.*,('x'||substr(md5(t.account_id::text||t.id::text||':seller-sms:identity-v5'),1,8))::bit(32)::bigint%10000 bucket from icash_text_threads t cross join lateral jsonb_to_record(icash_seller_sms_learning_plan(t.account_id,t.id)) p(variant text,mode text) where p.variant is not null")).rows;
  assert.ok(rows.some(r=>r.variant==='identity_cash_v5'));assert.ok(rows.some(r=>r.variant!=='identity_cash_v5'));
  for(const r of rows)if(r.mode!=='control')assert.equal(r.variant==='identity_cash_v5',r.bucket<6000,'Winner allocation remains bounded at60% with exploration in the other40%');
 });
 for(const role of ['anon','authenticated'])assert.equal(await value('select has_function_privilege($1,$2,\'execute\')',[role,'public.icash_set_seller_sms_learning_enabled(boolean)']),false);
 for(const role of ['anon','authenticated','service_role'])assert.equal(await value("select has_function_privilege($1,'public.icash_assign_seller_opener_v5(uuid,uuid)','execute')",[role]),role==='service_role');
 assert.equal(originalMessage.body,legacyBody);
 console.log(`PASS ${count} prospective SMS learning scenarios: disabled rollout, source exclusions, exact one-segment copy, read-only preview, fixed assignments, safety holds, bounded allocation, original queue gates and receipts.`);
}finally{await pg.close();}
