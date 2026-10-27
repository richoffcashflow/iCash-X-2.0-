import assert from 'node:assert/strict';
import {parallelWorkFixture,read,uid} from './helpers/parallel-work-fixture.mjs';
const pg=await parallelWorkFixture(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const isolate=async fn=>{await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}};
const add=async(n,zone='open',account=uid(1),basis='known')=>{
 await q('insert into icash_operational_contacts(id,account_id,contact_key,timezone,timezone_basis) values($1::uuid,$2,$1::uuid::text,$3,$4)',[uid(n),account,zone,basis]);
 await q('insert into icash_voice_jobs(id,account_id,operational_contact_id,due_at) values($1,$2,$1,now()-interval \'1 hour\')',[uid(n),account]);return uid(n);
};
const pick=async()=>{const token=await one("select icash_issue_ready_voice_ticket()->>'token'");return token?one('select voice_job_id from icash_automation_tickets where token=$1',[token]):null;};
const finishPrimary=async(account,outcome='contacts_saved')=>{
 const id=await one("insert into icash_automation_tickets(account_id,kind,state) values($1,'discovery','consumed') returning id",[account]);
 await q('select icash_finish_automation($1,true,$2)',[id,outcome]);return id;
};
const claim=async()=>{
 const token=await one("select icash_issue_account_followup()->>'token'");
 return token?one('select icash_consume_automation($1)',[token]):null;
};
try{
 await isolate(async()=>{await add(100,'closed');await add(101);assert.equal(await pick(),uid(100),'reproduces closed-hour job consuming a ticket before the fix');});
 await pg.exec("insert into icash_operation_spend values('voice:unknown','"+uid(3)+"','dispatched',null,null)");
 const finances=await one('select jsonb_agg(to_jsonb(o)) from icash_operation_spend o');
 const migration=read('config/parallel-work-throughput.sql');await pg.exec(migration);
 assert.deepEqual(await one('select jsonb_agg(to_jsonb(o)) from icash_operation_spend o'),finances);
 assert.equal(await one('select count(*) from icash_work_private.account_followups'),1,'existing pending accounts enter recovery without new paid work');
 await isolate(async()=>{
  await add(100,'closed');await add(101,'open',uid(2));
  assert.equal(await pick(),uid(101),'closed hours cannot starve a later eligible account');
  assert.equal(await one('select state from icash_voice_jobs where id=$1',[uid(100)]),'ready');
  assert.equal(await one('select count(*) from icash_automation_tickets'),1);
 });
 for(const zone of ['closed','invalid',null])await isolate(async()=>{await add(110,zone);assert.equal(await pick(),null);});
 await isolate(async()=>{await add(110,'open',uid(1),'business_operating_clock');assert.equal(await pick(),null,'fallback basis remains authoritative');});
 await isolate(async()=>{
  await add(120);await add(121,'open',uid(2));
  await pg.exec("update icash_voice_scheduler set last_dispatch_at=now()-interval '1500 milliseconds'");
  assert.equal(await pick(),uid(120),'available capacity can refill after one second');
  assert.equal(await pick(),null,'same-second claims remain bounded');
 });
 for(const blocker of ['capacity','pause','wallet','expired','held','disabled'])await isolate(async()=>{
  await add(130);
  await pg.exec({capacity:'update fixture_capacity set open=false',pause:'update icash_accounts set bot_paused=true',wallet:'update icash_wallets set balance_cents=0',expired:"update icash_operational_contacts set permission_until=now()-interval '1 second'",held:"update icash_voice_jobs set state='held'",disabled:'update icash_operating_budget set enabled=false'}[blocker]);
  assert.equal(await pick(),null,blocker+' remains enforced');
 });
 await isolate(async()=>{
  await add(140,'closed');await add(141,'open',uid(2));
  await pg.exec("update icash_voice_jobs set state='held',outcome='prospecting_budget_held'");
  for(const n of [140,141])await q("insert into icash_automation_tickets(account_id,kind,state,outcome,expires_at,voice_job_id,prospecting_quote_cents) values($1,'voice_dispatch','held','prospecting_budget_held',now()-interval '1 minute',$2,10)",[n===140?uid(1):uid(2),uid(n)]);
  const token=await one("select icash_resume_prospecting_ticket()->>'token'");
  assert.equal(await one('select voice_job_id from icash_automation_tickets where token=$1',[token]),uid(141));
  assert.equal(await one('select state from icash_voice_jobs where id=$1',[uid(140)]),'held');
 });
 await isolate(async()=>{
  const id=await finishPrimary(uid(1));await q('select icash_finish_automation($1,true,$2)',[id,'contacts_saved']);
  assert.equal(await one('select requested_version from icash_work_private.account_followups where account_id=$1',[uid(1)]),1,'duplicate primary finish does not duplicate reconciliation');
  await pg.exec('delete from icash_work_private.account_followups where account_id=\''+uid(3)+'\'');
  const ticket=await claim();assert.equal(ticket.accountId,uid(1));
  assert.equal(await one('select icash_consume_automation($1)',[await one('select token from icash_automation_tickets where id=$1',[ticket.id])]),null,'capability consumes once');
  assert.equal((await claim())?.accountId,uid(3),'one live recovery claim per account; the orphan sweep can recover another account independently');
  assert.deepEqual(await one('select icash_account_followup_context($1,$2)',[uid(1),ticket.id]),{notify:true});
  assert.equal(await one('select icash_account_followup_context($1,$2)',[uid(2),ticket.id]),null,'cross-account recovery denied');
  await finishPrimary(uid(1));
  assert.equal(await one('select icash_finish_account_followup($1,$2,true)',[uid(1),ticket.id]),true);
  assert.equal(await one('select completed_version from icash_work_private.account_followups where account_id=$1',[uid(1)]),1,'new progress during an in-flight claim stays pending');
  const next=await claim();assert(next&&next.id!==ticket.id);
  assert.equal(await one('select icash_finish_account_followup($1,$2,true)',[uid(1),ticket.id]),false,'stale completion cannot acknowledge replacement');
  assert.equal(await one('select icash_finish_account_followup($1,$2,true)',[uid(1),next.id]),true);
  assert.equal(await claim(),null,'quiet settled account has no pointless follow-up loop');
  assert.equal(await one('select requested_version from icash_work_private.account_followups where account_id=$1',[uid(1)]),2,'reconciliation does not enqueue itself');
 });
 await isolate(async()=>{
  const first=await claim();assert.equal(first.accountId,uid(3));
  await pg.exec("update icash_work_private.account_followups set lease_until=now()-interval '1 second'");
  const replacement=await claim();assert(replacement.id!==first.id);
  assert.equal(await one('select state from icash_automation_tickets where id=$1',[first.id]),'held');
  assert.equal(await one('select icash_finish_account_followup($1,$2,true)',[uid(3),first.id]),false);
  assert.equal(await one('select icash_finish_account_followup($1,$2,false)',[uid(3),replacement.id]),true);
  assert.equal(await claim(),null,'failed recovery has a persisted cooldown');
  assert.deepEqual(await one('select jsonb_agg(to_jsonb(o)) from icash_operation_spend o'),finances,'unknown money never released by a lease timeout');
 });
 await isolate(async()=>{
  assert.equal(await one("select icash_next_automation_lane('general')->>'token'"),'general');
  assert.equal(await one("select icash_next_automation_lane('research')"),null,'new protocol remains inert until matching API is live');
  await pg.exec('update icash_work_private.dispatch_policy set enabled=true');
  assert.equal(await one("select icash_next_automation_lane('research')->>'token'"),'research');
  assert.equal(await one("select icash_next_automation_lane('voice')"),null,'empty voice pool cannot consume research');
  const original=await one("select pg_get_functiondef('icash_issue_ready_seller_text()'::regprocedure)");
  const baseline=JSON.parse(read('tests/fixtures/parallel-work-baseline.json')).find(x=>x.proname==='icash_next_before_unstarted_sms_recovery').definition;
  assert.equal(original,baseline.replace('FUNCTION public.icash_next_before_unstarted_sms_recovery()','FUNCTION public.icash_issue_ready_seller_text()').replace('return public.icash_next_before_sms_inbound_campaign();','return null;'),'SMS admission and unknown-send guards remain exact');
  await pg.exec(`create or replace function icash_issue_ready_seller_text() returns jsonb language sql as $$select '{"token":"message"}'::jsonb$$`);
  assert.equal(await one("select icash_next_automation_lane('messages')->>'token'"),'message');
  assert.equal((await one("select icash_next_automation_lane('recovery')"))?.token?.length,72);
 });
 await assert.rejects(q("select icash_next_automation_lane('untrusted')"),/Unknown automation lane/);
 for(const role of ['anon','authenticated']){
  for(const fn of ['icash_next_automation_lane(text)','icash_issue_account_followup()','icash_account_followup_context(uuid,uuid)','icash_finish_account_followup(uuid,uuid,boolean)'])assert.equal(await one('select has_function_privilege($1,$2,\'execute\')',[role,fn]),false);
  assert.equal(await one('select has_schema_privilege($1,\'icash_work_private\',\'usage\')',[role]),false);
 }
 assert.equal(migration,read('supabase/migrations/20261027033207_parallel_work_throughput.sql'));
 console.log('Parallel SQL: early hours, capacity/fairness/admission, one-second issuance, durable generations, crash/stale-worker recovery, lane isolation, private access and unchanged money passed. Local fixtures only.');
}finally{await pg.close();}
