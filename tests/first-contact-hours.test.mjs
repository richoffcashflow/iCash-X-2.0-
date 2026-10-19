// SIMULATION ONLY. No provider or production database access.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const pg=new PGlite();
const sql=readFileSync(new URL('../config/first-contact-hours.sql',import.meta.url),'utf8');
const q=(s,p=[])=>pg.query(s,p);
const value=async(s,p=[])=>Object.values((await q(s,p)).rows[0])[0];
const account='11111111-1111-4111-8111-111111111111',screen='22222222-2222-4222-8222-222222222222',deal='33333333-3333-4333-8333-333333333333',thread='44444444-4444-4444-8444-444444444444';
const phone='+12145550123',night='2026-10-20T03:00:00Z';
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create view icash_timezone_names as select name from pg_timezone_names;
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid);
 create table icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,recipient text,retired_at timestamptz,timezone text,operational_contact_id uuid);
 create table icash_operational_contacts(id uuid primary key,account_id uuid,channel text,timezone_basis text);
 create table icash_text_messages(id uuid default gen_random_uuid(),account_id uuid,thread_id uuid,direction text,state text,provider_id text,event_id text,created_at timestamptz);
 create table icash_live_conversations(account_id uuid,screening_id uuid,contact_key text,state text,completed_at timestamptz,conversation_id text,result jsonb);
 set check_function_bodies=off;`);
 const opportunity=readFileSync(new URL('../config/opportunity-engine.sql',import.meta.url),'utf8');
 await pg.exec(opportunity.match(/create function public\.icash_call_has_seller_response[\s\S]*?\$\$;/)[0]);
 const baseline=JSON.parse(readFileSync(new URL('./fixtures/first-contact-hours-baseline.json',import.meta.url),'utf8'));
 for(const item of baseline)await pg.exec(item.definition);
 await pg.exec(sql);
 await q('insert into icash_deal_files values($1,$2,$3)',[deal,account,screen]);
 await q("insert into icash_text_threads values($1,$2,$3,$4,null,'America/Chicago',null)",[thread,account,deal,phone]);
 const open=(stamp,zone=null,basis=null)=>value('select icash_outreach_window_open($1,$2,$3)',[zone,basis,stamp]);
 for(const [stamp,expected] of [['2026-10-19T13:59:59Z',false],['2026-10-19T14:00:00Z',true],['2026-10-20T01:59:59Z',true],['2026-10-20T02:00:00Z',false],['2026-10-20T05:00:00Z',false]])assert.equal(await open(stamp),expected,stamp);
 assert.equal(await open('2026-11-01T14:00:00Z'),false,'fall DST uses Central standard time');
 assert.equal(await open('2026-11-01T15:00:00Z'),true);
 assert.equal(await open('2026-03-08T14:00:00Z'),true,'spring DST uses Central daylight time');
 assert.equal(await open('2026-10-19T14:00:00Z','America/Los_Angeles'),false,'known recipient location wins');
 assert.equal(await open('2026-10-19T14:00:00Z','Pacific/Honolulu','conservative_nanp_window'),true,'legacy fallback represents the business clock only');
 assert.equal(await open('2026-10-19T14:00:00Z','Invented/Zone'),false,'invalid known location fails closed');
 assert.equal(await open('infinity'),false);
 assert.equal(await open(null),false);
 const active=(acct=account,s=screen,p=phone)=>value('select icash_outreach_active_conversation($1,$2,$3,$4)',[acct,s,p,night]);
 assert.equal(await active(),false,'form/eligibility metadata alone does not mean a reply');
 await q("insert into icash_text_messages(account_id,thread_id,direction,state,event_id,created_at) values($1,$2,'incoming','received','SIMULATION receipt','2026-10-20T02:00:00Z')",[account,thread]);
 assert.equal(await active(),true);
 assert.equal(await active(account,screen,'+12145550999'),false,'other owner cannot exempt this phone');
 assert.equal(await active('99999999-9999-4999-8999-999999999999'),false,'tenant bound');
 assert.equal(await active(account,'99999999-9999-4999-8999-999999999999'),false,'property bound');
 assert.equal(await value('select icash_sms_outreach_window_current($1,$2,$3)',[account,thread,night]),true,'active reply continues overnight');
 await q('update icash_text_messages set event_id=null');assert.equal(await active(),false,'unreceipted rows cannot bypass');
 await q("update icash_text_messages set event_id='SIMULATION receipt',created_at='2026-10-19T02:59:59Z'");assert.equal(await active(),false,'stale reply is not active');
 await q("insert into icash_live_conversations values($1,$2,encode(sha256(convert_to($3,'UTF8')),'hex'),'complete','2026-10-20T02:30:00Z','SIMULATION call',$4)",[account,screen,phone,{transcript:[{role:'user',message:'Leave your message after the beep.'}]}]);
 assert.equal(await active(),false,'voicemail is not a seller response');
 await q('update icash_live_conversations set result=$1',[{transcript:[{role:'user',message:'Yes, I own that property. What is your offer?'}]}]);
 assert.equal(await active(),true,'actual completed phone conversation continues');
 await q('update icash_live_conversations set conversation_id=null');assert.equal(await active(),false,'provider conversation receipt required');
 const originals=await q('select * from icash_text_threads');
 // Control only the pre-existing review dependency to prove the wrapper still
 // requires it, calls it without obsolete hours, and fails closed on null flags.
 await pg.exec(`create table review_fixture(allowed boolean,check_hour boolean);insert into review_fixture values(true,null);
 create or replace function public.icash_sms_review_before_business_hours(p_account uuid,p_thread uuid,p_check_hour boolean default true) returns boolean language plpgsql as $$begin update public.review_fixture set check_hour=p_check_hour;return (select allowed from public.review_fixture);end$$;`);
 assert.equal(await value('select icash_sms_thread_review_current($1,$2,false)',[account,thread]),true);
 assert.equal(await value('select check_hour from review_fixture'),false);
 await q('update review_fixture set allowed=false');assert.equal(await value('select icash_sms_thread_review_current($1,$2,false)',[account,thread]),false,'retained source/DNC/consent gate');
 await q('update review_fixture set allowed=null');assert.equal(await value('select icash_sms_thread_review_current($1,$2,false)',[account,thread]),false,'unknown source review fails closed');
 assert.equal(await value('select icash_sms_thread_review_current($1,$2,null)',[account,thread]),false);
 assert.deepEqual((await q('select * from icash_text_threads')).rows,originals.rows,'historical thread metadata unchanged');
 // Execute the actual Meta final-claim body. Ledger/provider dependencies are
 // local counters; timing still uses the real shared SQL and receipt binding.
 await pg.exec(`
 alter table icash_text_threads add column seller_intake_id uuid,add column sender text,add column sms_rate_id uuid,add column permission_until timestamptz;
 alter table icash_text_messages add column asset_ids uuid[] default '{}',add column attachments jsonb default '[]',add column body text default 'SIMULATION only',add column updated_at timestamptz;
 create table icash_operating_budget(id integer);insert into icash_operating_budget values(1);
 create table icash_accounts(id uuid primary key,bot_paused boolean);
 create table icash_meta_leads(lead_id uuid primary key,account_id uuid,paused boolean default false,declined_at timestamptz);
 create table icash_meta_lead_messages(message_id uuid,lead_id uuid,purpose text);
 create table meta_admission_fixture(reservations integer);insert into meta_admission_fixture values(0);
 create function public.icash_meta_followup_current(uuid,text) returns boolean language sql as $$select true$$;
 create function public.icash_sms_message_route_current(uuid,uuid) returns boolean language sql as $$select true$$;
 create or replace function public.icash_seller_sms_permission_current(p_account uuid,p_thread uuid,p_check_hour boolean default true) returns boolean language sql as $$select true$$;
 create function public.icash_reserve_operation(uuid,text,uuid,timestamptz) returns void language sql as $$update public.meta_admission_fixture set reservations=reservations+1$$;
 create function public.icash_claim_operation(text) returns boolean language sql as $$select true$$;
 `);
 await q('insert into icash_accounts values($1,false)',[account]);
 await q("update icash_text_messages set created_at=now()-interval '2 days'");
 await q('insert into icash_meta_leads(lead_id,account_id) values($1,$2)',[screen,account]);
 await q("update icash_text_threads set seller_intake_id=$1,sender='+14243948384',timezone=(select name from pg_timezone_names where extract(hour from now() at time zone name)=1 limit 1)",[screen]);
 const mid=await value("insert into icash_text_messages(account_id,thread_id,direction,state,created_at) values($1,$2,'outgoing','ready',now()) returning id",[account,thread]);
 await q("insert into icash_meta_lead_messages values($1,$2,'initial')",[mid,screen]);
 const claim=()=>value("select icash_meta_claim_text($1,$2,'+14243948384')",[account,mid]);
 assert.equal(await claim(),null,'new form text cannot reserve overnight');
 assert.equal(await value('select reservations from meta_admission_fixture'),0);
 assert.equal(await value('select state from icash_text_messages where id=$1',[mid]),'ready','held new text remains retryable without reset');
 await q("insert into icash_text_messages(account_id,thread_id,direction,state,event_id,created_at) values($1,$2,'incoming','received','SIMULATION active reply',now())",[account,thread]);
 await q('update icash_accounts set bot_paused=true');assert.equal(await claim(),null,'active response preserves Pause');
 await q('update icash_accounts set bot_paused=false');assert.equal((await claim()).to,phone,'real reply permits the existing final admission');
 assert.equal(await value('select reservations from meta_admission_fixture'),1);
 const definitions=await q("select proname,pg_get_functiondef(oid) definition from pg_proc where pronamespace='public'::regnamespace");
 const def=name=>definitions.rows.find(r=>r.proname===name).definition;
 for(const name of ['icash_claim_text_before_ai','icash_meta_claim_text']){
  const d=def(name);assert(d.indexOf('icash_sms_outreach_window_current')<d.indexOf('icash_reserve_operation'),'hours checked before reserve');
  assert.match(d,/icash_claim_operation/,'normal one-use provider admission remains');
 }
 assert.match(def('icash_claim_email_before_cancellation'),/if m\.email_id=e\.id then\s+if not public\.icash_outreach_window_open\(null,null\)/,'only first network email gated');
 assert.match(def('icash_claim_email_before_cancellation'),/elsif m\.state not in \('interested','replied'\)/,'active network email branch retained');
 for(const name of ['icash_next_before_owner_question','icash_next_before_sms_inbound_campaign','icash_next_before_unstarted_sms_recovery','icash_next_before_closing_gaps','icash_queue_fulfillment']){
  assert.match(def(name),/icash_sms_outreach_window_current/);assert.doesNotMatch(def(name),/extract\(hour/,'scheduler uses current clock');
 }
 for(const sig of ['icash_outreach_timezone(text,text)','icash_outreach_window_open(text,text,timestamptz)','icash_outreach_active_conversation(uuid,uuid,text,timestamptz)','icash_sms_outreach_window_current(uuid,uuid,timestamptz)','icash_sms_thread_review_current(uuid,uuid,boolean)'])for(const role of ['anon','authenticated'])assert.equal(await value('select has_function_privilege($1,$2,\'EXECUTE\')',[role,'public.'+sig]),false);
 const migrations=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(n=>n.endsWith('_first_contact_business_hours.sql'));
 assert.equal(migrations.length,1);assert.equal(readFileSync(new URL('../supabase/migrations/'+migrations[0],import.meta.url),'utf8'),sql+'\n'+readFileSync(new URL('../config/first-contact-voice-hours.sql',import.meta.url),'utf8'));
 console.log('Business hours: real timezone/DST boundaries, receipt-bound conversation exception, unchanged metadata, exact live SMS/email/scheduler patch guards and private helpers passed locally.');
}finally{await pg.close();}
