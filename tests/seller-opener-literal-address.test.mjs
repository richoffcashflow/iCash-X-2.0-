import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {smsLength} from '../lib/sms-length.ts';
import {setupSql,migration,seedSql,queueSql,expected} from './helpers/seller-opener-literal-address-fixture.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=new PGlite(),one=async(s,a=[])=>Object.values((await pg.query(s,a)).rows[0]??{})[0];
const isolated=async f=>{await pg.exec('begin');try{await f();}finally{await pg.exec('rollback');}};
const candidate='select icash_seller_opener_candidate_body(account_id,id) from icash_text_threads';
const definitions=()=>one("select jsonb_object_agg(p.proname,pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('icash_seller_identity_opener','icash_seller_recipient_opener','icash_seller_opener_candidate_body','icash_queue_seller_opener')");
const fragment=name=>migration.match(new RegExp(name+" text:=\\$[^$]+\\$([\\s\\S]*?)\\$[^$]+\\$;"))[1];
try{
 await pg.exec(setupSql+seedSql);
 const before=await definitions(),wallet=await one('select to_jsonb(w) from icash_wallets w');
 assert.equal(before.icash_seller_opener_candidate_body.trim(),read('tests/fixtures/seller-opener-candidate-before-copy-proof.sql').trim(),'fixture is the captured live helper');
 assert.equal(await one(candidate),null,'Original helper rejects literal # / -');
 assert.equal(await one(queueSql),null,'Original real queue rejects the same short copy');
 assert.equal(await one('select icash_sms_single_segment($1)',[expected]),true,'Existing segment admission already supports these basic characters');
 assert.deepEqual(smsLength(expected),{units:expected.length,limit:160,fits:true});
 await pg.exec(migration);
 const after=await definitions();
 for(const [name,definition] of Object.entries(before)){
  let wanted=definition.replaceAll('[^A-Za-z0-9 .,!?&]','[^A-Za-z0-9 .,!?&#/-]');
  if(name==='icash_seller_opener_candidate_body')wanted=wanted.replace(fragment('original_select'),fragment('replacement_select')).replace(fragment('original_return'),fragment('replacement_return'));
  assert.equal(after[name],wanted,'Exact permitted changes only: '+name);
 }
 assert.equal(await one(candidate),expected);
 for(const [principal,address] of [['A-B Homes','123 Main St'],['A & B Homes','123 Main St #4'],['A Homes','123 1/2 Main St'],['A-B Homes','123 Main St #4-2']]){
  const body='Hi, contacting you for '+principal+' about a cash offer. Do you own '+address+'? Reply STOP to opt out.';
  assert.equal(await one('select icash_seller_identity_opener($1,$2)',[principal,address]),body);
  assert.equal(await one('select icash_sms_single_segment($1)',[body]),true);assert(smsLength(body).fits);
 }
 const fixed='Hi, contacting you for  about a cash offer. Do you own 123 Main St #4/2? Reply STOP to opt out.';
 for(const size of [160,161]){
  const principal='A-'+'B'.repeat(size-fixed.length-2),body=await one("select icash_seller_identity_opener($1,'123 Main St #4/2')",[principal]);
  if(size===160){assert.equal(body.length,160);assert(smsLength(body).fits);assert.equal(await one('select icash_sms_single_segment($1)',[body]),true);}else assert.equal(body,null);
 }
 for(const principal of ['A—B','A−B','A🙂B','A<br>B','A &amp; B','A\nB','A\\B','A:B','A;B',''])assert.equal(await one("select icash_seller_identity_opener($1,'123 Main St')",[principal]),null,principal);
 // A deliberately expensive/throwing final proof is not reached for impossible
 // copy, but every valid candidate still needs a positive full review.
 await pg.exec(`create sequence fixture_copy_proof_checks;
 alter function icash_sms_thread_review_current(uuid,uuid,boolean) rename to fixture_original_review;
 create table fixture_copy_review(raise_error boolean,answer boolean);insert into fixture_copy_review values(false,true);
 create function icash_sms_thread_review_current(a uuid,t uuid,check_hour boolean default true) returns boolean language plpgsql as $$
 begin perform nextval('public.fixture_copy_proof_checks');
 if (select raise_error from public.fixture_copy_review) then raise exception 'Full proof reached';end if;
 return (select answer from public.fixture_copy_review) and public.fixture_original_review(a,t,check_hour);
 end$$;`);
 for(const change of ["update icash_customer_identities set company_name='Unsupported—Name'","update icash_customer_identities set company_name=repeat('A',180)","update icash_deal_files set terms=jsonb_set(terms,'{address}','\"\"')"])await isolated(async()=>{
  await pg.exec(change+';update fixture_copy_review set raise_error=true;');
  assert.equal(await one(candidate),null,'Impossible copy returns without locking full proof');
 });
 for(const answer of ['false','null'])await isolated(async()=>{await pg.exec('update fixture_copy_review set answer='+answer);assert.equal(await one(candidate),null,'Unknown or negative full review cannot return copy');});
 await isolated(async()=>{await pg.exec('update fixture_copy_review set raise_error=true');await assert.rejects(one(candidate),/Full proof reached/);});
 await isolated(async()=>{
  await pg.exec("update icash_text_threads set seller_intake_id=id;insert into icash_seller_matches select id,account_id,deal_id from icash_text_threads;insert into icash_seller_recipient_ordinals select id,account_id,1 from icash_text_threads;");
  assert.equal(await one("select icash_seller_recipient_opener(account_id,id,null,'A-B Homes','123 Main St #4/2') from icash_text_threads"),expected);
  assert.equal(await one("select icash_seller_recipient_opener(gen_random_uuid(),id,null,'A-B Homes','123 Main St #4/2') from icash_text_threads"),null);
 });
 await isolated(async()=>{
  assert((await one('select icash_next_before_sms_inbound_campaign()'))?.token);
  const message=await one('select to_jsonb(m) from icash_text_messages m');
  assert.equal(message.body,expected);assert.equal(message.state,'ready');assert.equal(message.provider_id,null);
  assert.equal(message.customer_price_micros,20800);assert.equal(message.route_revision,1);
  assert.equal(await one('select body from icash_seller_opener_assignments'),expected);
  assert.equal(await one('select message_id from icash_seller_opener_assignments'),message.id);
  assert.equal(await one('select owner_question_id from icash_sms_seller_openings'),message.id);
  assert.equal(await one(queueSql),null);assert.equal(await one('select count(*)::int from icash_text_messages'),1);
  await pg.exec('update icash_accounts set bot_paused=true;');
  assert.equal(await one("select icash_claim_text_before_owner_question(account_id,id,'+17205550100') from icash_text_messages"),null);
  assert.equal(await one('select count(*)::int from icash_operation_spend'),0);assert.deepEqual(await one('select to_jsonb(w) from icash_wallets w'),wallet);
 });
 for(const mutation of ['update icash_accounts set bot_paused=true','update icash_wallets set reserved_cents=balance_cents','update icash_text_threads set hours_allowed=false','update icash_text_threads set review_allowed=false',"update icash_text_threads set permission_until=now()-interval '1 minute'","insert into icash_property_controls select account_id,id::text,true from icash_text_threads","update icash_screening_jobs set completed_at=now()-interval '25 hours'"])await isolated(async()=>{
  await pg.exec(mutation);assert.equal(await one('select icash_next_before_sms_inbound_campaign()'),null);
  assert.equal(await one('select count(*)::int from icash_text_messages'),0);assert.equal(await one('select count(*)::int from icash_operation_spend'),0);
 });
 await isolated(async()=>{await pg.exec("insert into icash_text_messages(account_id,thread_id,state,direction,body) select account_id,id,'needs_review','outgoing','Original uncertain receipt' from icash_text_threads;");assert.equal(await one(queueSql),null);assert.equal(await one(candidate),null);assert.equal(await one('select state from icash_text_messages'),'needs_review');});
 for(const role of ['public','anon','authenticated'])assert.equal(await one("select has_function_privilege($1,'icash_queue_seller_opener(uuid,uuid)','execute')",[role]),false);
 assert.equal(migration,read('supabase/migrations/20261103192500_seller_opener_literal_address_copy.sql'));
 console.log('PASS literal # / - identity and address, unchanged 160-unit pricing/actual queue/routing; impossible copy avoids proof and every valid copy retains full review; saved controls, holds and money preserved.');
}finally{await pg.close();}
