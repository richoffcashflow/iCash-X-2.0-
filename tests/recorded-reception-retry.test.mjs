import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {setupSql,migration,finishSql,bindSql,id,account,operation} from './helpers/reception-retry-fixture.mjs';
const db=await PGlite.create(),one=async(s,a=[])=>Object.values((await db.query(s,a)).rows[0]??{})[0];
const claim=()=>one("select icash_claim_recorded_reception_work('reconcile',3,120)");
const delay=()=>one('select extract(epoch from next_reconcile_at-clock_timestamp())::float from icash_recorded_reception_private.sessions');
const saved=()=>one("select to_jsonb(s)-array['next_reconcile_at','reconcile_attempts','reconcile_lease_token','reconcile_lease_expires_at','row_version','updated_at','last_error','last_action'] from icash_recorded_reception_private.sessions s");
const isolate=async f=>{await db.exec('begin');try{await f();}finally{await db.exec('rollback');}};
try{
 await db.exec(setupSql);
 const original=await saved(),money=await one('select to_jsonb(o) from icash_operation_spend o');
 await isolate(async()=>{await claim();await one(finishSql);assert((await delay())<61,'original forever-minute loop reproduced');});
 await db.exec(migration);
 assert.equal(migration,readFileSync(new URL('../supabase/migrations/20261103162508_recorded_reception_identity_backoff.sql',import.meta.url),'utf8'));
 const definition=await one("select pg_get_functiondef('icash_finish_recorded_reception_work(uuid,uuid,text,text,uuid,bigint,text,jsonb)'::regprocedure)");
 await db.exec(migration);assert.equal(await one("select pg_get_functiondef('icash_finish_recorded_reception_work(uuid,uuid,text,text,uuid,bigint,text,jsonb)'::regprocedure)"),definition);
 for(const [attempts,seconds] of [[1,60],[2,300],[5,900],[11,3600],[8000,3600]])await isolate(async()=>{
  await db.exec(`update icash_recorded_reception_private.sessions set reconcile_attempts=${attempts},row_version=row_version+1`);
  const [c]=await claim();assert(c);assert.deepEqual(await claim(),[],'one-use lease prevents a second worker');
  await one(finishSql);const d=await delay();assert(d<=seconds&&d>seconds-10,`${attempts}: ${d}`);
  assert.deepEqual(await saved(),original);assert.deepEqual(await one('select to_jsonb(o) from icash_operation_spend o'),money,'No original financial state changes');
 });
 for(const reason of ['provider_reconciliation_required','unrecognized_reason','conversation_binding_required'])await isolate(async()=>{
  await claim();await one(finishSql.replace('conversation_identity_required',reason));
  const expected=reason==='conversation_binding_required'?3600:60;assert((await delay())<=expected&&(await delay())>expected-10);
 });
 await isolate(async()=>{await claim();await one(bindSql);await one(finishSql);assert((await delay())<=0,'A canonical identity arriving during the lease stays due');assert.equal(await one('select conversation_id from icash_recorded_reception_private.sessions'),'conv_originalfixture');});
 await isolate(async()=>{await claim();await one(finishSql);assert((await delay())>3500);await one(bindSql);assert((await delay())<=0,'A canonical identity after completion wakes immediately');});
 await isolate(async()=>{const [c]=await claim();await one(bindSql);assert.equal(await one('select icash_finish_recorded_reception_work($1,$2,$3,\'reconcile\',$4,$5,\'retry\',\'{"reason":"conversation_identity_required"}\')',[id,account,operation,c.reconcile_lease_token,c.row_version]),null,'A stale row version cannot finish over new evidence');});
 await isolate(async()=>{await claim();await db.exec("update icash_recorded_reception_private.sessions set reconcile_lease_expires_at=clock_timestamp()-interval '1 second',row_version=row_version+1");assert.equal(await one(finishSql),null,'Expired lease does not schedule anything');});
 // The actual claim retains due work for later accounts when a held session is
 // backing off. It never treats pending costs as a successful customer result.
 await isolate(async()=>{await claim();await one(finishSql);assert.deepEqual(await claim(),[]);assert.equal(await one("select billing_state from icash_recorded_reception_private.sessions"),'reserved');});
 await isolate(async()=>{await one(bindSql);await claim();await one(finishSql);assert((await delay())<61&&(await delay())>50,'Existing conversation identity keeps the original cost/receipt cadence');});
 assert.equal(await one("select has_function_privilege('public','icash_finish_recorded_reception_work(uuid,uuid,text,text,uuid,bigint,text,jsonb)','execute')"),false);
 await db.exec(setupSql.replaceAll("interval '2 days'","interval '2 hours'").replace("interval '28 days'","interval '29 days 22 hours'")+migration);
 await claim();await one(finishSql);assert((await delay())<61&&(await delay())>50,'Fresh terminal missing identity retains minute recovery');
 const guard='create function icash_recorded_reception_private.guard_session()';
 await db.exec(setupSql.replace(guard,"update icash_recorded_reception_private.sessions set call_ended_at=null,call_terminal_status=null,end_requested_at=null,state='recording';\n"+guard)+migration);
 await claim();await one(finishSql);assert((await delay())<61&&(await delay())>50,'Even an old active call keeps the termination watchdog cadence');
 await db.exec(setupSql.replace(guard,"update icash_recorded_reception_private.sessions set audio_expires_at=audio_expires_at-interval '29 days',provider_started_at=provider_started_at-interval '29 days',state='expired';\n"+guard)+migration);
 await claim();await one(finishSql);assert((await delay())>3500);
 const deletions=await one("select icash_claim_recorded_reception_work('delete',5,120)");assert.equal(deletions.length,1,'Retention deletion remains due while identity recovery backs off');
 const beforeDeletion=await one("select pg_get_functiondef('icash_finish_recorded_reception_work(uuid,uuid,text,text,uuid,bigint,text,jsonb)'::regprocedure)");
 await one("select icash_finish_recorded_reception_work(id,account_id,operation_key,'delete',deletion_lease_token,row_version,'retry','{\"reason\":\"deletion_confirmation_required\"}') from icash_recorded_reception_private.sessions");
 assert(await one("select extract(epoch from next_delete_at-clock_timestamp()) between 50 and 60 from icash_recorded_reception_private.sessions"),'Deletion retry retains the original first-minute policy');
 assert.equal(await one("select pg_get_functiondef('icash_finish_recorded_reception_work(uuid,uuid,text,text,uuid,bigint,text,jsonb)'::regprocedure)"),beforeDeletion);
 console.log('PASS incoming identity recovery: original one-minute loop, bounded old terminal backoff, unchanged receipts/money, exact lease/version, canonical late identity before/after finish and private ACL.');
}finally{await db.close();}
