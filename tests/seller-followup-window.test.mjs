// SIMULATION ONLY. Real operational contact checks; no external requests.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {createOperationalContactFixture} from './helpers/operational-contact-fixture.mjs';
const require=createRequire(import.meta.url);
const f=await createOperationalContactFixture(require.resolve('@electric-sql/pglite'),{automaticChannels:true});
const {pg,q,rpc,one,account,deal,screening,prepare,project,isolated}=f;
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
try{
 const original=read('supabase/migrations/20261009223901_seller_gap_recovery_learning.sql');
 await pg.exec(original.slice(original.indexOf('create table public.icash_seller_gaps('),original.indexOf('create function public.icash_seller_contact_stop')));
 await pg.exec(original.slice(original.indexOf('do $$ declare definition text;begin'),original.indexOf('alter function public.icash_next_automation() rename to icash_next_before_seller_recovery;')));
 await pg.exec(`
 alter table icash_text_threads add column if not exists manual_only boolean not null default false;
 alter table icash_text_threads add column if not exists retired_at timestamptz;
 create or replace function icash_seller_conversation_context(uuid,uuid) returns jsonb language sql as $$select null::jsonb$$;
 create or replace function icash_seller_sms_permission_current(uuid,uuid,boolean) returns boolean language sql as $$select false$$;
 create or replace function icash_current_viewing_slots(uuid,uuid) returns jsonb language sql as $$select '[]'::jsonb$$;
 create or replace function icash_choose_seller_recovery(uuid,text,text,text,integer) returns text language sql as $$select 'no-response-v1'::text$$;
 create or replace function icash_sms_outreach_window_current(uuid,uuid) returns boolean language sql as $$select true$$;
 create or replace function icash_quarantine_stalled_voice_slots(integer) returns integer language sql as $$select 0$$;
 create or replace function icash_issue_due_signing_result() returns jsonb language sql as $$select null::jsonb$$;
 create or replace function icash_issue_due_voice_result() returns jsonb language sql as $$select null::jsonb$$;
 create or replace function icash_issue_due_text_ai() returns jsonb language sql as $$select null::jsonb$$;
 create or replace function icash_issue_due_title_followup() returns jsonb language sql as $$select null::jsonb$$;
 create or replace function icash_issue_ready_fulfillment() returns jsonb language sql as $$select null::jsonb$$;
 create or replace function icash_recover_unstarted_seller_opener() returns jsonb language sql as $$select '{"token":"continuous-prospecting"}'::jsonb$$;
 create or replace function icash_resume_prospecting_ticket() returns jsonb language sql as $$select null::jsonb$$;
 create or replace function icash_next_before_prospecting_budget() returns jsonb language sql as $$select null::jsonb$$;
 `);
 for(const row of JSON.parse(read('tests/fixtures/seller-followup-window-baseline.json')))await pg.exec(row.definition);
 await prepare();await project();
 const thread=(await one('select id from icash_text_threads where account_id=$1',[account])).id;
 await q("update icash_seller_recovery_variants set enabled=true where key='no-response-v1'");
 const message=await rpc('icash_queue_text',{p_account:account,p_thread:thread,p_key:randomUUID(),p_body:'SIMULATION Is this the owner?',p_assets:'{}'});
 await q("update icash_text_messages set state='delivered',provider_id='SIMULATION-receipt',created_at=now()-interval '5 hours' where id=$1",[message]);
 const input={p_account:account,p_thread:thread,p_source:'text',p_source_id:message,p_reason:'no_response',p_quote:'SIMULATION unanswered owner question',p_at:new Date((await one('select created_at from icash_text_messages where id=$1',[message])).created_at).toISOString()};
 const oldGap=await rpc('icash_open_seller_gap',input);
 assert.equal(await rpc('icash_seller_recovery_current',{p_gap:oldGap}),false,'old recovery excludes valid operational contacts');
 assert.equal((await one('select due_at>now() future from icash_seller_gaps where id=$1',[oldGap])).future,true,'old 24-hour reminder misses its observation window');
 const evidenceBefore=await one('select jsonb_agg(to_jsonb(c) order by id) contacts from icash_operational_contacts c');
 const sql=read('config/seller-followup-window.sql');
 assert.equal(sql,read('supabase/migrations/20261026175235_seller_followup_window.sql'));
 await pg.exec(sql);
 await q('delete from icash_seller_gaps where id=$1',[oldGap]);
 const gap=await rpc('icash_open_seller_gap',input);
 assert.equal((await one('select due_at<=now() due,review_reason from icash_seller_gaps where id=$1',[gap])).due,true);
 assert.equal(await rpc('icash_seller_recovery_current',{p_gap:gap}),true,'current outbound contact follows the real reviewed SMS path');
 assert.deepEqual(await one('select jsonb_agg(to_jsonb(c) order by id) contacts from icash_operational_contacts c'),evidenceBefore,'no contact evidence is extended or rewritten');
 const blocked=async change=>isolated(async()=>{await change();assert.equal(await rpc('icash_seller_recovery_current',{p_gap:gap}),false);assert.equal(await rpc('icash_next_seller_followup',{}),null);});
 await blocked(()=>q('update icash_accounts set bot_paused=true where id=$1',[account]));
 await blocked(()=>q('update icash_text_threads set paused=true where id=$1',[thread]));
 await blocked(()=>q('update icash_text_threads set manual_only=true where id=$1',[thread]));
 await blocked(()=>q("insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION STOP')",[f.phone]));
 await blocked(()=>q('update icash_operational_contacts set revoked_at=now() where account_id=$1',[account]));
 await blocked(()=>q("update icash_discovery_configs set data_rights_until=now()-interval '1 minute' where account_id=$1",[account]));
 await isolated(async()=>{
  await q('update icash_wallets set balance_cents=0 where account_id=$1',[account]);
  assert.equal(await rpc('icash_next_seller_followup',{}),null,'no funds cannot issue work');
 });
 await isolated(async()=>{
  await pg.exec('create or replace function icash_sms_outreach_window_current(uuid,uuid) returns boolean language sql as $$select false$$');
  assert.equal(await rpc('icash_next_seller_followup',{}),null,'quiet hours cannot issue a reminder');
 });
 await isolated(async()=>{
  await q("update icash_text_threads set eligibility_until=now()-interval '1 minute' where id=$1",[thread]);
  assert.equal(await rpc('icash_next_seller_followup',{}),null);
  assert.deepEqual(await one('select state,review_reason,outgoing_id from icash_seller_gaps where id=$1',[gap]),{state:'needs_review',review_reason:'contact_checks_expired',outgoing_id:null});
 });
 await isolated(async()=>{
  await q("insert into icash_text_messages(account_id,thread_id,direction,body,state) values($1,$2,'incoming','SIMULATION reply','received')",[account,thread]);
  assert.equal(await rpc('icash_seller_recovery_current',{p_gap:gap}),false,'a newer reply supersedes the old reminder');
 });
 await isolated(async()=>{
  await q('delete from icash_seller_gaps where id=$1',[gap]);
  await q("update icash_text_threads set eligibility_until=now()+interval '1 hour' where id=$1",[thread]);
  const held=await rpc('icash_open_seller_gap',{...input,p_at:new Date((await one('select now() at')).at).toISOString()});
  assert.deepEqual(await one('select state,review_reason from icash_seller_gaps where id=$1',[held]),{state:'needs_review',review_reason:'contact_checks_expired'},'cannot schedule a new reminder beyond current checks');
 });
 await isolated(async()=>{
  await pg.exec('create or replace function icash_issue_due_voice_result() returns jsonb language sql as $$select \'{"token":"due-original-result"}\'::jsonb$$');
  assert.deepEqual(await rpc('icash_next_automation',{}),{token:'due-original-result'},'original receipts settle before reminder outreach');
 });
 const result=await rpc('icash_next_automation',{});
 assert(result?.token&&result.token!=='continuous-prospecting','due follow-up advances even with an endless new-work queue');
 const queued=await one('select state,outgoing_id from icash_seller_gaps where id=$1',[gap]);
 assert.equal(queued.state,'queued');assert(queued.outgoing_id);
 assert.equal((await one('select state,provider_id from icash_text_messages where id=$1',[queued.outgoing_id])).provider_id,null,'scheduling does not fabricate delivery');
 assert.deepEqual(await rpc('icash_next_automation',{}),{token:'continuous-prospecting'},'one-per-minute throttle leaves the other lane moving');
 assert.equal((await one('select count(*)::int n from icash_seller_recovery_attempts where gap_id=$1',[gap])).n,1,'idempotent reminder');
 assert.equal((await one('select balance_cents from icash_wallets where account_id=$1',[account])).balance_cents,100000);
 assert.equal((await one("select has_function_privilege('authenticated','public.icash_next_seller_followup()','EXECUTE') allowed")).allowed,false);
 console.log('PASS outbound reminders, valid evidence windows, expired review, pause/STOP/funds/hours, latest reply, scheduler priority, idempotency and no evidence renewal.');
}finally{await pg.close();}
