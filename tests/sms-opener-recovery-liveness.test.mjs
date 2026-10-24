// Shared original-opener recovery: local SQL only, no provider calls or production writes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createOperationalContactFixture} from './helpers/operational-contact-fixture.mjs';
const require=createRequire(import.meta.url);
const f=await createOperationalContactFixture(require.resolve('@electric-sql/pglite'),{automaticChannels:true});
const {pg,q,rpc,one,account,prepare,project}=f;
try {
  await pg.exec(`create table icash_timezone_names(name text primary key);insert into icash_timezone_names select name from pg_timezone_names;
  create or replace function icash_next_before_unstarted_sms_recovery() returns jsonb language sql as $$select '{"token":"prior-new-work"}'::jsonb$$;`);
  const baseline=JSON.parse(readFileSync(new URL('./fixtures/sms-recovery-scheduler-baseline.json',import.meta.url),'utf8'));
  await pg.exec(baseline.find(x=>x.proname==='icash_next_before_owner_question').definition);
  await pg.exec(`create or replace function icash_resume_prospecting_ticket() returns jsonb language sql as $$select '{"token":"budget-resume-voice"}'::jsonb$$;
  create or replace function icash_next_before_prospecting_budget() returns jsonb language sql as $$select '{"token":"outer-discovery"}'::jsonb$$;
  create or replace function icash_sms_outreach_window_current(uuid,uuid) returns boolean language sql as $$select true$$;`);
  await pg.exec(baseline.find(x=>x.proname==='icash_next_automation').definition);
  await pg.exec('set check_function_bodies=off');
  await pg.exec(baseline.find(x=>x.proname==='icash_research_waiting_on_outreach').definition);
  await pg.exec('set check_function_bodies=on');
  await prepare();await project();
  const thread=(await one('select id from icash_text_threads where account_id=$1',[account])).id;
  const message=await rpc('icash_queue_seller_opener',{p_account:account,p_thread:thread});assert(message);
  await q("insert into icash_automation_tickets(account_id,kind,opener_message_id,state,issue_attempts,created_at,expires_at) values($1,'seller_opener',$2,'issued',1,now()-interval '45 minutes',now()-interval '43 minutes')",[account,message]);
  const before=await one('select count(*)::int n from icash_automation_tickets where opener_message_id=$1',[message]);
  for(let n=0;n<5;n++)assert.deepEqual(await rpc('icash_next_before_owner_question',{}),{token:'prior-new-work'});
  assert.deepEqual(await one('select count(*)::int n from icash_automation_tickets where opener_message_id=$1',[message]),before,'eligible expired opener is never considered while prior lane has work');
  for(let n=0;n<5;n++)assert.deepEqual(await rpc('icash_next_automation',{}),{token:'budget-resume-voice'},'actual root can also starve the original recovery lane');
  const original=await one("select pg_get_functiondef('icash_next_before_owner_question()'::regprocedure) body");
  const sql=readFileSync(new URL('../config/sms-recovery-research-liveness.sql',import.meta.url),'utf8');
  assert.equal(sql,readFileSync(new URL('../supabase/migrations/20261023182705_funded_outreach_liveness.sql',import.meta.url),'utf8'));
  // Research SQL is exercised against its complete schema in the companion suite.
  await pg.exec('set check_function_bodies=off');
  await pg.exec(sql);
  await pg.exec('set check_function_bodies=on');
  const changed=await one("select pg_get_functiondef('icash_recover_unstarted_seller_opener()'::regprocedure) body");
  const candidateQuery=body=>body.slice(body.indexOf(' select th.account_id'),body.indexOf(' if not found then return'));
  assert.equal(candidateQuery(changed.body),candidateQuery(original.body),'every candidate, contact, retry-limit and evidence predicate stays byte-for-byte unchanged');
  const selectionSql=readFileSync(new URL('../config/unstarted-opener-selection.sql',import.meta.url),'utf8');
  const oldSelection=selectionSql.split('$original$')[1];
  await pg.exec(selectionSql);
  const orderedBody=(await one("select pg_get_functiondef('icash_recover_unstarted_seller_opener()'::regprocedure) body")).body;
  const newSelection=orderedBody.slice(orderedBody.indexOf(' select ordered.account_id'),orderedBody.indexOf('\n if not found then return null;end if;'));
  assert.equal(orderedBody.replace(newSelection,oldSelection),changed.body,'only selection changes; scheduler locks, throttle, ticket issuance and capability handling remain exact');
  const oldSelect=oldSelection.replace(' into candidate',''),orderedSelect=newSelection.replace(' into candidate','');
  await q('begin');
  try{
   const oldRows=(await q(oldSelect)).rows,newRows=(await q(orderedSelect)).rows;
   assert.equal(oldRows.length,1,'fixture contains an admissible unattempted opener');
   assert.deepEqual(newRows,oldRows,'ordered selector chooses the same account, message and attempt');
  }finally{await q('rollback');}
  // Count real review calls rather than wall-clock time. The same review helper
  // still runs for admitted jobs; unrecoverable history must be excluded first.
  await pg.exec(`create sequence fixture_opener_reviews;
   alter function icash_sms_thread_review_current(uuid,uuid,boolean) rename to fixture_original_sms_review;
   create function icash_sms_thread_review_current(p_account uuid,p_thread uuid,p_check_hour boolean default true) returns boolean language plpgsql as $$
   begin perform nextval('public.fixture_opener_reviews');return public.fixture_original_sms_review(p_account,p_thread,p_check_hour);end$$;`);
  await q('begin');
  try{
   await q("insert into icash_automation_tickets(account_id,kind,opener_message_id,state,issue_attempts,created_at,expires_at) select $1,'seller_opener',$2,'consumed',1,now()-interval '45 minutes',now()-interval '43 minutes' from generate_series(1,200)",[account,message]);
   assert.equal((await q(oldSelect)).rows.length,0);
   assert.equal((await one('select is_called from fixture_opener_reviews')).is_called,true,'old selector checks recipient admission before excluding consumed history');
   await pg.exec('alter sequence fixture_opener_reviews restart with 1');
   assert.equal((await q(orderedSelect)).rows.length,0,'same unrecoverable backlog remains excluded');
   assert.equal(await rpc('icash_recover_unstarted_seller_opener',{}),null);
   assert.equal((await one('select is_called from fixture_opener_reviews')).is_called,false,'ineligible history makes no expensive recipient review calls');
  }finally{await q('rollback');}
  const root=(await one("select pg_get_functiondef('icash_next_automation()'::regprocedure) body")).body;
  assert(root.indexOf('pg_try_advisory_xact_lock')<root.indexOf('icash_recover_unstarted_seller_opener()'));
  assert(root.indexOf('icash_recover_unstarted_seller_opener()')<root.indexOf('icash_resume_prospecting_ticket()'));
  assert.match(changed.body,/kind='seller_opener' and created_at>now\(\)-interval '1 minute'/);
  const recovered=await rpc('icash_next_automation',{});assert(recovered?.token&&recovered.token!=='prior-new-work','unchanged eligible opener now recovers even while the prior lane has work');
  const issued=await one('select state,issue_attempts from icash_automation_tickets where token=$1',[recovered.token]);
  assert.deepEqual(issued,{state:'issued',issue_attempts:2});
  assert.equal((await one('select state,provider_id from icash_text_messages where id=$1',[message])).state,'ready');
  assert.equal((await one('select count(*)::int n from icash_operation_spend where operation_key=$1',['text:'+message])).n,0);
  assert.deepEqual(await rpc('icash_next_before_owner_question',{}),{token:'prior-new-work'},'live recovery ticket is not duplicated and other work keeps its path');
  assert.deepEqual(await rpc('icash_next_automation',{}),{token:'budget-resume-voice'},'one-minute SMS throttle leaves ordinary budget-resume work available');
  const helperAcl=await one(`select prosecdef,proconfig,
   has_function_privilege('anon','icash_recover_unstarted_seller_opener()','execute') anon,
   has_function_privilege('authenticated','icash_recover_unstarted_seller_opener()','execute') authenticated,
   has_function_privilege('service_role','icash_recover_unstarted_seller_opener()','execute') service
   from pg_proc where oid='icash_recover_unstarted_seller_opener()'::regprocedure`);
  assert.equal(helperAcl.prosecdef,false);assert.deepEqual(helperAcl.proconfig,['search_path=""']);
  assert.equal(helperAcl.anon,false);assert.equal(helperAcl.authenticated,false);assert.equal(helperAcl.service,true);
  await q('delete from icash_automation_tickets where token=$1',[recovered.token]);
  const isolated=async (change)=>{await q('begin');try{await change();assert.deepEqual(await rpc('icash_next_before_owner_question',{}),{token:'prior-new-work'});assert.deepEqual(await rpc('icash_next_automation',{}),{token:'budget-resume-voice'});}finally{await q('rollback');}};
  await isolated(()=>q("update icash_automation_tickets set state='held',outcome='held_for_reconciliation' where opener_message_id=$1",[message]));
  await isolated(()=>q("update icash_automation_tickets set state='consumed' where opener_message_id=$1",[message]));
  await isolated(()=>q("update icash_automation_tickets set issue_attempts=3 where opener_message_id=$1",[message]));
  await isolated(()=>q("update icash_automation_tickets set expires_at=now()+interval '1 minute' where opener_message_id=$1",[message]));
  await isolated(()=>q("update icash_automation_tickets set created_at=now() where opener_message_id=$1",[message]));
  await isolated(()=>q("update icash_operating_budget set enabled=false"));
  await isolated(()=>q("update icash_accounts set bot_paused=true where id=$1",[account]));
  await isolated(()=>q("update icash_wallets set balance_cents=0 where account_id=$1",[account]));
  await isolated(()=>q("update icash_text_threads set paused=true where id=$1",[thread]));
  await isolated(()=>q("update icash_text_threads set sms_intake_pending=true where id=$1",[thread]));
  await isolated(()=>q("update icash_screening_jobs set completed_at=now()-interval '25 hours' where id=$1",[f.screening]));
  await isolated(()=>q("update icash_seller_opener_assignments set opted_out=true where message_id=$1",[message]));
  await isolated(()=>q("insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION STOP')",[f.phone]));
  await isolated(()=>q("create or replace function icash_sms_outreach_window_current(uuid,uuid) returns boolean language sql as $$select false$$"));
  await isolated(()=>q("update icash_text_senders set enabled=false where phone=$1",[f.sender]));
  await isolated(()=>q("update icash_operational_contacts set revoked_at=now() where account_id=$1",[account]));
  await isolated(()=>q("update icash_text_messages set provider_id='SIMULATION provider receipt' where id=$1",[message]));
  await isolated(()=>q("update icash_text_messages set state='dispatching' where id=$1",[message]));
  await isolated(()=>q("update icash_seller_opener_assignments set body='SIMULATION changed assignment' where message_id=$1",[message]));
  const operation='text:'+message;
  await isolated(async()=>{
    await q("insert into icash_operation_spend select (jsonb_populate_record(null::icash_operation_spend,to_jsonb(o)||jsonb_build_object('operation_key',$2::text))).* from icash_operation_spend o where o.account_id=$1 limit 1",[account,operation]);
  });
  // Even the real outer chain need not be reachable: root recovery wins before
  // either a continuous resume token or a continuous outer discovery token.
  await pg.exec(`create or replace function icash_resume_prospecting_ticket() returns jsonb language sql as $$select null::jsonb$$;`);
  const rootDiscoveryRecovery=await rpc('icash_next_automation',{});
  assert(rootDiscoveryRecovery?.token&&rootDiscoveryRecovery.token!=='outer-discovery');
  assert.deepEqual(await rpc('icash_next_automation',{}),{token:'outer-discovery'});
  await q('delete from icash_automation_tickets where token=$1',[rootDiscoveryRecovery.token]);
  const oldWrapperRecovery=await rpc('icash_next_before_owner_question',{});
  assert(oldWrapperRecovery?.token&&oldWrapperRecovery.token!=='prior-new-work','legacy wrapper reuses helper');
  assert.equal((await one('select balance_cents from icash_wallets where account_id=$1',[account])).balance_cents,100000,'no charge occurs in scheduling tests');
  assert.equal((await one('select state from icash_text_messages where id=$1',[message])).state,'ready','no provider receipt invented');
  await assert.rejects(pg.exec(selectionSql),/Unstarted opener selection prerequisite changed/);await q('rollback');
  assert.equal((await one("select pg_get_functiondef('icash_recover_unstarted_seller_opener()'::regprocedure) body")).body,orderedBody,'unexpected prerequisite fails atomically');
  console.log('PASS: expired original SMS recovery beats continuous actual root budget-resume and outer/lower work; all candidate predicates unchanged; throttle, three-attempt limit, live/consumed/unknown holds, Pause, credits, contact/sender/evidence and operation protections retained.');
} finally {await pg.close();}
