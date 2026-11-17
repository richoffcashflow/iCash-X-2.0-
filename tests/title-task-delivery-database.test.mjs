import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {installTitleTaskFixture,titleTaskMigration,titleTaskCase,claimTitleTask,finishTitleTask} from './fixtures/title-task-delivery-fixture.mjs';
import {titleCopyCase,sendTitleCopyReply} from './fixtures/title-copy-fixture.mjs';
const db=new PGlite();
const row=async(q,args=[])=>(await db.query(q,args)).rows[0];
const absent=async()=>assert.equal((await row("select to_regnamespace('icash_title_task_delivery_private') value")).value,null);
const predecessor='b5d5f5d7c15f592389db4505aa0ce343';
async function refuses(mutate,pattern=/prerequisite changed/){
 await db.exec('begin');
 try{await mutate();await assert.rejects(db.exec(titleTaskMigration()),pattern);}finally{await db.exec('rollback');}
 await absent();
 assert.equal((await row("select md5(pg_get_functiondef('public.icash_claim_title_update(uuid,uuid,jsonb)'::regprocedure)) hash")).hash,predecessor);
}
try{
 await installTitleTaskFixture(db);
 assert.equal(titleTaskMigration(),readFileSync('supabase/migrations/20261117035143_title_task_delivery_source.sql','utf8'));
 for(const mutation of [
  'alter function public.icash_claim_title_update(uuid,uuid,jsonb) stable',
  'grant execute on function public.icash_claim_title_update(uuid,uuid,jsonb) to authenticated',
  'alter function public.icash_claim_title_followup(uuid,uuid) owner to service_role',
  'alter function public.icash_claim_title_followup(uuid,uuid) set search_path=public',
  'grant execute on function icash_title_copy_private.envelope_source(public.icash_signing_envelopes) to service_role',
 ])await refuses(()=>db.exec(mutation));
 // Installation may not invent an original snapshot for any preexisting title
 // lifecycle, including an orphaned legacy operation after earlier cleanup.
 await refuses(()=>titleCopyCase(db),/requires an empty title lifecycle/);
 await refuses(async()=>{
  const c=await titleCopyCase(db);
  await db.query('update public.icash_title_tasks set request_id=null where request_id=$1',[c.request]);
  await db.query('delete from public.icash_title_requests where id=$1',[c.request]);
  assert((await row('select count(*)::int n from public.icash_title_tasks')).n>0);
 },/requires an empty title lifecycle/);
 await refuses(async()=>{
  const c=await titleCopyCase(db);
  await db.query('delete from public.icash_title_tasks where request_id=$1',[c.request]);
  await db.query('delete from public.icash_title_requests where id=$1',[c.request]);
  await db.query("insert into public.icash_operation_spend(operation_key,account_id,rate_id,state,dispatched_at,permission_until) values($1,$2,$3,'dispatched',now(),now()+interval '1 day')",['title-followup:historical-original',c.account,c.rate]);
 },/requires an empty title lifecycle/);
 await db.exec('begin');
 await assert.rejects(db.exec(titleTaskMigration().replace("'b29e11f6a533efe41fb88fb27d17f8e7'","'00000000000000000000000000000000'")),/result changed/);
 await db.exec('rollback');await absent();
 await db.exec("create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key);insert into supabase_migrations.schema_migrations values('fixture')");
 await db.exec('begin');await db.exec(titleTaskMigration());
 await assert.rejects(db.exec("insert into supabase_migrations.schema_migrations values('fixture')"),/duplicate key/);
 await db.exec('rollback');await absent();
 await db.exec('begin;'+titleTaskMigration()+"insert into supabase_migrations.schema_migrations values('20261117035143');commit;");
 for(const kind of ['assignment','payout','follow_up']){
  const c=await titleTaskCase(db,kind);assert((await claimTitleTask(db,c)).rows[0].value,kind);
  assert.equal((await finishTitleTask(db,c,kind+'-original')).rows[0].value,true);
  assert.equal((await row('select state from public.icash_title_tasks where id=$1',[c.task.id])).state,'done');
  assert.equal((await claimTitleTask(db,c)).rows[0].value,null,'Only the original may be claimed');
 }
 // The source-protected executed-copy path keeps its existing final claim and
 // receipt authority through the service-only 3-argument compatibility wrapper.
 await db.exec("update icash_title_copy_private.policy set enabled=true,activated_at=now()-interval '1 minute',release_sha=repeat('a',40)");
 const c=await titleCopyCase(db),reply=await sendTitleCopyReply(db,c,'Please send the purchase agreement.');
 const task=await row('select * from public.icash_title_tasks where reply_id=$1',[reply.id]);
 await db.query("update public.icash_title_tasks set email_state='issued' where id=$1",[task.id]);
 await db.exec('set role service_role');
 assert((await row('select public.icash_claim_title_update($1,$2,$3) value',[c.account,task.id,task.payload])).value);
 assert.equal((await row('select public.icash_finish_title_copy($1,$2,$3) value',[c.account,task.id,'copy-original'])).value,true);
 await db.exec('reset role');
 assert.equal((await row('select state from public.icash_title_tasks where id=$1',[task.id])).state,'done');
 assert.equal((await row('select count(*)::int n from icash_title_task_delivery_private.admissions where task_id=$1',[task.id])).n,0,'Executed copy remains in its own original journal');
 console.log('PASS title-task delivery database: source/owner/ACL drift, empty-lifecycle cutover, result/ledger rollback, unchanged legacy positives and existing executed-copy delegation.');
}catch(error){console.error(error.message,error.code,error.where);process.exitCode=1;}finally{await db.close();}
