import {assertMigrationConfig} from './helpers/funded-recovery-migration.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {smsLength} from '../lib/sms-length.ts';
import {setupSql,migration,seedSql,queueSql,expected,recipient} from './helpers/seller-opener-ampersand-fixture.mjs';
const pg=new PGlite(),one=async(s,a=[])=>Object.values((await pg.query(s,a)).rows[0]??{})[0];
const isolated=async f=>{await pg.exec('begin');try{await f();}finally{await pg.exec('rollback');}};
const candidate='select icash_seller_opener_candidate_body(account_id,id) from icash_text_threads';
const definitions=()=>one("select jsonb_object_agg(p.proname,pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('icash_seller_identity_opener','icash_seller_recipient_opener','icash_seller_opener_candidate_body','icash_queue_seller_opener')");
try{
 await pg.exec(setupSql+seedSql);
 assert.equal(await one('select md5(pg_get_functiondef($1::regprocedure))',[recipient.signature]),recipient.hash);
 const original=await definitions(),wallet=await one('select to_jsonb(w) from icash_wallets w');
 assert.equal(await one(candidate),null,'Literal saved ampersand currently prevents selection');
 assert.equal(await one(queueSql),null,'Original queue reproduces the same blocked copy');
 assert.equal(await one('select count(*)::int from icash_text_messages'),0);
 assert.equal(await one('select icash_sms_single_segment($1)',[expected]),true,'Existing financial segment checker already permits literal ampersand');
 assert.deepEqual(smsLength(expected),{units:expected.length,limit:160,fits:true});
 await pg.exec(migration);
 assertMigrationConfig('seller-opener-literal-ampersand',migration);
 const changed=await definitions();
 for(const [name,before] of Object.entries(original))assert.equal(changed[name],before.replaceAll('[^A-Za-z0-9 .,!?]','[^A-Za-z0-9 .,!?&]'),'Only the literal one-unit character allowance changes: '+name);
 await pg.exec(migration);assert.deepEqual(await definitions(),changed,'Exact reapplication is a no-op');
 assert.equal(await one(candidate),expected,'Preview retains the complete literal principal and address');
 const fixed='Hi, contacting you for  about a cash offer. Do you own 123 Main St? Reply STOP to opt out.';
 for(const [principal,length] of [['&'+'A'.repeat(160-fixed.length-1),160],['&'+'A'.repeat(161-fixed.length-1),161]]){
  const value=await one("select icash_seller_identity_opener($1,'123 Main St')",[principal]);
  if(length===160){assert.equal(value.length,160);assert.equal(await one('select icash_sms_single_segment($1)',[value]),true);assert(smsLength(value).fits);}else assert.equal(value,null,'No extra segment or truncation');
 }
 for(const principal of ['A ＆ B Homes','A &amp; B Homes','A—B Homes','A🙂B Homes','A; B Homes',''])assert.equal(await one("select icash_seller_identity_opener($1,'123 Main St')",[principal]),null,principal+' remains unsupported');
 assert.equal(await one("select icash_seller_identity_opener('A & B Homes','')"),null);
 await isolated(async()=>{
  await pg.exec("update icash_text_threads set seller_intake_id=id;insert into icash_seller_matches select id,account_id,deal_id from icash_text_threads;insert into icash_seller_recipient_ordinals select id,account_id,1 from icash_text_threads;");
  assert.equal(await one("select icash_seller_recipient_opener(account_id,id,null,'A & B Homes','123 Main St') from icash_text_threads"),expected,'Existing requested-recipient helper agrees with ordinary preview');
  assert.equal(await one("select icash_seller_recipient_opener(gen_random_uuid(),id,null,'A & B Homes','123 Main St') from icash_text_threads"),null,'No cross-account ordinal binding');
  await pg.exec('update icash_seller_recipient_ordinals set recipient_ordinal=4;');
  assert.equal(await one("select icash_seller_recipient_opener(account_id,id,null,'A & B Homes','123 Main St') from icash_text_threads"),null);
 });
 await isolated(async()=>{
  assert((await one('select icash_next_before_sms_inbound_campaign()'))?.token);
  const message=await one('select to_jsonb(m) from icash_text_messages m');
  assert.equal(message.body,expected);assert.equal(message.state,'ready');assert.equal(message.provider_id,null);
  assert.equal(message.customer_price_micros,20800);assert.equal(message.route_revision,1);
  assert.equal(await one('select body from icash_seller_opener_assignments'),expected);
  assert.equal(await one('select message_id from icash_seller_opener_assignments'),message.id);
  assert.equal(await one('select owner_question_id from icash_sms_seller_openings'),message.id);
  assert.equal(await one(queueSql),null,'Existing assignment prevents duplicate preparation');
  assert.equal(await one('select count(*)::int from icash_text_messages'),1);
  await pg.exec('update icash_accounts set bot_paused=true;');
  assert.equal(await one("select icash_claim_text_before_owner_question(account_id,id,'+17205550100') from icash_text_messages"),null,'Actual final account lock still refuses saved Pause');
  assert.equal(await one('select count(*)::int from icash_operation_spend'),0,'Draft is not a provider action or settled spend');
  assert.deepEqual(await one('select to_jsonb(w) from icash_wallets w'),wallet);
 });
 for(const [reason,mutation] of Object.entries({pause:'update icash_accounts set bot_paused=true',reserved:'update icash_wallets set reserved_cents=balance_cents',hours:'update icash_text_threads set hours_allowed=false',source:'update icash_text_threads set review_allowed=false',expired:"update icash_text_threads set permission_until=now()-interval '1 minute'",manual:"insert into icash_property_controls select account_id,id::text,true from icash_text_threads",screening:"update icash_screening_jobs set completed_at=now()-interval '25 hours'"}))await isolated(async()=>{
  await pg.exec(mutation);assert.equal(await one('select icash_next_before_sms_inbound_campaign()'),null,reason+' still blocks ordinary selection');
  assert.equal(await one('select count(*)::int from icash_text_messages'),0);
  assert.equal(await one('select count(*)::int from icash_operation_spend'),0);
 });
 await isolated(async()=>{
  await pg.exec("insert into icash_text_messages(account_id,thread_id,state,direction,body) select account_id,id,'needs_review','outgoing','Original unknown provider outcome' from icash_text_threads;");
  assert.equal(await one(queueSql),null);assert.equal(await one(candidate),null);
  assert.equal(await one('select state from icash_text_messages'),'needs_review');
 });
 for(const role of ['public','anon','authenticated'])assert.equal(await one("select has_function_privilege($1,'icash_queue_seller_opener(uuid,uuid)','execute')",[role]),false);
 console.log('PASS literal ampersand opener: original failure, exact identity/160-unit limit, matching helper/recipient/preview/queue, actual price/routing/observer, no duplicate work, preserved Pause/funds/hours/source/unknown holds. No provider send.');
}finally{await pg.close();}
