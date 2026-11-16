import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {setup,migration,predecessors,seedDelay,ageAssignments,readyRetry} from './helpers/deferred-sender-fairness-fixture.mjs';
const pg=await PGlite.create();
const exec=s=>pg.exec(s);
const one=async(s,p=[])=>Object.values((await pg.query(s,p)).rows[0])[0];
const owner="md5('owner')::uuid",line="'+14155550100'",waiting="md5('messagewaiting')::uuid";
const next=()=>one('select public.icash_next_sender_volume_retry()');
const turn=()=>one(`select icash_sender_private.waiting_turn(${line})`);
const queue=k=>one(`select public.icash_queue_seller_opener(${owner},fixture_thread($1))`,[k]);
const protectedDefinitions=`select jsonb_object_agg(oid::text,pg_get_functiondef(oid)) from pg_proc where oid in (
 'public.icash_claim_text(uuid,uuid,text)'::regprocedure,'icash_sender_private.property_dispatch()'::regprocedure,
 'icash_sender_private.take(text,uuid,text,boolean,uuid,uuid,text,boolean)'::regprocedure,
 'icash_sender_private.room(text,boolean,uuid,text)'::regprocedure,'icash_sender_private.november_room(text,boolean,timestamptz)'::regprocedure,
 'icash_text_receipt_private.sender_opener_available(text)'::regprocedure,
 'icash_sender_private.transactional(public.icash_text_messages,public.icash_text_threads)'::regprocedure,
 'icash_sender_private.reply_source(public.icash_text_messages,public.icash_text_threads)'::regprocedure,
 'icash_sender_private.requested_introduction(public.icash_text_threads)'::regprocedure)`;
try{
 await exec(setup+seedDelay);
 await exec("set search_path=''");
 for(const [name,definition] of Object.entries(predecessors))
  assert.equal(await one('select md5(pg_get_functiondef($1::regprocedure))',[name]),createHash('md5').update(definition).digest('hex'),name);
 await exec('set search_path=public');
 const original=await one("select jsonb_agg(to_jsonb(o)) from public.icash_operation_spend o");
 const untouched=await one(protectedDefinitions);
 // Reproduce the production phase ordering repeatedly with actual predecessors:
 // every new opener takes the opportunity before the old retry checks its line.
 for(let cycle=0;cycle<3;cycle++){
  await exec(ageAssignments+readyRetry);
  assert.ok(await queue('before-'+cycle));
  assert.equal(await next(),null,'fresh introduction starves the original retry');
 }
 assert.equal(await one(`select state from public.icash_text_messages where id=${waiting}`),'ready');
 await exec(migration);
 await exec(ageAssignments+readyRetry);
 assert.equal(await turn(),true);
 const candidate=await one("select fixture_thread('candidate')");
 assert.equal(await one(`select public.icash_seller_opener_candidate_body(${owner},$1)`,[candidate]),null);
 assert.equal(await queue('after'),null,'a new cold introduction yields before taking the opportunity');
 const retry=await next();
 assert.equal(retry.messageId,await one(`select ${waiting}`));
 assert.equal(retry.claimKind,'automatic');
 assert.equal(await turn(),true,'selection preserves the turn until original admission');
 assert.equal(await queue('selected'),null);
 assert.equal(await next(),null,'selection keeps the original five-minute retry interval');
 assert.deepEqual(await one('select jsonb_agg(to_jsonb(o)) from public.icash_operation_spend o'),original,'scheduling grants no money or provider authority');
 // Bound a failed final claim and an unavailable retry worker without sleeps.
 await exec("update icash_sender_private.waiting set last_selected_at=now()-interval '31 seconds'");
 assert.equal(await turn(),false,'a selected message that cannot dispatch returns its turn');
 await exec(readyRetry);assert.equal(await turn(),true,'ordinary due check renews fairness');
 await exec("update icash_sender_private.waiting set last_selected_at=null,next_check_at=now()-interval '61 seconds'");
 assert.equal(await turn(),false,'a stopped maintenance worker cannot freeze new openers');
 await exec(readyRetry);
 // Each stale or forbidden original is excluded; no replacement is manufactured.
 const cases=[
  ["update public.icash_accounts set bot_paused=true",'Pause'],
  ["update public.icash_text_threads set paused=true",'thread Pause'],
  ["update public.icash_text_threads set ai_mode='manual'",'manual takeover'],
  ["update public.icash_text_threads set retired_at=now()",'retired route'],
  ["insert into public.icash_text_suppressions(phone) select recipient from public.icash_text_threads",'STOP'],
  [`update public.icash_text_messages set body='Changed' where id=${waiting}`,'changed draft'],
  [`update public.icash_text_messages set provider_id='unknown-original' where id=${waiting}`,'provider uncertainty'],
  [`update public.icash_text_messages set last_delivery_at=now() where id=${waiting}`,'prior receipt'],
  [`insert into public.icash_operation_spend(operation_key,account_id,state,reserved_micros) values('text:'||${waiting},${owner},'dispatched',10000)`,'original operation'],
  [`insert into icash_sender_private.uses(source,source_id,sender,cold,admitted_at) values('property',${waiting},${line},true,now())`,'original use'],
  ["update icash_sender_private.waiting set binding='changed'",'binding mismatch'],
  ["update icash_sender_private.waiting set account_id=gen_random_uuid()",'account mismatch'],
  ["update icash_sender_private.waiting set sender='+16195550101'",'line mismatch'],
  ["update icash_sender_private.waiting set queued_at=now()-interval '25 hours'",'expired original'],
  ["update icash_sender_private.waiting set next_check_at=now()+interval '1 hour'",'postponed retry cannot reserve a number'],
  [`insert into public.icash_contract_text_deliveries(message_id,thread_id,account_id) select id,thread_id,account_id from public.icash_text_messages where id=${waiting}`,'transactional work retains its separate path'],
  [`select fixture_message('newer',thread_id) from public.icash_text_messages where id=${waiting}`,'new conversation evidence'],
 ];
 for(const [mutation,label] of cases){await exec('begin;'+mutation);assert.equal(await turn(),false,label);await exec('rollback');assert.equal(await turn(),true,label+' rollback');}
 assert.equal(await one("select icash_sender_private.waiting_turn('+16195550101')"),false,'independent physical number');
 await exec(`begin;
  select fixture_thread('requested');
  insert into public.icash_seller_intakes(id,phone,ai_consented,state,name)
   select md5('intake')::uuid,recipient,true,'assigned','Fixture' from public.icash_text_threads where id=md5('threadrequested')::uuid;
  insert into public.icash_seller_matches values(md5('intake')::uuid,${owner},md5('screen')::uuid);
  update public.icash_screening_jobs set snapshot=jsonb_set(snapshot,'{sellerRequest}',jsonb_build_object('id',md5('intake')::uuid));
  update public.icash_text_threads set seller_intake_id=md5('intake')::uuid,manual_only=false,permission_until=now()+interval '1 hour',permission_evidence='synthetic consent'
   where id=md5('threadrequested')::uuid;`);
 assert.equal(await turn(),true);
 assert.ok(await one(`select public.icash_queue_seller_opener(${owner},md5('threadrequested')::uuid)`),'verified requested introduction preserves its existing separate admission');
 await exec('rollback');
 // Legitimate manual recovery is still manual, including a paused AI thread.
 await exec("begin;update icash_sender_private.waiting set claim_kind='manual';update public.icash_text_threads set paused=true;");
 assert.equal(await turn(),true);assert.equal((await next()).claimKind,'manual');await exec('rollback');
 // No number limit or final claim implementation was weakened.
 assert.deepEqual(await one(protectedDefinitions),untouched);
 for(const role of ['anon','authenticated'])assert.equal(await one("select has_function_privilege($1,'icash_sender_private.waiting_turn(text)','execute')",[role]),false);
 assert.equal(await one("select prosecdef from pg_proc where oid='icash_sender_private.waiting_turn(text)'::regprocedure"),false);
 await exec("begin;insert into icash_sender_private.uses(source,source_id,sender,cold,admitted_at) select 'full',md5(i::text)::uuid,'+14155550100',true,now() from generate_series(1,1000)i;"+readyRetry);
 assert.equal(await next(),null,'fairness never increases shared sending capacity');await exec('rollback');
 await exec(readyRetry);
 assert.ok(await next());
 assert.deepEqual(await one(`select public.icash_claim_text(${owner},${waiting},${line})`),{from:'+14155550100'});
 assert.equal(await turn(),false,'the actual original claim consumes the waiting entry');
 assert.equal(await one(`select public.icash_claim_text(${owner},${waiting},${line})`),null,'never duplicate original transport');
 assert.equal(await one('select count(*)::int from public.icash_operation_spend'),2);
 // Source pinning fails before DDL, also on a repeated installation.
 await assert.rejects(()=>exec(migration),/predecessor changed/);await exec('rollback');
 assert.equal(await one("select count(*)::int from information_schema.columns where table_schema='icash_sender_private' and table_name='waiting' and column_name='last_selected_at'"),1);
 console.log('PASS repeated fresh-opener starvation reproduced; original retry gets a bounded turn; seventeen invalid originals, manual routing, outage/claim expiry, unchanged limits and original single dispatch');
}finally{await pg.close();}
