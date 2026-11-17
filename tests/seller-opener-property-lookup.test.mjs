import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {migration,migrationPath,read,install,value,definition,metadata,state,id,account,beforeHash,afterHash,beforePredicate,afterPredicate,candidateQuery} from './helpers/seller-opener-property-lookup-fixture.mjs';
const db=await PGlite.create(),v=(s,a=[])=>value(db,s,a);
const isolated=async fn=>{await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}};
try{
 assert.equal(migration,read(migrationPath));await install(db);
 const before=await definition(db),meta=await metadata(db);
 assert.equal(await v('select md5($1)',[before]),beforeHash);
 await db.exec('select fixture_seed(n,1+n%4,true) from generate_series(1,96)n');
 await db.exec(`insert into icash_accounts values('${account(99)}',false);
  insert into icash_property_controls select account_id,id::text,case when right(id::text,1)::integer%3=0 then null else right(id::text,1)::integer%2=0 end from icash_text_threads;
  insert into icash_property_controls values('${account(99)}','${id(1)}',true);
  update icash_screening_jobs set snapshot='{}' where id='${id(3)}';
  update icash_screening_jobs set snapshot='{"propertyId":null}' where id='${id(4)}';
  update icash_screening_jobs set snapshot='{"propertyId":123}' where id='${id(5)}';
  update icash_screening_jobs set completed_at=now()-interval '25 hours' where id='${id(7)}';
  update icash_text_threads set paused=true where id='${id(8)}';`);
 const preserved=await state(db),queue=await v("select pg_get_functiondef('public.icash_queue_seller_opener(uuid,uuid)'::regprocedure)");
 for(const mutation of ["grant execute on function public.icash_next_before_sms_inbound_campaign() to authenticated","alter function public.icash_next_before_sms_inbound_campaign() stable","alter function public.icash_next_before_sms_inbound_campaign() security definer","alter function public.icash_next_before_sms_inbound_campaign() set search_path=public",before.replace('begin\n','begin\n -- source drift\n')]){
  await db.exec('begin');await db.exec(mutation);await assert.rejects(db.exec(migration),/Seller property lookup/);await db.exec('rollback');
  assert.equal(await definition(db),before);assert.deepEqual(await state(db),preserved);
 }
 await db.exec('begin');await db.exec(migration);await assert.rejects(db.exec('select 1/0'),/division by zero/);await db.exec('rollback');
 assert.equal(await definition(db),before);assert.deepEqual(await metadata(db),meta);
 await db.exec('begin;'+migration+'commit;');
 const after=await definition(db);assert.equal(after,before.replaceAll(beforePredicate,afterPredicate));
 assert.equal(await v('select md5($1)',[after]),afterHash);assert.deepEqual(await metadata(db),meta);
 assert.deepEqual(await state(db),preserved);assert.equal(await v("select pg_get_functiondef('public.icash_queue_seller_opener(uuid,uuid)'::regprocedure)"),queue);
 let comparisons=0;
 for(const mode of ['force_generic_plan','force_custom_plan']){
  await db.exec(`set plan_cache_mode=${mode}`);
  for(const cursor of [null,id(1),id(25),id(70),id(96),id(999)]){
   const old=(await db.query(candidateQuery(before),[cursor])).rows;
   const next=(await db.query(candidateQuery(after),[cursor])).rows;
   assert.deepEqual(next,old);assert(next.length<=32);comparisons++;
  }
 }
 for(const change of ["update icash_property_controls set manual=true",'delete from icash_property_controls',"update icash_property_controls set manual=null",'update icash_accounts set bot_paused=true','update icash_wallets set reserved_cents=balance_cents',"update icash_screening_jobs set result='{}'", "update icash_deal_files set terms='{\"practice\":true}'",'update icash_text_threads set ai_mode=null'])await isolated(async()=>{
  await db.exec(change);assert.deepEqual((await db.query(candidateQuery(after),[null])).rows,(await db.query(candidateQuery(before),[null])).rows);comparisons++;
 });
 await isolated(async()=>{
  await db.exec('delete from icash_property_controls;update icash_text_threads set hours_allowed=false');
  assert.equal(await v('select public.icash_next_before_sms_inbound_campaign()'),null);
  assert.equal(await v("select count(*)::int from fixture_checks where phase='hours'"),32);
  assert.equal(await v('select last_thread_id from icash_work_private.seller_opener_scan'),id(34));
  assert.equal(await v('select count(*)::int from icash_text_messages'),0);
 });
 await db.exec('begin');await assert.rejects(db.exec(migration),/Seller property lookup/);await db.exec('rollback');
 console.log(JSON.stringify({result:'PASS seller property lookup',comparisons,afterHash,finalQueueUnchanged:true}));
}finally{await db.close();}
