import assert from 'node:assert/strict';
import {parallelWorkFixture,read,uid} from './helpers/parallel-work-fixture.mjs';
const pg=await parallelWorkFixture(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const isolate=async fn=>{await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}};
try{
 await pg.exec(read('config/parallel-work-throughput.sql'));
 await pg.exec(`
 alter table icash_operation_spend add column created_at timestamptz default now(),add column dispatched_at timestamptz,
  add column settlement_evidence text,add column estimate_checked_at timestamptz;
 create table icash_cost_observations(provider text,event_key text,source_ref text,amount numeric,units text,reconciled boolean default false,observed_at timestamptz default now(),primary key(provider,event_key));
 create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 alter table icash_accounts add column owner_user_id uuid;
 create table icash_customer_update_settings(id int,enabled boolean,global_daily_limit int,next_scan_at timestamptz default now());
 insert into icash_customer_update_settings values(1,true,100,now());
 create table icash_customer_update_preferences(account_id uuid primary key,owner_user_id uuid,email_enabled boolean default true,sms_enabled boolean default false,email_suppressed_at timestamptz,consent_email text,phone text,timezone text default 'America/Chicago',consent_version text default 'bot-updates-2026-10-03.1',consented_at timestamptz default now()-interval '1 day',next_scan_at timestamptz default now());
 create table icash_customer_update_deliveries(account_id uuid,channel text,source_key text,kind text,created_at timestamptz default now());
 create table icash_text_suppressions(phone text);create table icash_webinar_phone_suppressions(phone text);
 create function icash_customer_update_consent_valid(v text) returns boolean language sql as $$select v in ('bot-updates-2026-10-03.1','fixture-valid-new-consent')$$;
 create function icash_webinar_campaign_sender(v text) returns text language sql as $$select '+12125550123'::text$$;
 create function icash_lifecycle_frequency_ok(channel text,recipient text) returns boolean language sql as $$select true$$;
 create table fixture_update_sources(account_id uuid,source_key text,kind text,event_at timestamptz default now());
 create function icash_customer_update_sources(p_account uuid) returns table(source_key text,kind text,event_at timestamptz)
  language sql stable as $$select source_key,kind,event_at from public.fixture_update_sources where account_id=p_account$$;
 create function icash_next_automation_before_customer_updates() returns jsonb language sql as $$select null::jsonb$$;
 create table icash_signing_envelopes(id uuid primary key,account_id uuid,state text,provider_id text,next_poll_at timestamptz default now(),created_at timestamptz default now(),terms_hash text default 'hash');
 create table icash_signature_authorizations(envelope_id uuid,account_id uuid,terms_hash text,state text,expires_at timestamptz);
 `);
 for(const f of JSON.parse(read('tests/fixtures/runtime-cost-efficiency-baseline.json')))await pg.exec(f.definition);
 const migration=read('config/runtime-cost-efficiency.sql');await pg.exec(migration);
 assert.equal(migration,read('supabase/migrations/20261101214847_runtime_cost_efficiency.sql'));
 const finish=async(outcome,success=true,kind='discovery')=>{
  const id=await one('insert into icash_automation_tickets(account_id,kind,state) values($1,$2,\'consumed\') returning id',[uid(1),kind]);
  await q('select icash_finish_automation($1,$2,$3)',[id,success,outcome]);return id;
 };
 const claim=async()=>{
  const token=await one("select icash_issue_account_followup()->>'token'");
  return token?one('select icash_consume_automation($1)',[token]):null;
 };
 const complete=async(success=true)=>{const t=await claim();assert(t);assert.equal(await one('select icash_finish_account_followup($1,$2,$3)',[t.accountId,t.id,success]),true);return t;};
 const due=()=>pg.exec("update icash_work_private.account_followups set next_run_at=now()-interval '1 second'");
 const delay=()=>one('select extract(epoch from next_run_at-clock_timestamp())::float from icash_work_private.account_followups');
 const near=async seconds=>{const d=await delay();assert(d<=seconds&&d>seconds-10,`expected ~${seconds}s, got ${d}`);};
 const operation=async(age='2 days')=>q("insert into icash_operation_spend(operation_key,account_id,state,created_at,dispatched_at) values('fixture:original',$1,'dispatched',now()-$2::interval,now()-$2::interval)",[uid(1),age]);
 for(const outcome of ['updates_idle','empty','awaiting_counterparty','customer_signature_needed','seller_inventory_unavailable','waiting_for_available_credits'])await isolate(async()=>{
  await finish(outcome);assert.equal(await one('select count(*) from icash_work_private.account_followups'),0,'idle completion cannot enqueue a reconciliation loop');
 });
 await isolate(async()=>{
  await finish('contacts_saved');assert.equal(await one('select requested_version from icash_work_private.account_followups'),1);
  const t=await complete();assert.equal(await claim(),null);assert.equal(await one('select icash_finish_account_followup($1,$2,true)',[uid(1),t.id]),false);
 });
 await isolate(async()=>{
  await operation();const original=await one('select to_jsonb(o) from icash_operation_spend o');
  await complete();await near(900);await due();await complete();await near(3600);await due();await complete();await near(21600);
  assert.deepEqual(await one('select to_jsonb(o) from icash_operation_spend o'),original,'backoff changes no operation, receipt, cap or money');
  assert.equal(await claim(),null);
  await q("insert into icash_cost_observations values('elevenlabs','conversation','fixture:original',0.04,'usd',false,now())");
  assert((await delay())<=0,'late original receipt immediately wakes an old hold');
  const t=await claim();assert(t);
  const version=await one('select requested_version from icash_work_private.account_followups');
  await pg.exec("update icash_cost_observations set amount=amount,observed_at=now(),reconciled=true");
  await pg.exec("update icash_operation_spend set estimate_checked_at=now()");
  assert.equal(await one('select requested_version from icash_work_private.account_followups'),version,'check timestamps and receipt acknowledgments cannot wake themselves');
  await pg.exec("update icash_cost_observations set amount=0.05");
  await q('select icash_finish_account_followup($1,$2,true)',[uid(1),t.id]);
  assert((await delay())<=0,'new evidence arriving during the lease is never lost');
 });
 await isolate(async()=>{await operation('2 hours');await complete();await near(300);await due();await complete();await near(300);});
 await isolate(async()=>{await operation();for(const seconds of [60,300,900,900]){await due();await complete(false);await near(seconds);}assert.equal(await one('select state from icash_operation_spend'),'dispatched');});
 await isolate(async()=>{
  await operation();const t=await claim();await pg.exec("update icash_work_private.account_followups set lease_until=now()-interval '1 second'");
  const replacement=await claim();assert.notEqual(replacement.id,t.id);
  assert.equal(await one('select icash_finish_account_followup($1,$2,true)',[uid(1),t.id]),false,'stale worker cannot finish new generation');
  assert.equal(await one('select icash_finish_account_followup($1,$2,true)',[uid(2),replacement.id]),false,'cross-account finish rejected');
 });
 await isolate(async()=>{
  await operation();await complete();await q("insert into icash_live_conversations(id,account_id,state,result,completed_at,operation_key) values($1,$2,'complete','{}',now(),'fixture:original')",[uid(90),uid(1)]);
  assert((await delay())<=0);const version=await one('select requested_version from icash_work_private.account_followups');
  await pg.exec('update icash_live_conversations set result=result');assert.equal(await one('select requested_version from icash_work_private.account_followups'),version);
 });
 await q('insert into auth.users values($1,$2,now())',[uid(10),'fixture@example.com']);
 await q('update icash_accounts set owner_user_id=$1 where id=$2',[uid(10),uid(1)]);
 await q('insert into icash_customer_update_preferences(account_id,owner_user_id,consent_email) values($1,$2,$3)',[uid(1),uid(10),'fixture@example.com']);
 const available=()=>one('select icash_work_private.customer_update_available($1)',[uid(1)]);
 await isolate(async()=>{assert.equal(await available(),false);assert.equal(await one('select icash_next_before_seller_continuation()'),null);assert.equal(await one('select count(*) from icash_automation_tickets'),0,'empty notification scan creates no handler');});
 await q('insert into fixture_update_sources(account_id,source_key,kind) values($1,$2,$3)',[uid(1),'reply:fixture','seller_reply']);
 await isolate(async()=>{assert.equal(await available(),true);assert((await one('select icash_next_before_seller_continuation()')).token,'actual new reply still issues immediately when scanned');});
 await isolate(async()=>{await pg.exec("update icash_customer_update_preferences set consent_version='fixture-valid-new-consent'");assert.equal(await available(),true,'new valid consent versions use the same authority as final admission');});
 for(const blocker of [
  'update icash_customer_update_preferences set email_enabled=false',
  "update icash_customer_update_preferences set email_suppressed_at=now()",
  "update icash_customer_update_preferences set consent_email='changed@example.com'",
  "update icash_customer_update_preferences set consented_at=now()+interval '1 day'",
  'update icash_accounts set owner_user_id=null',
  'update icash_customer_update_settings set enabled=false',
 ])await isolate(async()=>{await pg.exec(blocker);assert.equal(await available(),false,blocker);});
 await isolate(async()=>{await q("insert into icash_customer_update_deliveries values($1,'email','reply:fixture','seller_reply',now()-interval '2 hours')",[uid(1)]);assert.equal(await available(),false,'original delivered/uncertain receipt is never resent');});
 await isolate(async()=>{await q("insert into icash_customer_update_deliveries values($1,'email','other','seller_reply',now())",[uid(1)]);assert.equal(await available(),false,'hourly caps retain authority');});
 for(const authorized of [false,true])await isolate(async()=>{
  await q("insert into icash_signing_envelopes(id,account_id,state,provider_id) values($1,$2,'customer_signature_needed','fixture-provider')",[uid(80),uid(1)]);
  if(authorized)await q("insert into icash_signature_authorizations values($1,$2,'hash','authorized',now()+interval '1 day')",[uid(80),uid(1)]);
  assert((await one('select icash_issue_due_signing_result()')).token);
  const seconds=await one('select extract(epoch from next_poll_at-now())::int from icash_signing_envelopes');
  assert.equal(seconds,600,'both manual and authorized signatures retain prompt original receipt polling');
 });
 for(const role of ['anon','authenticated'])for(const fn of ['icash_work_private.wake_account_followup(uuid,boolean)','icash_work_private.customer_update_available(uuid)','icash_finish_account_followup(uuid,uuid,boolean)'])assert.equal(await one('select has_function_privilege($1,$2,\'execute\')',[role,fn]),false);
 console.log('Runtime cost efficiency: idle-loop regression, old/fresh/error backoff, receipt wakeups, in-flight races, lease/account isolation, notification gates and signature repair verified. No providers contacted.');
}finally{await pg.close();}
