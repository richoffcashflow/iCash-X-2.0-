// Run with the installed PGlite module path. Every row/provider is a local fixture.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {api,setup,reset,migration,applyMigration,ids,functionSql} from './helpers/journey-message-preflight-fixture.mjs';
const {PGlite}=await (process.argv[2]?import(pathToFileURL(process.argv[2]).href):import('@electric-sql/pglite')),pg=await PGlite.create();
globalThis.fetch=async()=>{throw Error('Network disabled for journey preflight fixtures');};
const {one,claim,due,final,state}=api(pg);
const isolated=async(fn)=>{await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}};
const metadata=()=>one("select oid,proowner,proacl::text acl,prosecdef,proconfig,provolatile,proparallel from pg_proc where oid='icash_claim_journey_message()'::regprocedure");
try{
 await setup(pg);
 // The installed function fails before any transport or receipt exists.
 await isolated(async()=>{
  for(let poll=0;poll<3;poll++){await due();assert(await claim());assert.equal(await final(),null);}
  await due();assert.equal(await claim(),null);
  assert.deepEqual(await state(),{state:'needs_review',attempts:3,message_id:ids.message,text_state:'ready',provider_id:null});
  await pg.exec('update fixture_gates set admit=true');assert.equal(await final(),null);
  assert.equal((await one('select admissions from fixture_gates')).admissions,0);
 });

 // Source, role/privilege and replay guards fail before touching any data.
 const before=await metadata();
 for(const change of [
  "alter function icash_claim_journey_message() security definer",
  "grant execute on function icash_claim_journey_message() to public",
  "create role fixture_owner;alter function icash_claim_journey_message() owner to fixture_owner",
 ]){
  await pg.exec('begin');await pg.exec(change);
  await assert.rejects(pg.exec(migration),/prerequisite changed/);
  await pg.exec('rollback');assert.deepEqual(await metadata(),before);
 }
 // A runner/ledger failure must roll back DDL as part of the same transaction.
 await pg.exec('create table fixture_migration_ledger(version text primary key)');await pg.exec('begin');
 await pg.exec(migration);await pg.exec("insert into fixture_migration_ledger values('20261116224226')");
 await assert.rejects(pg.exec("insert into fixture_migration_ledger values('20261116224226')"),/duplicate key/);
 await pg.exec('rollback');assert.deepEqual(await metadata(),before);
 assert.equal((await one("select md5(pg_get_functiondef('icash_claim_journey_message()'::regprocedure)) hash")).hash,'a7dddbab7991f436420991832688f09a');
 assert.equal((await one('select count(*)::int n from fixture_migration_ledger')).n,0);
 await pg.exec("update icash_journey_messages set state='needs_review',attempts=3");
 const held=await state();await applyMigration(pg);
 assert.deepEqual(await metadata(),before);assert.deepEqual(await state(),held,'Migration never resets prior review/history');
 await assert.rejects(applyMigration(pg),/prerequisite changed/);
 await pg.exec(reset);

 // Six safe pre-provider deferrals reuse one exact message; recovery sends once.
 await isolated(async()=>{
  for(let poll=1;poll<=6;poll++){
   await due();assert.deepEqual(await claim(),{accountId:ids.account,messageId:ids.message});
   assert.equal(await final(),null);assert.equal((await state()).state,'ready');
  }
  assert.equal((await state()).attempts,6);assert.equal((await one('select count(*)::int n from icash_text_messages')).n,1);
  assert.equal(await claim(),null,'30-minute lease prevents busy retry');
  assert((await one("select next_attempt_at between now()+interval '29 minutes' and now()+interval '31 minutes' valid from icash_journey_messages")).valid);
  await pg.exec('update fixture_gates set admit=true');assert(await final());assert.equal(await final(),null);
  await due();assert.equal(await claim(),null);assert.equal((await state()).state,'needs_review');
  assert.equal((await one('select admissions from fixture_gates')).admissions,1);
 });

 for(const [transport,provider,expected] of [
  ['accepted',null,'sent'],['delivered','receipt','sent'],['dispatching',null,'needs_review'],
  ['needs_review',null,'needs_review'],['cancelled',null,'needs_review'],['failed',null,'needs_review'],['ready','receipt','needs_review'],
 ])await isolated(async()=>{
  assert(await claim());await pg.query('update icash_text_messages set state=$1,provider_id=$2',[transport,provider]);
  await due();assert.equal(await claim(),null);assert.equal((await state()).state,expected);
  await pg.exec('update fixture_gates set admit=true');assert.equal(await final(),null);
  assert.equal((await one('select admissions from fixture_gates')).admissions,0);
 });

 // Missing or misbound originals fail closed without mutating their receipt.
 for(const mutation of [
  'delete from icash_text_messages',
  "update icash_text_messages set account_id='"+ids.other+"'",
  "update icash_text_messages set thread_id='"+ids.other+"'",
 ])await isolated(async()=>{
  assert(await claim());await pg.exec(mutation);
  const original=(await pg.query('select * from icash_text_messages')).rows;
  await due();assert.equal(await claim(),null);assert.equal((await state()).state,'needs_review');
  assert.deepEqual((await pg.query('select * from icash_text_messages')).rows,original);
  await pg.exec('update fixture_gates set admit=true');assert.equal(await final(),null);
 });

 // Real journey-current/allowed functions retain the tenant, financial and
 // source checks. The transport review helper remains an explicit boundary.
 for(const [mutation,expected] of [
  ["update icash_accounts set bot_paused=true",'ready'],
  ["insert into icash_property_controls values('"+ids.account+"','fixture',true)",'ready'],
  ["insert into icash_handoffs values('"+ids.account+"','"+ids.screen+"','open')",'ready'],
  ["update icash_signing_envelopes set state='sent'",'ready'],
  ["update icash_deal_files set terms='{\"practice\":true}'",'ready'],
  ["update icash_deal_files set account_id='"+ids.other+"'",'ready'],
  ["update icash_text_threads set account_id='"+ids.other+"'",'cancelled'],
  ["update icash_text_threads set deal_id='"+ids.other+"'",'cancelled'],
  ["update fixture_gates set review=false",'ready'],
  ["update icash_text_threads set paused=true",'ready'],
  ["update icash_text_threads set manual_only=true",'ready'],
  ["update icash_text_threads set retired_at=now()",'cancelled'],
  ["insert into icash_text_suppressions select recipient from icash_text_threads",'cancelled'],
  ["update icash_deal_journeys set expires_at=now()-interval '1 minute'",'cancelled'],
  ["update icash_deal_journeys set state='closed'",'cancelled'],
  ["update icash_journey_messages set showing_id='"+ids.showing+"',showing_version=1",'cancelled'],
 ])await isolated(async()=>{
  await pg.exec(mutation);assert.equal(await claim(),null,mutation);assert.equal((await state()).state,expected,mutation);
  assert.equal((await state()).attempts,0);assert.equal((await one('select count(*)::int n from icash_text_messages')).n,0);
 });

 // Current closing-completion blockers must still stop continuation after safe
 // holds, including a blocker committed between selection and final dispatch.
 for(const kind of ['funding','human'])await isolated(async()=>{
  for(let poll=0;poll<4;poll++){await due();assert(await claim());assert.equal(await final(),null);}
  await pg.query("insert into icash_journey_blockers values($1,$2,'open',1)",[ids.journey,kind]);
  await pg.exec('update fixture_gates set admit=true');assert.equal(await final(),null);
  await due();assert.equal(await claim(),null);assert.equal((await state()).state,'cancelled');
  assert.equal((await one('select admissions from fixture_gates')).admissions,0);
 });

 // Current event checks run again after selection: paid deposits and changed
 // viewings must invalidate the old text even after many harmless holds.
 for(const mutate of [
  "update icash_deal_journeys set state='closed'",
  "update icash_text_messages set body='Changed message'",
  "update icash_text_messages set thread_id='"+ids.other+"'",
 ])await isolated(async()=>{assert(await claim());await pg.exec('update fixture_gates set admit=true');await pg.exec(mutate);assert.equal(await final(),null);});
 await isolated(async()=>{
  await pg.exec("update icash_deal_journeys set state='deposit_due',envelope_id='"+ids.envelope+"';update icash_journey_messages set event_key='deposit_due',attempts=4");
  assert(await claim());await pg.exec("insert into icash_buyer_deposit_receipts values('"+ids.account+"','"+ids.deal+"','"+ids.envelope+"');update fixture_gates set admit=true");
  assert.equal(await final(),null);await due();assert.equal(await claim(),null);assert.equal((await state()).state,'cancelled');
 });
 await isolated(async()=>{
  await pg.exec("insert into icash_showing_requests values('"+ids.showing+"','"+ids.deal+"','"+ids.request+"',1,'confirmed',now()+interval '1 day',now(),now());update icash_journey_messages set event_key='confirmed_buyer:fixture',showing_id='"+ids.showing+"',showing_version=1,attempts=4");
  assert(await claim());await pg.exec('update icash_showing_requests set version=2;update fixture_gates set admit=true');
  assert.equal(await final(),null);await due();assert.equal(await claim(),null);assert.equal((await state()).state,'cancelled');
 });
 await isolated(async()=>{assert(await claim());await pg.exec('update fixture_gates set admit=true');assert.equal(await final(ids.message,ids.other),null);});
 assert.equal(functionSql('config/turnkey-deal-journey.sql','icash_claim_journey_message').includes('attempts>=3'),true,'Historical predecessor stays unchanged');
 console.log('PASS actual journey SQL: reproduced exhaustion; safe holds resume one original message; backoff, receipts, tenant/source/financial controls, final invalidation, ACL/source guards and review history preserved.');
}finally{await pg.close();}
